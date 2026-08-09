#!/usr/bin/env bun

import { dirname, join, resolve } from "node:path";
import { DEFAULT_MANIFEST_SOURCE } from "@launchd-studio/core";
import manifestSchema from "../../../schemas/manifest.schema.json";
import {
  booleanOption,
  integerOption,
  parseCliArgs,
  stringOption,
} from "./commands/args";
import {
  printDiagnostics,
  printDoctorReports,
  printExplanations,
  printJson,
  printLogs,
  printOperations,
  printPlan,
  printRenderedJobs,
  printStatuses,
} from "./commands/output";
import {
  ensureDirectory,
  pathExists,
  readTextIfExists,
  writeTextAtomic,
} from "./adapters/filesystem";
import { defaultTokenPath, readOrCreateToken } from "./adapters/state";
import { DEFAULT_WEB_UI_PORT, LocalStudioService, StudioError } from "./service";
import { startWebUiServer } from "./server/server";
import packageMetadata from "../package.json";

const VERSION = packageMetadata.version;
const SCHEMA_FILENAME = "launchd-studio.schema.json";

const HELP = `launchd-studio ${VERSION}

Intent-based JSON management for macOS user LaunchAgents.

Usage:
  launchd-studio <command> [arguments] [options]

Commands:
  init [path]                 Create a starter JSON manifest
  validate                    Validate syntax and job semantics
  format                      Format the manifest; use --write to save
  render [job]                Render generated launchd plist XML
  explain [job]               Explain manifest-to-launchd mappings
  plan [job]                  Compare manifest, plist files, and launchd state
  apply [job]                 Write and register LaunchAgents
  remove <job>                Unload a job and remove its generated plist
  status [job]                Show file drift and runtime state
  start <job>                 Load and start an applied job
  stop <job>                  Unload a job so KeepAlive cannot restart it
  restart <job>               Restart an applied job
  logs <job>                  Show configured stdout or stderr logs
  doctor [job]                Diagnose paths, permissions, drift, and runtime state
  web-ui                      Start the local Web UI and API
  version                     Print the version
  help                        Show this help

Common options:
  -c, --config <path>         Manifest path; searched upward when omitted
      --json                  Print machine-readable JSON
  -j, --job <id>              Select a job instead of using a positional ID

Command options:
  init --force
  format --write
  render -o, --output <dir>
  apply --dry-run --start
  remove --keep-plist
  logs --stream <stdout|stderr> --tail <lines> --follow
  web-ui --host <host> --port <port> --no-open --allow-remote

Environment:
  LAUNCHD_STUDIO_PORT         Web UI port; --port wins, 0 picks a free one
`;

function resolveWebUiPort(option: string | undefined): number {
  const raw = option ?? process.env.LAUNCHD_STUDIO_PORT;
  if (raw === undefined) {
    return DEFAULT_WEB_UI_PORT;
  }
  const port = /^\d+$/u.test(raw.trim()) ? Number.parseInt(raw.trim(), 10) : Number.NaN;
  if (!Number.isInteger(port) || port > 65_535) {
    throw new StudioError(
      `${option === undefined ? "LAUNCHD_STUDIO_PORT" : "--port"} must be between 0 and 65535.`,
      { code: "cli.invalid-port" },
    );
  }
  return port;
}

async function findConfigPath(explicitPath?: string): Promise<string> {
  if (explicitPath !== undefined) {
    return resolve(explicitPath);
  }

  let directory = process.cwd();
  while (true) {
    for (const filename of ["launchd-studio.json", ".launchd-studio.json"]) {
      const candidate = join(directory, filename);
      if (await pathExists(candidate)) {
        return candidate;
      }
    }
    const parent = dirname(directory);
    if (parent === directory) {
      return resolve(process.cwd(), "launchd-studio.json");
    }
    directory = parent;
  }
}

async function requireSource(service: LocalStudioService): Promise<string> {
  const manifest = await service.loadManifest();
  if (!manifest.exists) {
    throw new StudioError(`Manifest not found: ${service.configPath}. Run launchd-studio init.`, {
      status: 404,
      code: "manifest.not-found",
    });
  }
  return manifest.source;
}

function selectedJob(
  positionals: ReadonlyArray<string>,
  options: Readonly<Record<string, string | boolean>>,
): string | undefined {
  return stringOption(options, "job") ?? positionals[0];
}

async function followLogFile(path: string, tail: number): Promise<number> {
  const processHandle = Bun.spawn(["/usr/bin/tail", "-n", String(tail), "-F", path], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  return processHandle.exited;
}

async function run(): Promise<number> {
  const rawArguments = Bun.argv.slice(2);
  if (rawArguments.length === 0 || rawArguments[0] === "--help" || rawArguments[0] === "-h") {
    console.log(HELP);
    return 0;
  }
  if (rawArguments[0] === "--version" || rawArguments[0] === "-v") {
    console.log(VERSION);
    return 0;
  }

  const invocation = parseCliArgs(rawArguments);
  if (booleanOption(invocation.options, "help")) {
    console.log(HELP);
    return 0;
  }
  if (booleanOption(invocation.options, "version")) {
    console.log(VERSION);
    return 0;
  }
  const json = booleanOption(invocation.options, "json");
  const configPath = await findConfigPath(stringOption(invocation.options, "config"));
  const webUiPort = resolveWebUiPort(stringOption(invocation.options, "port"));
  const service = new LocalStudioService({
    configPath,
    // A random bind port cannot be baked into the always-on job.
    webUiPort: webUiPort === 0 ? DEFAULT_WEB_UI_PORT : webUiPort,
  });

  switch (invocation.command) {
    case "help": {
      console.log(HELP);
      return 0;
    }
    case "version": {
      console.log(VERSION);
      return 0;
    }
    case "init": {
      const destination = resolve(invocation.positionals[0] ?? configPath);
      if ((await pathExists(destination)) && !booleanOption(invocation.options, "force")) {
        throw new StudioError(`Refusing to overwrite ${destination}; use --force.`, {
          status: 409,
          code: "manifest.exists",
        });
      }
      const destinationService = new LocalStudioService({ configPath: destination });
      const saved = await destinationService.saveManifest(DEFAULT_MANIFEST_SOURCE);
      const schemaPath = join(dirname(destination), SCHEMA_FILENAME);
      const schemaWritten =
        booleanOption(invocation.options, "force") || !(await pathExists(schemaPath));
      if (schemaWritten) {
        await writeTextAtomic(schemaPath, `${JSON.stringify(manifestSchema, null, 2)}\n`, 0o644);
      }
      if (json) {
        printJson({ ...saved, schemaPath, schemaWritten });
      } else {
        console.log(`Created ${saved.path}`);
        console.log(`${schemaWritten ? "Created" : "Using existing"} ${schemaPath}`);
      }
      return 0;
    }
    case "validate": {
      const source = await requireSource(service);
      const result = await service.validateManifest(source);
      if (json) {
        printJson(result);
      } else {
        printDiagnostics(result.diagnostics);
        console.log(result.valid ? `Valid manifest with ${result.jobIds.length} job(s).` : "Manifest is invalid.");
      }
      return result.valid ? 0 : 1;
    }
    case "format": {
      const source = await requireSource(service);
      const result = await service.formatManifest(source);
      if (!result.valid || result.source === undefined) {
        if (json) {
          printJson(result);
        } else {
          printDiagnostics(result.diagnostics);
        }
        return 1;
      }
      if (booleanOption(invocation.options, "write")) {
        const saved = await service.saveManifest(result.source);
        if (json) {
          printJson(saved);
        } else {
          console.log(`Formatted ${saved.path}`);
        }
      } else if (json) {
        printJson(result);
      } else {
        process.stdout.write(result.source);
      }
      return 0;
    }
    case "render": {
      const source = await requireSource(service);
      const result = await service.renderManifest(source, selectedJob(invocation.positionals, invocation.options));
      if (!result.valid) {
        if (json) {
          printJson(result);
        } else {
          printDiagnostics(result.diagnostics);
        }
        return 1;
      }
      const output = stringOption(invocation.options, "output");
      if (output !== undefined) {
        const outputDirectory = resolve(output);
        await ensureDirectory(outputDirectory);
        const files: string[] = [];
        for (const job of result.jobs) {
          const path = join(outputDirectory, `${job.label}.plist`);
          await writeTextAtomic(path, job.plist, 0o644);
          files.push(path);
        }
        if (json) {
          printJson({ files });
        } else {
          for (const file of files) {
            console.log(file);
          }
        }
      } else if (json) {
        printJson(result);
      } else {
        printRenderedJobs(result.jobs);
      }
      return 0;
    }
    case "explain": {
      const source = await requireSource(service);
      const result = await service.explainManifest(source, selectedJob(invocation.positionals, invocation.options));
      if (json) {
        printJson(result);
      } else {
        printDiagnostics(result.diagnostics);
        printExplanations(result.jobs);
      }
      return result.valid ? 0 : 1;
    }
    case "plan": {
      const source = await requireSource(service);
      const result = await service.planManifest(source, selectedJob(invocation.positionals, invocation.options));
      if (json) {
        printJson(result);
      } else {
        printDiagnostics(result.diagnostics);
        if (result.plan !== undefined) {
          printPlan(result.plan);
        }
      }
      return result.valid ? 0 : 1;
    }
    case "apply": {
      const source = await requireSource(service);
      const jobId = selectedJob(invocation.positionals, invocation.options);
      if (booleanOption(invocation.options, "dry-run")) {
        const result = await service.planManifest(source, jobId);
        if (json) {
          printJson(result);
        } else if (result.plan !== undefined) {
          printDiagnostics(result.diagnostics);
          printPlan(result.plan);
        }
        return result.valid ? 0 : 1;
      }
      const result = await service.applyManifest(
        source,
        jobId,
        booleanOption(invocation.options, "start"),
      );
      if (json) {
        printJson(result);
      } else {
        printDiagnostics(result.diagnostics);
        printOperations(result.operations);
      }
      return result.valid ? 0 : 1;
    }
    case "remove": {
      const source = await readTextIfExists(service.configPath);
      const jobId = selectedJob(invocation.positionals, invocation.options);
      if (jobId === undefined) {
        throw new StudioError("remove requires a job ID.", {
          code: "cli.missing-job",
        });
      }
      const result = await service.removeJob(
        source,
        jobId,
        booleanOption(invocation.options, "keep-plist"),
      );
      if (json) {
        printJson(result);
      } else {
        printOperations(result);
      }
      return result.every((entry) => entry.success) ? 0 : 1;
    }
    case "status": {
      const source = await requireSource(service);
      const result = await service.getStatus(source, selectedJob(invocation.positionals, invocation.options));
      if (json) {
        printJson(result);
      } else {
        printDiagnostics(result.diagnostics);
        printStatuses(result.jobs);
      }
      return result.valid ? 0 : 1;
    }
    case "start":
    case "stop":
    case "restart": {
      const source = await requireSource(service);
      const jobId = selectedJob(invocation.positionals, invocation.options);
      if (jobId === undefined) {
        throw new StudioError(`${invocation.command} requires a job ID.`, {
          code: "cli.missing-job",
        });
      }
      const result = await service.controlJob(source, jobId, invocation.command);
      if (json) {
        printJson(result);
      } else {
        console.log(`${result.success ? "ok" : "failed"} ${result.message}`);
      }
      return result.success ? 0 : 1;
    }
    case "logs": {
      const source = await requireSource(service);
      const jobId = selectedJob(invocation.positionals, invocation.options);
      if (jobId === undefined) {
        throw new StudioError("logs requires a job ID.", { code: "cli.missing-job" });
      }
      const stream = stringOption(invocation.options, "stream") ?? "stdout";
      if (stream !== "stdout" && stream !== "stderr") {
        throw new StudioError("--stream must be stdout or stderr.", {
          code: "cli.invalid-stream",
        });
      }
      const tail = integerOption(invocation.options, "tail", 200);
      if (tail < 1 || tail > 10_000) {
        throw new StudioError("--tail must be between 1 and 10000.", {
          code: "cli.invalid-tail",
        });
      }
      const result = await service.getLogs(source, jobId, stream, tail);
      if (json) {
        printJson(result);
        return 0;
      }
      printLogs(result);
      if (booleanOption(invocation.options, "follow")) {
        return followLogFile(result.path, tail);
      }
      return 0;
    }
    case "doctor": {
      const source = await requireSource(service);
      const result = await service.doctor(source, selectedJob(invocation.positionals, invocation.options));
      if (json) {
        printJson(result);
      } else {
        printDiagnostics(result.diagnostics);
        printDoctorReports(result.reports);
      }
      return result.valid ? 0 : 1;
    }
    case "web-ui": {
      const host = stringOption(invocation.options, "host") ?? "127.0.0.1";
      const server = startWebUiServer({
        transport: service,
        host,
        port: webUiPort,
        token: await readOrCreateToken(defaultTokenPath(service.homeDirectory)),
        openBrowser: booleanOption(invocation.options, "open", true),
        allowRemote: booleanOption(invocation.options, "allow-remote"),
      });
      console.log(`Web UI: ${server.url}`);
      console.log(`Manifest: ${service.configPath}`);
      await new Promise<void>((resolveSignal) => {
        const stop = (): void => resolveSignal();
        process.once("SIGINT", stop);
        process.once("SIGTERM", stop);
      });
      server.stop();
      return 0;
    }
    default:
      throw new StudioError(`Unknown command ${JSON.stringify(invocation.command)}.\n\n${HELP}`, {
        code: "cli.unknown-command",
      });
  }
}

try {
  const exitCode = await run();
  process.exitCode = exitCode;
} catch (error) {
  if (error instanceof StudioError) {
    console.error(error.message);
    if (Array.isArray(error.details)) {
      printDiagnostics(error.details);
    }
  } else {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  }
  process.exitCode = 1;
}
