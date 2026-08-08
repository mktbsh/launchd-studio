import {
  compileManifest,
  DEFAULT_MANIFEST_SOURCE,
  explainLaunchdJob,
  formatJsonc,
  renderLaunchdJob,
} from "@launchd-studio/core";
import type {
  ApplyOperation,
  ApplyResponse,
  ControlAction,
  ControlResponse,
  DoctorResponse,
  ExplainResponse,
  FormatResponse,
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

const PREVIEW_HOME = "/Users/you";

function unsupported(feature: string): never {
  throw new Error(`${feature} is available only from the local CLI Web UI.`);
}

export class BrowserStudioTransport implements StudioTransport {
  async getCapabilities(): Promise<StudioCapabilities> {
    return {
      mode: "browser",
      manifestRead: true,
      manifestWrite: false,
      validate: true,
      format: true,
      render: true,
      explain: true,
      plan: false,
      apply: false,
      remove: false,
      status: false,
      control: false,
      logs: false,
      doctor: false,
    };
  }

  async loadManifest(): Promise<ManifestSourceResponse> {
    return {
      source: DEFAULT_MANIFEST_SOURCE,
      exists: false,
    };
  }

  async saveManifest(_source: string): Promise<SaveManifestResponse> {
    return unsupported("Saving a manifest");
  }

  async validateManifest(source: string): Promise<ValidationResponse> {
    const compilation = compileManifest(source, { homeDirectory: PREVIEW_HOME });
    return {
      valid: compilation.valid,
      diagnostics: compilation.diagnostics,
      jobIds: compilation.valid ? compilation.manifest.jobs.map((job) => job.id) : [],
    };
  }

  async formatManifest(source: string): Promise<FormatResponse> {
    const result = formatJsonc(source);
    return result.formatted === undefined
      ? { valid: false, diagnostics: result.diagnostics }
      : { valid: true, diagnostics: result.diagnostics, source: result.formatted };
  }

  async renderManifest(source: string, jobId?: string): Promise<RenderResponse> {
    const compilation = compileManifest(source, { homeDirectory: PREVIEW_HOME });
    if (!compilation.valid) {
      return { valid: false, diagnostics: compilation.diagnostics, jobs: [] };
    }
    const jobs = jobId === undefined
      ? compilation.manifest.jobs
      : compilation.manifest.jobs.filter((job) => job.id === jobId);
    if (jobId !== undefined && jobs.length === 0) {
      return {
        valid: false,
        diagnostics: [
          ...compilation.diagnostics,
          {
            severity: "error",
            code: "job.not-found",
            message: `Job ${JSON.stringify(jobId)} does not exist in this manifest.`,
            path: "$.jobs",
          },
        ],
        jobs: [],
      };
    }
    return {
      valid: true,
      diagnostics: compilation.diagnostics,
      jobs: jobs.map(renderLaunchdJob),
    };
  }

  async explainManifest(source: string, jobId?: string): Promise<ExplainResponse> {
    const compilation = compileManifest(source, { homeDirectory: PREVIEW_HOME });
    if (!compilation.valid) {
      return { valid: false, diagnostics: compilation.diagnostics, jobs: [] };
    }
    const jobs = jobId === undefined
      ? compilation.manifest.jobs
      : compilation.manifest.jobs.filter((job) => job.id === jobId);
    if (jobId !== undefined && jobs.length === 0) {
      return {
        valid: false,
        diagnostics: [
          ...compilation.diagnostics,
          {
            severity: "error",
            code: "job.not-found",
            message: `Job ${JSON.stringify(jobId)} does not exist in this manifest.`,
            path: "$.jobs",
          },
        ],
        jobs: [],
      };
    }
    return {
      valid: true,
      diagnostics: compilation.diagnostics,
      jobs: jobs.map(explainLaunchdJob),
    };
  }

  async planManifest(_source: string, _jobId?: string): Promise<PlanResponse> {
    return unsupported("Planning against local state");
  }

  async applyManifest(
    _source: string,
    _jobId?: string,
    _start?: boolean,
  ): Promise<ApplyResponse> {
    return unsupported("Applying a LaunchAgent");
  }

  async removeJob(
    _source: string,
    _jobId: string,
    _keepPlist?: boolean,
  ): Promise<ReadonlyArray<ApplyOperation>> {
    return unsupported("Removing a LaunchAgent");
  }

  async getStatus(_source: string, _jobId?: string): Promise<StatusResponse> {
    return unsupported("Reading launchd status");
  }

  async controlJob(
    _source: string,
    _jobId: string,
    _action: ControlAction,
  ): Promise<ControlResponse> {
    return unsupported("Controlling a LaunchAgent");
  }

  async getLogs(
    _source: string,
    _jobId: string,
    _stream: LogStream,
    _tail: number,
  ): Promise<LogsResponse> {
    return unsupported("Reading local logs");
  }

  async doctor(_source: string, _jobId?: string): Promise<DoctorResponse> {
    return unsupported("Running local diagnostics");
  }
}
