import {
  parseManifestJson,
  stringifyManifest,
  validateManifestValue,
  type CalendarEntryDefinition,
  type Diagnostic,
  type JobDefinition,
  type JobKind,
} from "@launchd-studio/core";
import type { JobStatusResponse } from "@launchd-studio/core/transport";

// The form UI edits this and serializes it back; $schema is carried so a round
// trip does not cost the author their editor completion.
export interface ManifestDraft {
  readonly schema?: string;
  readonly jobs: Readonly<Record<string, JobDefinition>>;
}

export interface DraftParseResult {
  readonly draft?: ManifestDraft;
  readonly diagnostics: ReadonlyArray<Diagnostic>;
}

export function parseDraft(source: string): DraftParseResult {
  const parsed = parseManifestJson(source);
  if (parsed.value === undefined) {
    return { diagnostics: parsed.diagnostics };
  }

  const validated = validateManifestValue(parsed.value);
  if (validated.manifest === undefined) {
    return { diagnostics: validated.diagnostics };
  }

  const schema = readSchema(parsed.value);
  return {
    draft: { ...(schema === undefined ? {} : { schema }), jobs: validated.manifest.jobs },
    diagnostics: validated.diagnostics,
  };
}

function readSchema(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const candidate = (value as Record<string, unknown>)["$schema"];
  return typeof candidate === "string" ? candidate : undefined;
}

export function draftToSource(draft: ManifestDraft): string {
  return stringifyManifest({
    ...(draft.schema === undefined ? {} : { $schema: draft.schema }),
    version: 1,
    jobs: draft.jobs,
  });
}

export function jobIds(draft: ManifestDraft): ReadonlyArray<string> {
  return Object.keys(draft.jobs).sort((left, right) => left.localeCompare(right));
}

export function putJob(draft: ManifestDraft, id: string, job: JobDefinition): ManifestDraft {
  return { ...draft, jobs: { ...draft.jobs, [id]: job } };
}

export function dropJob(draft: ManifestDraft, id: string): ManifestDraft {
  const { [id]: _removed, ...rest } = draft.jobs;
  return { ...draft, jobs: rest };
}

export function renameJob(draft: ManifestDraft, from: string, to: string): ManifestDraft {
  const job = draft.jobs[from];
  if (job === undefined || from === to) {
    return draft;
  }
  // Rebuild in place so the renamed job keeps its position in the file.
  const jobs = Object.fromEntries(
    Object.entries(draft.jobs).map((entry) => (entry[0] === from ? [to, job] : entry)),
  );
  return { ...draft, jobs };
}

// A staged change is a job whose definition differs from the manifest on disk.
export function changedJobIds(
  draft: ManifestDraft,
  saved: ManifestDraft,
): ReadonlyArray<string> {
  const ids = new Set([...Object.keys(draft.jobs), ...Object.keys(saved.jobs)]);
  return [...ids]
    .filter((id) => JSON.stringify(draft.jobs[id]) !== JSON.stringify(saved.jobs[id]))
    .sort((left, right) => left.localeCompare(right));
}

export const EMPTY_DRAFT: ManifestDraft = { jobs: {} };

export function newJob(kind: JobKind): JobDefinition {
  return kind === "service"
    ? { kind, command: [""], start: "login", restart: "on-failure" }
    : { kind, command: [""], schedule: { type: "calendar", entries: [{ hour: 9, minute: 0 }] } };
}

export function uniqueJobId(draft: ManifestDraft, base: string): string {
  if (draft.jobs[base] === undefined) {
    return base;
  }
  let suffix = 2;
  while (draft.jobs[`${base}-${suffix}`] !== undefined) {
    suffix += 1;
  }
  return `${base}-${suffix}`;
}

export type JobState = "running" | "idle" | "failed" | "stopped" | "unapplied";
export type Tone = "green" | "amber" | "red" | "gray" | "blue";

export function jobState(kind: JobKind, status: JobStatusResponse | undefined): JobState {
  if (status === undefined || !status.plistExists) {
    return "unapplied";
  }
  const { runtime } = status;
  if (runtime.running === true) {
    return "running";
  }
  if (runtime.lastExitCode !== undefined && runtime.lastExitCode !== 0) {
    return "failed";
  }
  if (runtime.loaded !== true) {
    return "stopped";
  }
  return kind === "task" ? "idle" : "stopped";
}

const STATE_TONE: Record<JobState, Tone> = {
  running: "green",
  idle: "blue",
  failed: "red",
  stopped: "gray",
  unapplied: "amber",
};

const STATE_LABEL: Record<JobState, string> = {
  running: "Running",
  idle: "Scheduled",
  failed: "Failed",
  stopped: "Stopped",
  unapplied: "Not installed",
};

export function stateTone(state: JobState): Tone {
  return STATE_TONE[state];
}

export function stateLabel(state: JobState): string {
  return STATE_LABEL[state];
}

export const JOB_STATES: ReadonlyArray<JobState> = [
  "running",
  "idle",
  "failed",
  "stopped",
  "unapplied",
];

export function stateDetail(state: JobState, status: JobStatusResponse | undefined): string {
  if (state === "unapplied") {
    return "Not installed yet";
  }
  const runtime = status?.runtime;
  if (runtime === undefined) {
    return "";
  }
  if (state === "running") {
    return runtime.pid === undefined ? "Running" : `Running as PID ${runtime.pid}`;
  }
  if (state === "failed") {
    return `Last run exited with code ${runtime.lastExitCode ?? "?"}`;
  }
  if (runtime.runs !== undefined && runtime.runs > 0) {
    return `${runtime.runs} ${runtime.runs === 1 ? "run" : "runs"} recorded`;
  }
  return STATE_LABEL[state];
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function timeOfDay(entry: CalendarEntryDefinition): string {
  const hour = String(entry.hour ?? 0).padStart(2, "0");
  const minute = String(entry.minute ?? 0).padStart(2, "0");
  return `${hour}:${minute}`;
}

export function scheduleSummary(job: JobDefinition): string {
  if (job.kind === "service") {
    return job.start === "manual" ? "Starts only when you start it" : "Starts at login";
  }
  const schedule = job.schedule;
  if (schedule === undefined) {
    return job.runAtLoad === true ? "Runs once at login" : "Runs only when you run it";
  }
  if (schedule.type === "interval") {
    return `Every ${schedule.every}`;
  }
  const times = schedule.entries.map((entry) =>
    entry.weekday === undefined
      ? `every day at ${timeOfDay(entry)}`
      : `every ${WEEKDAYS[entry.weekday] ?? "day"} at ${timeOfDay(entry)}`,
  );
  return times.length === 0 ? "No schedule set" : `Runs ${times.join(", ")}`;
}

export function restartSummary(job: JobDefinition): string {
  if (job.kind === "task") {
    return "Runs to completion";
  }
  return job.restart === "always"
    ? "Always restarted"
    : job.restart === "never"
      ? "Never restarted"
      : "Restarted on failure";
}
