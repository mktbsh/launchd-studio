import type {
  ManifestV1,
  NormalizeContext,
  NormalizedJob,
  NormalizedManifest,
  NormalizedServiceJob,
  NormalizedTaskJob,
} from "../domain";
import { parseDurationSeconds } from "./duration";
import { compareStrings } from "../text";
import { deriveLabel } from "./naming";

function trimTrailingSlash(value: string): string {
  if (value === "/") {
    return value;
  }
  return value.replace(/\/+$/u, "");
}

export function joinPosix(...parts: ReadonlyArray<string>): string {
  const filtered = parts.filter((part) => part.length > 0);
  if (filtered.length === 0) {
    return "";
  }

  const first = filtered[0] ?? "";
  const prefix = first.startsWith("/") ? "/" : "";
  const body = filtered
    .map((part) => part.replace(/^\/+|\/+$/gu, ""))
    .filter((part) => part.length > 0)
    .join("/");
  return `${prefix}${body}` || prefix;
}

export function expandHomePath(value: string, homeDirectory: string): string {
  const home = trimTrailingSlash(homeDirectory);
  if (value === "~") {
    return home;
  }
  if (value.startsWith("~/")) {
    return `${home}/${value.slice(2)}`;
  }
  return value;
}

function normalizeJob(
  id: string,
  definition: ManifestV1["jobs"][string],
  context: NormalizeContext,
): NormalizedJob {
  const label = definition.label ?? deriveLabel(id);
  const logDirectory = joinPosix(context.homeDirectory, "Library", "Logs", "launchd-studio");
  const command = definition.command.map((argument) =>
    argument === "~" || argument.startsWith("~/")
      ? expandHomePath(argument, context.homeDirectory)
      : argument,
  ) as [string, ...string[]];

  const base = {
    id,
    label,
    ...(definition.description !== undefined ? { description: definition.description } : {}),
    ...(definition.comment !== undefined ? { comment: definition.comment } : {}),
    scope: "user" as const,
    command,
    ...(definition.workingDirectory !== undefined
      ? { workingDirectory: expandHomePath(definition.workingDirectory, context.homeDirectory) }
      : {}),
    environment: Object.fromEntries(
      Object.entries(definition.environment ?? {}).sort(([left], [right]) => compareStrings(left, right)),
    ),
    logs: {
      stdout: expandHomePath(
        definition.logs?.stdout ?? joinPosix(logDirectory, `${id}.stdout.log`),
        context.homeDirectory,
      ),
      stderr: expandHomePath(
        definition.logs?.stderr ?? joinPosix(logDirectory, `${id}.stderr.log`),
        context.homeDirectory,
      ),
    },
    plistPath: joinPosix(context.homeDirectory, "Library", "LaunchAgents", `${label}.plist`),
  };

  if (definition.kind === "service") {
    const normalized: NormalizedServiceJob = {
      ...base,
      kind: "service",
      start: definition.start ?? "login",
      restart: definition.restart ?? "on-failure",
      throttleIntervalSeconds: definition.throttleIntervalSeconds ?? 10,
    };
    return normalized;
  }

  const schedule = definition.schedule;
  const normalized: NormalizedTaskJob = {
    ...base,
    kind: "task",
    runAtLoad: definition.runAtLoad ?? false,
    ...(schedule === undefined
      ? {}
      : schedule.type === "interval"
        ? {
            schedule: {
              type: "interval" as const,
              everySeconds: parseDurationSeconds(schedule.every) ?? 0,
              source: schedule.every,
            },
          }
        : {
            schedule: {
              type: "calendar" as const,
              entries: schedule.entries,
            },
          }),
  };
  return normalized;
}

export function normalizeManifest(
  manifest: ManifestV1,
  context: NormalizeContext,
): NormalizedManifest {
  return {
    version: 1,
    jobs: Object.entries(manifest.jobs)
      .sort(([left], [right]) => compareStrings(left, right))
      .map(([id, definition]) => normalizeJob(id, definition, context)),
  };
}
