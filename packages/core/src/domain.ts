export type DiagnosticSeverity = "error" | "warning";

export interface Diagnostic {
  readonly severity: DiagnosticSeverity;
  readonly code: string;
  readonly message: string;
  readonly path: string;
  readonly offset?: number;
  readonly length?: number;
  readonly line?: number;
  readonly column?: number;
}

export type JobKind = "service" | "task";
export type JobScope = "user";
export type ServiceStart = "login" | "manual";
export type RestartPolicy = "never" | "on-failure" | "always";

export interface LogDefinition {
  readonly stdout?: string;
  readonly stderr?: string;
}

export interface CalendarEntryDefinition {
  readonly minute?: number;
  readonly hour?: number;
  readonly day?: number;
  readonly weekday?: number;
  readonly month?: number;
}

export interface IntervalScheduleDefinition {
  readonly type: "interval";
  readonly every: string;
}

export interface CalendarScheduleDefinition {
  readonly type: "calendar";
  readonly entries: ReadonlyArray<CalendarEntryDefinition>;
}

export type TaskScheduleDefinition =
  | IntervalScheduleDefinition
  | CalendarScheduleDefinition;

export interface BaseJobDefinition {
  readonly kind: JobKind;
  readonly label?: string;
  readonly description?: string;
  readonly comment?: string;
  readonly scope?: JobScope;
  readonly command: ReadonlyArray<string>;
  readonly workingDirectory?: string;
  readonly environment?: Readonly<Record<string, string>>;
  readonly logs?: LogDefinition;
}

export interface ServiceJobDefinition extends BaseJobDefinition {
  readonly kind: "service";
  readonly start?: ServiceStart;
  readonly restart?: RestartPolicy;
  readonly throttleIntervalSeconds?: number;
}

export interface TaskJobDefinition extends BaseJobDefinition {
  readonly kind: "task";
  readonly runAtLoad?: boolean;
  readonly schedule?: TaskScheduleDefinition;
}

export type JobDefinition = ServiceJobDefinition | TaskJobDefinition;

export interface ManifestV1 {
  readonly version: 1;
  readonly jobs: Readonly<Record<string, JobDefinition>>;
}

export interface NormalizeContext {
  readonly homeDirectory: string;
}

export interface NormalizedLogPaths {
  readonly stdout: string;
  readonly stderr: string;
}

export interface NormalizedBaseJob {
  readonly id: string;
  readonly kind: JobKind;
  readonly label: string;
  readonly description?: string;
  readonly comment?: string;
  readonly scope: "user";
  readonly command: readonly [string, ...string[]];
  readonly workingDirectory?: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly logs: NormalizedLogPaths;
  readonly plistPath: string;
}

export interface NormalizedServiceJob extends NormalizedBaseJob {
  readonly kind: "service";
  readonly start: ServiceStart;
  readonly restart: RestartPolicy;
  readonly throttleIntervalSeconds: number;
}

export interface NormalizedIntervalSchedule {
  readonly type: "interval";
  readonly everySeconds: number;
  readonly source: string;
}

export interface NormalizedCalendarSchedule {
  readonly type: "calendar";
  readonly entries: ReadonlyArray<CalendarEntryDefinition>;
}

export type NormalizedTaskSchedule =
  | NormalizedIntervalSchedule
  | NormalizedCalendarSchedule;

export interface NormalizedTaskJob extends NormalizedBaseJob {
  readonly kind: "task";
  readonly runAtLoad: boolean;
  readonly schedule?: NormalizedTaskSchedule;
}

export type NormalizedJob = NormalizedServiceJob | NormalizedTaskJob;

export interface NormalizedManifest {
  readonly version: 1;
  readonly jobs: ReadonlyArray<NormalizedJob>;
}

export type ManifestCompilation =
  | {
      readonly valid: true;
      readonly manifest: NormalizedManifest;
      readonly diagnostics: ReadonlyArray<Diagnostic>;
    }
  | {
      readonly valid: false;
      readonly diagnostics: ReadonlyArray<Diagnostic>;
    };

export interface RenderedJob {
  readonly id: string;
  readonly label: string;
  readonly kind: JobKind;
  readonly plistPath: string;
  readonly plist: string;
}

export interface RuntimeJobStatus {
  readonly supported: boolean;
  readonly loaded: boolean | null;
  readonly running: boolean | null;
  readonly state?: string;
  readonly pid?: number;
  readonly runs?: number;
  readonly lastExitCode?: number;
  readonly detail?: string;
}

export interface ActualJobState {
  readonly fileContent: string | null;
  readonly runtime: RuntimeJobStatus;
  readonly runtimeDefinitionMatches: boolean | null;
}

export type FilePlanAction = "none" | "create" | "update";
export type RuntimePlanAction = "none" | "load" | "reload" | "unavailable";

export interface JobPlan {
  readonly id: string;
  readonly label: string;
  readonly plistPath: string;
  readonly fileAction: FilePlanAction;
  readonly runtimeAction: RuntimePlanAction;
  readonly changed: boolean;
  readonly runtime: RuntimeJobStatus;
  readonly runtimeDefinitionMatches: boolean | null;
}

export interface PlanSummary {
  readonly create: number;
  readonly update: number;
  readonly load: number;
  readonly reload: number;
  readonly unchanged: number;
}

export interface ManifestPlan {
  readonly jobs: ReadonlyArray<JobPlan>;
  readonly summary: PlanSummary;
}

export interface ExplanationEntry {
  readonly source: string;
  readonly target: string;
  readonly value: string;
  readonly note?: string;
}

export interface JobExplanation {
  readonly id: string;
  readonly label: string;
  readonly kind: JobKind;
  readonly plistPath: string;
  readonly entries: ReadonlyArray<ExplanationEntry>;
  readonly portability: "launchd-user-agent";
}

export type DoctorCheckStatus = "pass" | "warning" | "fail" | "skipped";

export interface DoctorCheck {
  readonly id: string;
  readonly status: DoctorCheckStatus;
  readonly message: string;
  readonly detail?: string;
}

export interface JobDoctorReport {
  readonly jobId: string;
  readonly label: string;
  readonly checks: ReadonlyArray<DoctorCheck>;
}
