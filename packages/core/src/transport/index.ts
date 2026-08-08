import type {
  Diagnostic,
  JobDoctorReport,
  JobExplanation,
  ManifestPlan,
  RenderedJob,
  RuntimeJobStatus,
} from "../domain";

export interface StudioCapabilities {
  readonly mode: "browser" | "local";
  readonly manifestRead: boolean;
  readonly manifestWrite: boolean;
  readonly validate: true;
  readonly format: true;
  readonly render: true;
  readonly explain: true;
  readonly plan: boolean;
  readonly apply: boolean;
  readonly remove: boolean;
  readonly status: boolean;
  readonly control: boolean;
  readonly logs: boolean;
  readonly doctor: boolean;
}

export interface ManifestSourceResponse {
  readonly source: string;
  readonly path?: string;
  readonly exists: boolean;
}

export interface SaveManifestResponse {
  readonly path: string;
  readonly bytesWritten: number;
}

export interface ValidationResponse {
  readonly valid: boolean;
  readonly diagnostics: ReadonlyArray<Diagnostic>;
  readonly jobIds: ReadonlyArray<string>;
}

export interface FormatResponse {
  readonly valid: boolean;
  readonly diagnostics: ReadonlyArray<Diagnostic>;
  readonly source?: string;
}

export interface RenderResponse {
  readonly valid: boolean;
  readonly diagnostics: ReadonlyArray<Diagnostic>;
  readonly jobs: ReadonlyArray<RenderedJob>;
}

export interface ExplainResponse {
  readonly valid: boolean;
  readonly diagnostics: ReadonlyArray<Diagnostic>;
  readonly jobs: ReadonlyArray<JobExplanation>;
}

export interface PlanResponse {
  readonly valid: boolean;
  readonly diagnostics: ReadonlyArray<Diagnostic>;
  readonly plan?: ManifestPlan;
}

export interface ApplyOperation {
  readonly jobId: string;
  readonly action: string;
  readonly success: boolean;
  readonly message: string;
}

export interface ApplyResponse {
  readonly valid: boolean;
  readonly diagnostics: ReadonlyArray<Diagnostic>;
  readonly plan?: ManifestPlan;
  readonly operations: ReadonlyArray<ApplyOperation>;
}

export interface JobStatusResponse {
  readonly jobId: string;
  readonly label: string;
  readonly plistPath: string;
  readonly plistExists: boolean;
  readonly drifted: boolean | null;
  readonly runtimeDefinitionDrifted: boolean | null;
  readonly runtime: RuntimeJobStatus;
}

export interface StatusResponse {
  readonly valid: boolean;
  readonly diagnostics: ReadonlyArray<Diagnostic>;
  readonly jobs: ReadonlyArray<JobStatusResponse>;
}

export type ControlAction = "start" | "stop" | "restart";

export interface ControlResponse {
  readonly jobId: string;
  readonly action: ControlAction;
  readonly success: boolean;
  readonly message: string;
  readonly status?: RuntimeJobStatus;
}

export type LogStream = "stdout" | "stderr";

export interface LogsResponse {
  readonly jobId: string;
  readonly stream: LogStream;
  readonly path: string;
  readonly exists: boolean;
  readonly content: string;
  readonly truncated: boolean;
}

export interface DoctorResponse {
  readonly valid: boolean;
  readonly diagnostics: ReadonlyArray<Diagnostic>;
  readonly reports: ReadonlyArray<JobDoctorReport>;
}

export interface StudioTransport {
  getCapabilities(): Promise<StudioCapabilities>;
  loadManifest(): Promise<ManifestSourceResponse>;
  saveManifest(source: string): Promise<SaveManifestResponse>;
  validateManifest(source: string): Promise<ValidationResponse>;
  formatManifest(source: string): Promise<FormatResponse>;
  renderManifest(source: string, jobId?: string): Promise<RenderResponse>;
  explainManifest(source: string, jobId?: string): Promise<ExplainResponse>;
  planManifest(source: string, jobId?: string): Promise<PlanResponse>;
  applyManifest(source: string, jobId?: string, start?: boolean): Promise<ApplyResponse>;
  removeJob(
    source: string,
    jobId: string,
    keepPlist?: boolean,
  ): Promise<ReadonlyArray<ApplyOperation>>;
  getStatus(source: string, jobId?: string): Promise<StatusResponse>;
  controlJob(
    source: string,
    jobId: string,
    action: ControlAction,
  ): Promise<ControlResponse>;
  getLogs(
    source: string,
    jobId: string,
    stream: LogStream,
    tail: number,
  ): Promise<LogsResponse>;
  doctor(source: string, jobId?: string): Promise<DoctorResponse>;
}
