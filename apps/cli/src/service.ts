import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  compileManifest,
  createManifestPlan,
  DEFAULT_MANIFEST_SOURCE,
  explainLaunchdJob,
  formatManifestJson,
  renderLaunchdJob,
  type Diagnostic,
  type JobDoctorReport,
  type ManifestCompilation,
  type NormalizedJob,
  type NormalizedManifest,
  type RenderedJob,
  planLaunchdJob,
} from "@launchd-studio/core";
import type {
  ApplyOperation,
  ApplyResponse,
  ControlAction,
  ControlResponse,
  DoctorResponse,
  ExplainResponse,
  FormatResponse,
  JobStatusResponse,
  LogsResponse,
  LogStream,
  ManifestSourceResponse,
  PlanResponse,
  RenderResponse,
  SaveManifestResponse,
  StatusResponse,
  StudioCapabilities,
  StudioTransport,
  ValidationResponse,
} from "@launchd-studio/core/transport";
import {
  backupFileIfExists,
  ensureParentDirectory,
  isDirectory,
  isExecutableFile,
  isWritableDirectory,
  pathExists,
  readTail,
  readTextIfExists,
  removeFileIfExists,
  writeTextAtomic,
} from "./adapters/filesystem";
import {
  commandFailureMessage,
  LaunchdAdapter,
  type CommandResult,
} from "./adapters/launchd";
import {
  defaultManagedStatePath,
  hashPlist,
  ManagedStateStore,
  type ManagedJobRecord,
} from "./adapters/state";

export class StudioError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(
    message: string,
    options: { readonly status?: number; readonly code?: string; readonly details?: unknown } = {},
  ) {
    super(message);
    this.name = "StudioError";
    this.status = options.status ?? 400;
    this.code = options.code ?? "studio.error";
    if (options.details !== undefined) {
      this.details = options.details;
    }
  }
}

export interface LocalStudioServiceOptions {
  readonly configPath: string;
  readonly homeDirectory?: string;
  readonly launchd?: LaunchdAdapter;
  readonly managedState?: ManagedStateStore;
}

function jobNotFoundDiagnostic(jobId: string): Diagnostic {
  return {
    severity: "error",
    code: "job.not-found",
    message: `Job ${JSON.stringify(jobId)} does not exist in this manifest.`,
    path: "$.jobs",
  };
}

function selectJobs(
  manifest: NormalizedManifest,
  jobId?: string,
): { readonly jobs: ReadonlyArray<NormalizedJob>; readonly diagnostics: ReadonlyArray<Diagnostic> } {
  if (jobId === undefined) {
    return { jobs: manifest.jobs, diagnostics: [] };
  }
  const job = manifest.jobs.find((candidate) => candidate.id === jobId);
  return job === undefined
    ? { jobs: [], diagnostics: [jobNotFoundDiagnostic(jobId)] }
    : { jobs: [job], diagnostics: [] };
}

function operation(
  jobId: string,
  action: string,
  success: boolean,
  message: string,
): ApplyOperation {
  return { jobId, action, success, message };
}

async function requireSuccessfulCommand(
  resultPromise: Promise<CommandResult>,
  description: string,
): Promise<void> {
  const result = await resultPromise;
  if (result.exitCode !== 0) {
    throw new Error(`${description}: ${commandFailureMessage(result)}`);
  }
}

export class LocalStudioService implements StudioTransport {
  readonly #configPath: string;
  readonly #homeDirectory: string;
  readonly #launchd: LaunchdAdapter;
  readonly #managedState: ManagedStateStore;
  readonly #backupRoot: string;

  constructor(options: LocalStudioServiceOptions) {
    this.#configPath = resolve(options.configPath);
    this.#homeDirectory = options.homeDirectory ?? homedir();
    this.#launchd = options.launchd ?? new LaunchdAdapter();
    this.#managedState =
      options.managedState ?? new ManagedStateStore(defaultManagedStatePath(this.#homeDirectory));
    this.#backupRoot = join(
      this.#homeDirectory,
      "Library",
      "Application Support",
      "launchd-studio",
      "backups",
    );
  }

  get configPath(): string {
    return this.#configPath;
  }

  get homeDirectory(): string {
    return this.#homeDirectory;
  }

  get launchd(): LaunchdAdapter {
    return this.#launchd;
  }

  async getCapabilities(): Promise<StudioCapabilities> {
    const runtime = this.#launchd.supported;
    return {
      mode: "local",
      manifestRead: true,
      manifestWrite: true,
      validate: true,
      format: true,
      render: true,
      explain: true,
      plan: true,
      apply: runtime,
      remove: runtime,
      status: true,
      control: runtime,
      logs: true,
      doctor: true,
    };
  }

  async loadManifest(): Promise<ManifestSourceResponse> {
    const source = await readTextIfExists(this.#configPath);
    return source === null
      ? {
          source: DEFAULT_MANIFEST_SOURCE,
          path: this.#configPath,
          exists: false,
        }
      : {
          source,
          path: this.#configPath,
          exists: true,
        };
  }

  async saveManifest(source: string): Promise<SaveManifestResponse> {
    const compilation = this.#compile(source);
    if (!compilation.valid) {
      throw new StudioError("The manifest is invalid and was not written.", {
        status: 422,
        code: "manifest.invalid",
        details: compilation.diagnostics,
      });
    }
    await writeTextAtomic(this.#configPath, source, 0o644);
    return {
      path: this.#configPath,
      bytesWritten: Buffer.byteLength(source),
    };
  }

  async validateManifest(source: string): Promise<ValidationResponse> {
    const compilation = this.#compile(source);
    return {
      valid: compilation.valid,
      diagnostics: compilation.diagnostics,
      jobIds: compilation.valid ? compilation.manifest.jobs.map((job) => job.id) : [],
    };
  }

  async formatManifest(source: string): Promise<FormatResponse> {
    const result = formatManifestJson(source);
    return result.formatted === undefined
      ? {
          valid: false,
          diagnostics: result.diagnostics,
        }
      : {
          valid: true,
          diagnostics: result.diagnostics,
          source: result.formatted,
        };
  }

  async renderManifest(source: string, jobId?: string): Promise<RenderResponse> {
    const compilation = this.#compile(source);
    if (!compilation.valid) {
      return { valid: false, diagnostics: compilation.diagnostics, jobs: [] };
    }
    const selected = selectJobs(compilation.manifest, jobId);
    return {
      valid: selected.diagnostics.length === 0,
      diagnostics: [...compilation.diagnostics, ...selected.diagnostics],
      jobs: selected.jobs.map(renderLaunchdJob),
    };
  }

  async explainManifest(source: string, jobId?: string): Promise<ExplainResponse> {
    const compilation = this.#compile(source);
    if (!compilation.valid) {
      return { valid: false, diagnostics: compilation.diagnostics, jobs: [] };
    }
    const selected = selectJobs(compilation.manifest, jobId);
    return {
      valid: selected.diagnostics.length === 0,
      diagnostics: [...compilation.diagnostics, ...selected.diagnostics],
      jobs: selected.jobs.map(explainLaunchdJob),
    };
  }

  async planManifest(source: string, jobId?: string): Promise<PlanResponse> {
    const prepared = await this.#prepare(source, jobId);
    if (!prepared.valid) {
      return {
        valid: false,
        diagnostics: prepared.diagnostics,
      };
    }

    const plans = await Promise.all(
      prepared.jobs.map(async ({ job, rendered }) => {
        const [fileContent, runtime, managedRecord] = await Promise.all([
          readTextIfExists(rendered.plistPath),
          this.#launchd.status(job.label),
          this.#managedState.get(job.label),
        ]);
        return planLaunchdJob(rendered, {
          fileContent,
          runtime,
          runtimeDefinitionMatches:
            runtime.loaded === true
              ? this.#managedDefinitionMatches(job, rendered, managedRecord)
              : null,
        });
      }),
    );

    return {
      valid: true,
      diagnostics: prepared.diagnostics,
      plan: createManifestPlan(plans),
    };
  }

  async applyManifest(
    source: string,
    jobId?: string,
    start = false,
  ): Promise<ApplyResponse> {
    const prepared = await this.#prepare(source, jobId);
    if (!prepared.valid) {
      return {
        valid: false,
        diagnostics: prepared.diagnostics,
        operations: [],
      };
    }
    this.#launchd.assertSupported();

    const planResponse = await this.planManifest(source, jobId);
    if (!planResponse.valid || planResponse.plan === undefined) {
      return {
        valid: false,
        diagnostics: planResponse.diagnostics,
        operations: [],
      };
    }

    const operations: ApplyOperation[] = [];
    for (const { job, rendered } of prepared.jobs) {
      const jobPlan = planResponse.plan.jobs.find((candidate) => candidate.id === job.id);
      if (jobPlan === undefined) {
        operations.push(operation(job.id, "plan", false, "No plan was generated for this job."));
        continue;
      }

      let backupPath: string | null = null;
      let wrotePlist = false;
      let unloadedPreviousDefinition = false;
      let loadedNewDefinition = false;
      let configurationCommitted = false;

      try {
        if (jobPlan.runtimeAction === "unavailable") {
          throw new Error(
            jobPlan.runtime.detail ?? "Unable to determine the current launchd state safely.",
          );
        }

        await this.#stageAndLint(rendered);
        await ensureParentDirectory(job.logs.stdout);
        await ensureParentDirectory(job.logs.stderr);

        if (jobPlan.fileAction !== "none") {
          backupPath = await backupFileIfExists(
            rendered.plistPath,
            join(this.#backupRoot, job.label),
          );
        }

        if (jobPlan.runtimeAction === "reload") {
          await requireSuccessfulCommand(
            this.#launchd.bootout(job.label),
            `Failed to unload ${job.label}`,
          );
          unloadedPreviousDefinition = true;
          operations.push(operation(job.id, "bootout", true, "Unloaded the previous definition."));
        }

        if (jobPlan.fileAction !== "none") {
          await writeTextAtomic(rendered.plistPath, rendered.plist, 0o644);
          wrotePlist = true;
          operations.push(
            operation(
              job.id,
              jobPlan.fileAction,
              true,
              backupPath === null
                ? `Wrote ${rendered.plistPath}.`
                : `Wrote ${rendered.plistPath}; backup: ${backupPath}.`,
            ),
          );
        }

        if (jobPlan.runtimeAction === "load" || jobPlan.runtimeAction === "reload") {
          await requireSuccessfulCommand(
            this.#launchd.bootstrap(rendered.plistPath),
            `Failed to load ${job.label}`,
          );
          loadedNewDefinition = true;
          operations.push(operation(job.id, "bootstrap", true, "Registered the LaunchAgent."));
          await this.#managedState.record(this.#managedRecord(job, rendered));
          operations.push(
            operation(job.id, "record-state", true, "Recorded the applied runtime definition."),
          );
        }

        configurationCommitted = true;
        if (start) {
          await requireSuccessfulCommand(
            this.#launchd.kickstart(job.label, true),
            `Failed to start ${job.label}`,
          );
          operations.push(operation(job.id, "kickstart", true, "Started the job."));
        } else if (!jobPlan.changed) {
          operations.push(operation(job.id, "noop", true, "Already matches the desired state."));
        }
      } catch (error) {
        if (
          !configurationCommitted &&
          (wrotePlist || unloadedPreviousDefinition || loadedNewDefinition)
        ) {
          try {
            if (loadedNewDefinition) {
              await requireSuccessfulCommand(
                this.#launchd.bootout(job.label),
                `Failed to unload the incomplete definition for ${job.label}`,
              );
            }

            if (wrotePlist) {
              if (backupPath === null) {
                await removeFileIfExists(rendered.plistPath);
              } else {
                const previousPlist = await readTextIfExists(backupPath);
                if (previousPlist === null) {
                  throw new Error(`Backup disappeared before rollback: ${backupPath}`);
                }
                await writeTextAtomic(rendered.plistPath, previousPlist, 0o644);
              }
            }

            if (unloadedPreviousDefinition) {
              if (backupPath === null && !(await pathExists(rendered.plistPath))) {
                throw new Error(
                  "The previous runtime definition was unloaded, but no managed plist was available to restore it.",
                );
              }
              await requireSuccessfulCommand(
                this.#launchd.bootstrap(rendered.plistPath),
                `Failed to restore ${job.label}`,
              );
            }
            operations.push(
              operation(
                job.id,
                "rollback",
                true,
                unloadedPreviousDefinition
                  ? "Restored the previous plist and reloaded it."
                  : "Removed the incomplete registration and restored the previous plist state.",
              ),
            );
          } catch (rollbackError) {
            operations.push(
              operation(
                job.id,
                "rollback",
                false,
                rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
              ),
            );
          }
        }

        operations.push(
          operation(
            job.id,
            "apply",
            false,
            error instanceof Error ? error.message : String(error),
          ),
        );
      }
    }

    return {
      valid: operations.every((entry) => entry.success),
      diagnostics: prepared.diagnostics,
      plan: planResponse.plan,
      operations,
    };
  }

  async getStatus(source: string, jobId?: string): Promise<StatusResponse> {
    const prepared = await this.#prepare(source, jobId);
    if (!prepared.valid) {
      return { valid: false, diagnostics: prepared.diagnostics, jobs: [] };
    }

    const jobs = await Promise.all(
      prepared.jobs.map(async ({ job, rendered }): Promise<JobStatusResponse> => {
        const [fileContent, runtime, managedRecord] = await Promise.all([
          readTextIfExists(rendered.plistPath),
          this.#launchd.status(job.label),
          this.#managedState.get(job.label),
        ]);
        const runtimeDefinitionMatches =
          runtime.loaded === true
            ? this.#managedDefinitionMatches(job, rendered, managedRecord)
            : null;
        return {
          jobId: job.id,
          label: job.label,
          plistPath: rendered.plistPath,
          plistExists: fileContent !== null,
          drifted: fileContent === null ? null : fileContent !== rendered.plist,
          runtimeDefinitionDrifted:
            runtimeDefinitionMatches === null ? null : !runtimeDefinitionMatches,
          runtime,
        };
      }),
    );

    return {
      valid: true,
      diagnostics: prepared.diagnostics,
      jobs,
    };
  }

  async controlJob(
    source: string,
    jobId: string,
    action: ControlAction,
  ): Promise<ControlResponse> {
    const prepared = await this.#prepare(source, jobId);
    if (!prepared.valid || prepared.jobs[0] === undefined) {
      throw new StudioError(`Cannot ${action} ${jobId}: job is invalid or missing.`, {
        status: 422,
        code: "job.invalid",
        details: prepared.diagnostics,
      });
    }
    this.#launchd.assertSupported();

    const { job, rendered } = prepared.jobs[0];
    const current = await this.#launchd.status(job.label);
    if (current.loaded === null) {
      throw new StudioError(
        current.detail ?? `Unable to determine whether ${job.label} is loaded.`,
        { status: 503, code: "runtime.status-unavailable" },
      );
    }

    if (action === "stop") {
      if (!current.loaded) {
        return {
          jobId,
          action,
          success: true,
          message: "The job is already unloaded.",
          status: current,
        };
      }
      const result = await this.#launchd.bootout(job.label);
      if (result.exitCode !== 0) {
        return {
          jobId,
          action,
          success: false,
          message: commandFailureMessage(result),
        };
      }
      return {
        jobId,
        action,
        success: true,
        message: "Unloaded the job. KeepAlive cannot restart it until it is loaded again.",
        status: await this.#launchd.status(job.label),
      };
    }

    const fileContent = await readTextIfExists(rendered.plistPath);
    if (fileContent === null) {
      throw new StudioError(
        `The generated plist does not exist at ${rendered.plistPath}. Run apply first.`,
        { status: 409, code: "job.not-applied" },
      );
    }
    if (fileContent !== rendered.plist) {
      throw new StudioError(
        `The plist at ${rendered.plistPath} differs from the manifest. Run plan and apply first.`,
        { status: 409, code: "job.plist-drifted" },
      );
    }

    await this.#stageAndLint(rendered);
    const managedRecord = await this.#managedState.get(job.label);
    const runtimeDefinitionMatches = this.#managedDefinitionMatches(
      job,
      rendered,
      managedRecord,
    );
    let registeredFreshDefinition = false;

    if (current.loaded && !runtimeDefinitionMatches) {
      const bootout = await this.#launchd.bootout(job.label);
      if (bootout.exitCode !== 0) {
        return {
          jobId,
          action,
          success: false,
          message: `Failed to unload the untracked runtime definition: ${commandFailureMessage(bootout)}`,
        };
      }
      const bootstrap = await this.#launchd.bootstrap(rendered.plistPath);
      if (bootstrap.exitCode !== 0) {
        return {
          jobId,
          action,
          success: false,
          message: `The previous definition was unloaded, but the desired plist could not be loaded: ${commandFailureMessage(bootstrap)}`,
        };
      }
      registeredFreshDefinition = true;
    } else if (!current.loaded) {
      const bootstrap = await this.#launchd.bootstrap(rendered.plistPath);
      if (bootstrap.exitCode !== 0) {
        return {
          jobId,
          action,
          success: false,
          message: commandFailureMessage(bootstrap),
        };
      }
      registeredFreshDefinition = true;
    }

    if (registeredFreshDefinition) {
      try {
        await this.#managedState.record(this.#managedRecord(job, rendered));
      } catch (error) {
        throw new StudioError(
          `The job was registered, but its managed state could not be recorded: ${error instanceof Error ? error.message : String(error)}`,
          { status: 500, code: "state.write-failed" },
        );
      }
    }

    const registeredStatus = registeredFreshDefinition
      ? await this.#launchd.status(job.label)
      : current;
    let result: CommandResult | null = null;
    let message: string;

    if (action === "restart" && !registeredFreshDefinition) {
      result = await this.#launchd.kickstart(job.label, true);
      message = "Restarted the job.";
    } else if (registeredStatus.running === true) {
      message = registeredFreshDefinition
        ? "Loaded the desired definition; the job is running."
        : "The job is already running.";
    } else {
      result = await this.#launchd.kickstart(job.label, false);
      message = action === "restart" ? "Reloaded and started the job." : "Started the job.";
    }

    if (result !== null && result.exitCode !== 0) {
      return {
        jobId,
        action,
        success: false,
        message: commandFailureMessage(result),
      };
    }

    return {
      jobId,
      action,
      success: true,
      message,
      status: await this.#launchd.status(job.label),
    };
  }

  async getLogs(
    source: string,
    jobId: string,
    stream: LogStream,
    tail: number,
  ): Promise<LogsResponse> {
    const prepared = await this.#prepare(source, jobId);
    if (!prepared.valid || prepared.jobs[0] === undefined) {
      throw new StudioError(`Cannot read logs for ${jobId}: job is invalid or missing.`, {
        status: 422,
        code: "job.invalid",
        details: prepared.diagnostics,
      });
    }
    const job = prepared.jobs[0].job;
    const path = stream === "stderr" ? job.logs.stderr : job.logs.stdout;
    const result = await readTail(path, Math.max(1, Math.min(tail, 10_000)));
    return result === null
      ? { jobId, stream, path, exists: false, content: "", truncated: false }
      : { jobId, stream, path, exists: true, ...result };
  }

  async doctor(source: string, jobId?: string): Promise<DoctorResponse> {
    const prepared = await this.#prepare(source, jobId);
    if (!prepared.valid) {
      return { valid: false, diagnostics: prepared.diagnostics, reports: [] };
    }

    const reports: JobDoctorReport[] = [];
    for (const { job, rendered } of prepared.jobs) {
      const checks: JobDoctorReport["checks"][number][] = [];
      checks.push({
        id: "platform",
        status: this.#launchd.supported ? "pass" : "warning",
        message: this.#launchd.supported
          ? "macOS launchd user domain is available."
          : "Runtime operations are unavailable on this platform; rendering remains supported.",
      });

      const executable = job.command[0];
      const executableAvailable = await isExecutableFile(executable);
      checks.push({
        id: "executable",
        status: executableAvailable ? "pass" : "fail",
        message: executableAvailable
          ? `Executable exists: ${executable}`
          : `Executable is missing or not executable: ${executable}`,
      });

      if (job.workingDirectory !== undefined) {
        const workingDirectoryAvailable = await isDirectory(job.workingDirectory);
        checks.push({
          id: "working-directory",
          status: workingDirectoryAvailable ? "pass" : "fail",
          message: workingDirectoryAvailable
            ? `Working directory exists: ${job.workingDirectory}`
            : `Working directory does not exist: ${job.workingDirectory}`,
        });
      }

      for (const [stream, path] of Object.entries(job.logs)) {
        const directory = dirname(path);
        const exists = await isDirectory(directory);
        const writable = exists && (await isWritableDirectory(directory));
        checks.push({
          id: `log-${stream}`,
          status: !exists ? "warning" : writable ? "pass" : "fail",
          message: !exists
            ? `Log directory will be created during apply: ${directory}`
            : writable
              ? `Log directory is writable: ${directory}`
              : `Log directory is not writable: ${directory}`,
        });
      }

      const [fileContent, runtime, managedRecord] = await Promise.all([
        readTextIfExists(rendered.plistPath),
        this.#launchd.status(job.label),
        this.#managedState.get(job.label),
      ]);
      checks.push({
        id: "plist",
        status: fileContent === null ? "warning" : fileContent === rendered.plist ? "pass" : "warning",
        message:
          fileContent === null
            ? `LaunchAgent plist has not been applied: ${rendered.plistPath}`
            : fileContent === rendered.plist
              ? "Applied plist matches the manifest."
              : "Applied plist differs from the manifest; run plan and apply.",
      });

      checks.push({
        id: "runtime",
        status: !runtime.supported
          ? "skipped"
          : runtime.loaded
            ? runtime.lastExitCode !== undefined && runtime.lastExitCode !== 0
              ? "warning"
              : "pass"
            : "warning",
        message: !runtime.supported
          ? runtime.detail ?? "Runtime status is unavailable."
          : runtime.loaded
            ? runtime.running
              ? `Job is running${runtime.pid === undefined ? "" : ` with PID ${runtime.pid}`}.`
              : `Job is loaded but not running${runtime.lastExitCode === undefined ? "" : `; last exit code ${runtime.lastExitCode}`}.`
            : "Job is not loaded.",
      });

      const runtimeDefinitionMatches =
        runtime.loaded === true
          ? this.#managedDefinitionMatches(job, rendered, managedRecord)
          : null;
      checks.push({
        id: "runtime-definition",
        status:
          runtimeDefinitionMatches === null
            ? "skipped"
            : runtimeDefinitionMatches
              ? "pass"
              : "warning",
        message:
          runtimeDefinitionMatches === null
            ? "No loaded runtime definition is available to compare."
            : runtimeDefinitionMatches
              ? "The loaded runtime definition matches the last definition applied by Launchd Studio."
              : "The loaded runtime definition is untracked or differs from the desired definition; apply will reload it.",
      });

      reports.push({ jobId: job.id, label: job.label, checks });
    }

    return {
      valid: reports.every((report) => report.checks.every((check) => check.status !== "fail")),
      diagnostics: prepared.diagnostics,
      reports,
    };
  }

  async removeJob(
    source: string | null,
    jobId: string,
    keepPlist = false,
  ): Promise<ReadonlyArray<ApplyOperation>> {
    this.#launchd.assertSupported();

    let target:
      | {
          readonly jobId: string;
          readonly label: string;
          readonly plistPath: string;
        }
      | undefined;
    let diagnostics: ReadonlyArray<Diagnostic> = [];

    if (source !== null) {
      const prepared = await this.#prepare(source, jobId);
      diagnostics = prepared.diagnostics;
      if (prepared.valid && prepared.jobs[0] !== undefined) {
        const { job, rendered } = prepared.jobs[0];
        target = { jobId: job.id, label: job.label, plistPath: rendered.plistPath };
      }
    }

    let trackedRecord: ManagedJobRecord | null;
    if (target === undefined) {
      trackedRecord = await this.#managedState.findByJobId(jobId, this.#configPath);
    } else {
      const candidate = await this.#managedState.get(target.label);
      trackedRecord =
        candidate !== null &&
        candidate.jobId === target.jobId &&
        candidate.manifestPath === this.#configPath &&
        candidate.plistPath === target.plistPath
          ? candidate
          : null;
    }
    if (target === undefined && trackedRecord !== null) {
      target = {
        jobId: trackedRecord.jobId,
        label: trackedRecord.label,
        plistPath: trackedRecord.plistPath,
      };
    }

    if (target === undefined) {
      throw new StudioError(
        `Cannot remove ${jobId}: it is neither present in the manifest nor tracked as previously applied.`,
        {
          status: 422,
          code: "job.invalid",
          details: diagnostics.length > 0 ? diagnostics : [jobNotFoundDiagnostic(jobId)],
        },
      );
    }

    const operations: ApplyOperation[] = [];
    const status = await this.#launchd.status(target.label);
    if (status.loaded === null) {
      throw new StudioError(
        status.detail ?? `Unable to determine whether ${target.label} is loaded.`,
        { status: 503, code: "runtime.status-unavailable" },
      );
    }
    if (status.loaded) {
      const result = await this.#launchd.bootout(target.label);
      if (result.exitCode !== 0) {
        return [operation(jobId, "bootout", false, commandFailureMessage(result))];
      }
      operations.push(operation(jobId, "bootout", true, "Unloaded the LaunchAgent."));
    }

    if (!keepPlist) {
      const removed = await removeFileIfExists(target.plistPath);
      operations.push(
        operation(
          jobId,
          "remove-plist",
          true,
          removed ? `Removed ${target.plistPath}.` : "The plist was already absent.",
        ),
      );
    }

    if (trackedRecord !== null) {
      await this.#managedState.remove(target.label);
      operations.push(
        operation(
          jobId,
          "untrack",
          true,
          keepPlist
            ? "Stopped managing the job; the plist was retained."
            : "Removed the managed-state record.",
        ),
      );
    }

    if (operations.length === 0) {
      operations.push(operation(jobId, "noop", true, "The job was already absent."));
    }
    return operations;
  }

  #managedRecord(job: NormalizedJob, rendered: RenderedJob): ManagedJobRecord {
    return {
      jobId: job.id,
      label: job.label,
      plistPath: rendered.plistPath,
      plistHash: hashPlist(rendered.plist),
      manifestPath: this.#configPath,
      appliedAt: new Date().toISOString(),
    };
  }

  #managedDefinitionMatches(
    job: NormalizedJob,
    rendered: RenderedJob,
    record: ManagedJobRecord | null,
  ): boolean {
    return (
      record !== null &&
      record.jobId === job.id &&
      record.label === job.label &&
      record.plistPath === rendered.plistPath &&
      record.manifestPath === this.#configPath &&
      record.plistHash === hashPlist(rendered.plist)
    );
  }

  async #prepare(
    source: string,
    jobId?: string,
  ): Promise<
    | {
        readonly valid: true;
        readonly diagnostics: ReadonlyArray<Diagnostic>;
        readonly jobs: ReadonlyArray<{ readonly job: NormalizedJob; readonly rendered: RenderedJob }>;
      }
    | { readonly valid: false; readonly diagnostics: ReadonlyArray<Diagnostic> }
  > {
    const compilation = this.#compile(source);
    if (!compilation.valid) {
      return compilation;
    }
    const selected = selectJobs(compilation.manifest, jobId);
    if (selected.diagnostics.length > 0) {
      return {
        valid: false,
        diagnostics: [...compilation.diagnostics, ...selected.diagnostics],
      };
    }
    return {
      valid: true,
      diagnostics: compilation.diagnostics,
      jobs: selected.jobs.map((job) => ({ job, rendered: renderLaunchdJob(job) })),
    };
  }

  #compile(source: string): ManifestCompilation {
    return compileManifest(source, { homeDirectory: this.#homeDirectory });
  }

  async #stageAndLint(rendered: RenderedJob): Promise<void> {
    this.#launchd.assertSupported();
    const stagingPath = `${rendered.plistPath}.launchd-studio-${process.pid}.staging.plist`;
    try {
      await writeTextAtomic(stagingPath, rendered.plist, 0o600);
      const result = await this.#launchd.lint(stagingPath);
      if (result.exitCode !== 0) {
        throw new Error(`Generated plist failed plutil validation: ${commandFailureMessage(result)}`);
      }
    } finally {
      await removeFileIfExists(stagingPath).catch(() => undefined);
    }
  }
}
