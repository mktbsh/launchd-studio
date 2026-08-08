import type {
  CalendarEntryDefinition,
  CalendarScheduleDefinition,
  Diagnostic,
  IntervalScheduleDefinition,
  JobDefinition,
  LogDefinition,
  ManifestV1,
  ServiceJobDefinition,
  TaskJobDefinition,
  TaskScheduleDefinition,
} from "../domain";
import { isValidXmlText } from "../text";
import { parseDurationSeconds } from "./duration";
import {
  deriveLabel,
  ENVIRONMENT_KEY_PATTERN,
  isAbsoluteOrHomePath,
  JOB_ID_PATTERN,
  LABEL_PATTERN,
} from "./naming";

export interface ManifestValidationResult {
  readonly manifest?: ManifestV1;
  readonly diagnostics: ReadonlyArray<Diagnostic>;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function addDiagnostic(
  diagnostics: Diagnostic[],
  severity: "error" | "warning",
  code: string,
  message: string,
  path: string,
): void {
  diagnostics.push({ severity, code, message, path });
}

function checkUnknownKeys(
  value: UnknownRecord,
  allowedKeys: ReadonlySet<string>,
  path: string,
  diagnostics: Diagnostic[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      addDiagnostic(
        diagnostics,
        "error",
        "manifest.unknown-key",
        `Unknown property ${JSON.stringify(key)}.`,
        `${path}.${key}`,
      );
    }
  }
}

function readOptionalString(
  value: UnknownRecord,
  key: string,
  path: string,
  diagnostics: Diagnostic[],
): string | undefined {
  const candidate = value[key];
  if (candidate === undefined) {
    return undefined;
  }
  if (typeof candidate !== "string") {
    addDiagnostic(
      diagnostics,
      "error",
      "manifest.type",
      `${key} must be a string.`,
      `${path}.${key}`,
    );
    return undefined;
  }
  return candidate;
}

function validateCommand(
  value: unknown,
  path: string,
  diagnostics: Diagnostic[],
): ReadonlyArray<string> | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    addDiagnostic(
      diagnostics,
      "error",
      "job.command",
      "command must be a non-empty argv array.",
      path,
    );
    return undefined;
  }

  const command: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const argument = value[index];
    if (typeof argument !== "string" || !isValidXmlText(argument)) {
      addDiagnostic(
        diagnostics,
        "error",
        "job.command-argument",
        "Every command argument must be a string containing only valid XML text characters.",
        `${path}[${index}]`,
      );
      continue;
    }
    command.push(argument);
  }

  const executable = command[0];
  if (executable !== undefined && !isAbsoluteOrHomePath(executable)) {
    addDiagnostic(
      diagnostics,
      "error",
      "job.executable-path",
      "The executable must use an absolute path or a ~/ path. launchd does not inherit your interactive shell PATH.",
      `${path}[0]`,
    );
  }

  return command.length === value.length ? command : undefined;
}

function validateEnvironment(
  value: unknown,
  path: string,
  diagnostics: Diagnostic[],
): Readonly<Record<string, string>> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    addDiagnostic(
      diagnostics,
      "error",
      "job.environment",
      "environment must be an object containing string values.",
      path,
    );
    return undefined;
  }

  const environment: Record<string, string> = {};
  for (const [key, candidate] of Object.entries(value)) {
    if (!ENVIRONMENT_KEY_PATTERN.test(key)) {
      addDiagnostic(
        diagnostics,
        "error",
        "job.environment-key",
        `Invalid environment variable name ${JSON.stringify(key)}.`,
        `${path}.${key}`,
      );
      continue;
    }
    if (typeof candidate !== "string" || !isValidXmlText(candidate)) {
      addDiagnostic(
        diagnostics,
        "error",
        "job.environment-value",
        "Environment variable values must be strings containing only valid XML text characters.",
        `${path}.${key}`,
      );
      continue;
    }
    environment[key] = candidate;
  }

  return environment;
}

function validatePathValue(
  value: unknown,
  path: string,
  diagnostics: Diagnostic[],
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || !isAbsoluteOrHomePath(value) || !isValidXmlText(value)) {
    addDiagnostic(
      diagnostics,
      "error",
      "job.path",
      "Path must be an absolute path or begin with ~/ and contain only valid XML text characters.",
      path,
    );
    return undefined;
  }
  return value;
}

function validateLogs(
  value: unknown,
  path: string,
  diagnostics: Diagnostic[],
): LogDefinition | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    addDiagnostic(diagnostics, "error", "job.logs", "logs must be an object.", path);
    return undefined;
  }

  checkUnknownKeys(value, new Set(["stdout", "stderr"]), path, diagnostics);
  const stdout = validatePathValue(value.stdout, `${path}.stdout`, diagnostics);
  const stderr = validatePathValue(value.stderr, `${path}.stderr`, diagnostics);
  return {
    ...(stdout !== undefined ? { stdout } : {}),
    ...(stderr !== undefined ? { stderr } : {}),
  };
}

function validateCalendarEntry(
  value: unknown,
  path: string,
  diagnostics: Diagnostic[],
): CalendarEntryDefinition | undefined {
  if (!isRecord(value)) {
    addDiagnostic(
      diagnostics,
      "error",
      "task.calendar-entry",
      "Each calendar entry must be an object.",
      path,
    );
    return undefined;
  }

  const ranges: Readonly<Record<string, readonly [number, number]>> = {
    minute: [0, 59],
    hour: [0, 23],
    day: [1, 31],
    weekday: [0, 7],
    month: [1, 12],
  };
  checkUnknownKeys(value, new Set(Object.keys(ranges)), path, diagnostics);

  const entry: Record<string, number> = {};
  for (const [key, [minimum, maximum]] of Object.entries(ranges)) {
    const candidate = value[key];
    if (candidate === undefined) {
      continue;
    }
    if (!Number.isInteger(candidate) || (candidate as number) < minimum || (candidate as number) > maximum) {
      addDiagnostic(
        diagnostics,
        "error",
        "task.calendar-range",
        `${key} must be an integer between ${minimum} and ${maximum}.`,
        `${path}.${key}`,
      );
      continue;
    }
    entry[key] = candidate as number;
  }

  if (Object.keys(entry).length === 0) {
    addDiagnostic(
      diagnostics,
      "error",
      "task.calendar-empty",
      "A calendar entry must specify at least one calendar field.",
      path,
    );
    return undefined;
  }

  return entry;
}

function validateSchedule(
  value: unknown,
  path: string,
  diagnostics: Diagnostic[],
): TaskScheduleDefinition | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    addDiagnostic(diagnostics, "error", "task.schedule", "schedule must be an object.", path);
    return undefined;
  }

  if (value.type === "interval") {
    checkUnknownKeys(value, new Set(["type", "every"]), path, diagnostics);
    if (typeof value.every !== "string") {
      addDiagnostic(
        diagnostics,
        "error",
        "task.interval",
        "An interval schedule requires a duration string such as 15m or 1h30m.",
        `${path}.every`,
      );
      return undefined;
    }
    const seconds = parseDurationSeconds(value.every);
    if (seconds === null) {
      addDiagnostic(
        diagnostics,
        "error",
        "task.interval-format",
        "Invalid duration. Use integer segments with s, m, h, or d units, for example 30s, 15m, or 1h30m.",
        `${path}.every`,
      );
      return undefined;
    }
    if (seconds < 10) {
      addDiagnostic(
        diagnostics,
        "error",
        "task.interval-minimum",
        "Intervals shorter than 10 seconds are rejected to avoid accidental launch loops.",
        `${path}.every`,
      );
      return undefined;
    }
    if (seconds > 2_147_483_647) {
      addDiagnostic(
        diagnostics,
        "error",
        "task.interval-maximum",
        "The interval exceeds launchd's supported integer range.",
        `${path}.every`,
      );
      return undefined;
    }
    const schedule: IntervalScheduleDefinition = {
      type: "interval",
      every: value.every,
    };
    return schedule;
  }

  if (value.type === "calendar") {
    checkUnknownKeys(value, new Set(["type", "entries"]), path, diagnostics);
    if (!Array.isArray(value.entries) || value.entries.length === 0) {
      addDiagnostic(
        diagnostics,
        "error",
        "task.calendar",
        "A calendar schedule requires at least one entry.",
        `${path}.entries`,
      );
      return undefined;
    }
    const entries: CalendarEntryDefinition[] = [];
    for (let index = 0; index < value.entries.length; index += 1) {
      const entry = validateCalendarEntry(value.entries[index], `${path}.entries[${index}]`, diagnostics);
      if (entry !== undefined) {
        entries.push(entry);
      }
    }
    if (entries.length !== value.entries.length) {
      return undefined;
    }
    const schedule: CalendarScheduleDefinition = {
      type: "calendar",
      entries,
    };
    return schedule;
  }

  addDiagnostic(
    diagnostics,
    "error",
    "task.schedule-type",
    'schedule.type must be "interval" or "calendar".',
    `${path}.type`,
  );
  return undefined;
}

function validateJob(
  jobId: string,
  value: unknown,
  path: string,
  diagnostics: Diagnostic[],
): JobDefinition | undefined {
  if (!isRecord(value)) {
    addDiagnostic(diagnostics, "error", "job.type", "A job must be an object.", path);
    return undefined;
  }

  const commonKeys = [
    "kind",
    "label",
    "description",
    "comment",
    "scope",
    "command",
    "workingDirectory",
    "environment",
    "logs",
  ];

  if (value.kind !== "service" && value.kind !== "task") {
    addDiagnostic(
      diagnostics,
      "error",
      "job.kind",
      'kind must be "service" or "task".',
      `${path}.kind`,
    );
    return undefined;
  }

  const kind = value.kind;
  const allowedKeys = new Set([
    ...commonKeys,
    ...(kind === "service"
      ? ["start", "restart", "throttleIntervalSeconds"]
      : ["runAtLoad", "schedule"]),
  ]);
  checkUnknownKeys(value, allowedKeys, path, diagnostics);

  const label = readOptionalString(value, "label", path, diagnostics);
  if (label !== undefined && !LABEL_PATTERN.test(label)) {
    addDiagnostic(
      diagnostics,
      "error",
      "job.label",
      "label may contain only letters, digits, dots, underscores, and hyphens.",
      `${path}.label`,
    );
  }
  const effectiveLabel = label ?? deriveLabel(jobId);
  if (!effectiveLabel.includes(".")) {
    addDiagnostic(
      diagnostics,
      "warning",
      "job.label-convention",
      "A reverse-DNS-style label is recommended to avoid collisions.",
      `${path}.label`,
    );
  }

  const description = readOptionalString(value, "description", path, diagnostics);
  const comment = readOptionalString(value, "comment", path, diagnostics);
  if (value.scope !== undefined && value.scope !== "user") {
    addDiagnostic(
      diagnostics,
      "error",
      "job.scope",
      'v0.1 supports only scope: "user" LaunchAgents.',
      `${path}.scope`,
    );
  }
  const command = validateCommand(value.command, `${path}.command`, diagnostics);
  const workingDirectory = validatePathValue(
    value.workingDirectory,
    `${path}.workingDirectory`,
    diagnostics,
  );
  const environment = validateEnvironment(value.environment, `${path}.environment`, diagnostics);
  const logs = validateLogs(value.logs, `${path}.logs`, diagnostics);

  if (command === undefined) {
    return undefined;
  }

  const base = {
    kind,
    ...(label !== undefined ? { label } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(comment !== undefined ? { comment } : {}),
    ...(value.scope !== undefined ? { scope: "user" as const } : {}),
    command,
    ...(workingDirectory !== undefined ? { workingDirectory } : {}),
    ...(environment !== undefined ? { environment } : {}),
    ...(logs !== undefined ? { logs } : {}),
  };

  if (kind === "service") {
    const start = value.start;
    if (start !== undefined && start !== "login" && start !== "manual") {
      addDiagnostic(
        diagnostics,
        "error",
        "service.start",
        'start must be "login" or "manual".',
        `${path}.start`,
      );
    }
    const restart = value.restart;
    if (restart !== undefined && restart !== "never" && restart !== "on-failure" && restart !== "always") {
      addDiagnostic(
        diagnostics,
        "error",
        "service.restart",
        'restart must be "never", "on-failure", or "always".',
        `${path}.restart`,
      );
    }
    const effectiveRestart =
      restart === "never" || restart === "on-failure" || restart === "always"
        ? restart
        : "on-failure";
    if (start === "manual" && effectiveRestart !== "never") {
      addDiagnostic(
        diagnostics,
        "error",
        "service.manual-restart",
        'A manual service must set restart: "never". launchd KeepAlive policies imply RunAtLoad.',
        `${path}.restart`,
      );
    }
    const throttle = value.throttleIntervalSeconds;
    if (
      throttle !== undefined &&
      (!Number.isInteger(throttle) || (throttle as number) < 1 || (throttle as number) > 86_400)
    ) {
      addDiagnostic(
        diagnostics,
        "error",
        "service.throttle",
        "throttleIntervalSeconds must be an integer between 1 and 86400.",
        `${path}.throttleIntervalSeconds`,
      );
    }

    const service: ServiceJobDefinition = {
      ...base,
      kind: "service",
      ...(start === "login" || start === "manual" ? { start } : {}),
      ...(restart === "never" || restart === "on-failure" || restart === "always"
        ? { restart }
        : {}),
      ...(typeof throttle === "number" && Number.isInteger(throttle)
        ? { throttleIntervalSeconds: throttle }
        : {}),
    };
    return service;
  }

  const runAtLoad = value.runAtLoad;
  if (runAtLoad !== undefined && typeof runAtLoad !== "boolean") {
    addDiagnostic(
      diagnostics,
      "error",
      "task.run-at-load",
      "runAtLoad must be a boolean.",
      `${path}.runAtLoad`,
    );
  }
  const schedule = validateSchedule(value.schedule, `${path}.schedule`, diagnostics);
  if ((runAtLoad === undefined || runAtLoad === false) && schedule === undefined) {
    addDiagnostic(
      diagnostics,
      "warning",
      "task.manual-only",
      "This task has no schedule and will run only when explicitly started.",
      path,
    );
  }

  const task: TaskJobDefinition = {
    ...base,
    kind: "task",
    ...(typeof runAtLoad === "boolean" ? { runAtLoad } : {}),
    ...(schedule !== undefined ? { schedule } : {}),
  };
  return task;
}

export function validateManifestValue(value: unknown): ManifestValidationResult {
  const diagnostics: Diagnostic[] = [];
  if (!isRecord(value)) {
    addDiagnostic(
      diagnostics,
      "error",
      "manifest.root",
      "The manifest root must be an object.",
      "$",
    );
    return { diagnostics };
  }

  checkUnknownKeys(value, new Set(["$schema", "version", "jobs"]), "$", diagnostics);
  if (value.version !== 1) {
    addDiagnostic(
      diagnostics,
      "error",
      "manifest.version",
      "version must be 1.",
      "$.version",
    );
  }
  if (!isRecord(value.jobs)) {
    addDiagnostic(
      diagnostics,
      "error",
      "manifest.jobs",
      "jobs must be an object keyed by stable job IDs.",
      "$.jobs",
    );
    return { diagnostics };
  }

  const jobs: Record<string, JobDefinition> = {};
  const labels = new Map<string, string>();
  for (const [jobId, candidate] of Object.entries(value.jobs)) {
    const path = `$.jobs.${jobId}`;
    if (!JOB_ID_PATTERN.test(jobId)) {
      addDiagnostic(
        diagnostics,
        "error",
        "job.id",
        "Job IDs may contain only letters, digits, dots, underscores, and hyphens, and must start with a letter or digit.",
        path,
      );
      continue;
    }
    const job = validateJob(jobId, candidate, path, diagnostics);
    if (job === undefined) {
      continue;
    }
    const label = job.label ?? deriveLabel(jobId);
    const previousJobId = labels.get(label);
    if (previousJobId !== undefined) {
      addDiagnostic(
        diagnostics,
        "error",
        "job.duplicate-label",
        `Label ${JSON.stringify(label)} is already used by job ${JSON.stringify(previousJobId)}.`,
        `${path}.label`,
      );
      continue;
    }
    labels.set(label, jobId);
    jobs[jobId] = job;
  }

  if (Object.keys(value.jobs).length === 0) {
    addDiagnostic(
      diagnostics,
      "warning",
      "manifest.empty",
      "The manifest contains no jobs.",
      "$.jobs",
    );
  }

  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return { diagnostics };
  }

  return {
    manifest: {
      version: 1,
      jobs,
    },
    diagnostics,
  };
}
