import type {
  CalendarScheduleDefinition,
  JobDefinition,
  JobKind,
  TaskScheduleDefinition,
} from "@launchd-studio/core";

type OptionalText = "label" | "description" | "comment" | "workingDirectory";
type OptionalKey = OptionalText | "environment";

// An empty optional property is dropped rather than set to undefined: the draft
// is serialized straight to the manifest, and `"label": undefined` is not JSON.
function withOptional(job: JobDefinition, key: OptionalKey, value: unknown): JobDefinition {
  const next: Record<string, unknown> = { ...job };
  if (value === undefined) {
    delete next[key];
  } else {
    next[key] = value;
  }
  return next as unknown as JobDefinition;
}

export function withText(job: JobDefinition, key: OptionalText, text: string): JobDefinition {
  return withOptional(job, key, text.trim().length === 0 ? undefined : text);
}

export function withEnvironment(
  job: JobDefinition,
  entries: ReadonlyArray<readonly [string, string]>,
): JobDefinition {
  const kept = entries.filter(([key]) => key.trim().length > 0);
  return withOptional(job, "environment", kept.length === 0 ? undefined : Object.fromEntries(kept));
}

export type EnvironmentEntries = ReadonlyArray<readonly [string, string]>;

// launchd gives a job this PATH and nothing else, so an added directory has to
// carry the defaults with it.
const LAUNCHD_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";

function pathValue(entries: EnvironmentEntries): string {
  return entries.find(([key]) => key === "PATH")?.[1] ?? LAUNCHD_PATH;
}

export function pathHasDirectory(entries: EnvironmentEntries, directory: string): boolean {
  return pathValue(entries).split(":").includes(directory);
}

export function withPathDirectory(
  entries: EnvironmentEntries,
  directory: string,
  enabled: boolean,
): EnvironmentEntries {
  const rest = pathValue(entries)
    .split(":")
    .filter((part) => part.length > 0 && part !== directory);
  const path = (enabled ? [directory, ...rest] : rest).join(":");
  const others = entries.filter(([key]) => key !== "PATH");
  if (path.length === 0 || path === LAUNCHD_PATH) {
    return others;
  }
  return entries.some(([key]) => key === "PATH")
    ? entries.map((entry) => (entry[0] === "PATH" ? ["PATH", path] : entry))
    : [...others, ["PATH", path]];
}

const SHARED_KEYS = [
  "label",
  "description",
  "comment",
  "scope",
  "command",
  "workingDirectory",
  "environment",
  "logs",
] as const;

export function withKind(job: JobDefinition, kind: JobKind): JobDefinition {
  if (job.kind === kind) {
    return job;
  }
  const shared: Record<string, unknown> = {};
  for (const key of SHARED_KEYS) {
    if (job[key] !== undefined) {
      shared[key] = job[key];
    }
  }
  return {
    ...shared,
    ...(kind === "service"
      ? { kind, start: "login", restart: "on-failure" }
      : { kind, schedule: { type: "calendar", entries: [{ hour: 9, minute: 0 }] } }),
  } as JobDefinition;
}

export function withSchedule(job: JobDefinition, schedule: TaskScheduleDefinition): JobDefinition {
  return job.kind === "task" ? { ...job, schedule } : job;
}

export const DEFAULT_CALENDAR: CalendarScheduleDefinition = {
  type: "calendar",
  entries: [{ hour: 9, minute: 0 }],
};

export interface IntervalParts {
  readonly amount: number;
  readonly unit: "m" | "h" | "d";
}

// A duration may be compound ("1h30m"); only the simple form gets the stepper.
export function parseInterval(every: string): IntervalParts | undefined {
  const match = /^(\d+)([mhd])$/u.exec(every);
  if (match?.[1] === undefined || match[2] === undefined) {
    return undefined;
  }
  return { amount: Number.parseInt(match[1], 10), unit: match[2] as IntervalParts["unit"] };
}
