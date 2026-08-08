import type {
  CalendarEntryDefinition,
  JobExplanation,
  NormalizedJob,
  NormalizedManifest,
  RenderedJob,
} from "../domain";
import {
  plistDictionary,
  renderPlist,
  type PlistDictionary,
  type PlistValue,
} from "./plist";
import { compareStrings } from "../text";

function environmentDictionary(
  environment: Readonly<Record<string, string>>,
): PlistDictionary {
  return plistDictionary(
    Object.entries(environment)
      .sort(([left], [right]) => compareStrings(left, right))
      .map(([key, value]) => [key, value] as const),
  );
}

function calendarDictionary(entry: CalendarEntryDefinition): PlistDictionary {
  const mapping: ReadonlyArray<readonly [keyof CalendarEntryDefinition, string]> = [
    ["minute", "Minute"],
    ["hour", "Hour"],
    ["day", "Day"],
    ["weekday", "Weekday"],
    ["month", "Month"],
  ];

  const dictionary: Array<readonly [string, PlistValue]> = [];
  for (const [sourceKey, targetKey] of mapping) {
    const value = entry[sourceKey];
    if (value !== undefined) {
      dictionary.push([targetKey, value]);
    }
  }
  return plistDictionary(dictionary);
}

function launchdDictionary(job: NormalizedJob): PlistDictionary {
  const dictionary: Array<readonly [string, PlistValue]> = [
    ["Label", job.label],
    ["ProgramArguments", job.command],
  ];

  if (job.workingDirectory !== undefined) {
    dictionary.push(["WorkingDirectory", job.workingDirectory]);
  }
  if (Object.keys(job.environment).length > 0) {
    dictionary.push(["EnvironmentVariables", environmentDictionary(job.environment)]);
  }

  if (job.kind === "service") {
    if (job.start === "login") {
      dictionary.push(["RunAtLoad", true]);
    }
    if (job.restart === "always") {
      dictionary.push(["KeepAlive", true]);
    } else if (job.restart === "on-failure") {
      dictionary.push([
        "KeepAlive",
        plistDictionary([["SuccessfulExit", false]]),
      ]);
    }
    dictionary.push(["ThrottleInterval", job.throttleIntervalSeconds]);
  } else {
    if (job.runAtLoad) {
      dictionary.push(["RunAtLoad", true]);
    }
    if (job.schedule?.type === "interval") {
      dictionary.push(["StartInterval", job.schedule.everySeconds]);
    } else if (job.schedule?.type === "calendar") {
      const entries = job.schedule.entries.map((entry) => calendarDictionary(entry));
      dictionary.push([
        "StartCalendarInterval",
        entries.length === 1 ? (entries[0] ?? plistDictionary([])) : entries,
      ]);
    }
  }

  dictionary.push(["StandardOutPath", job.logs.stdout]);
  dictionary.push(["StandardErrorPath", job.logs.stderr]);
  return plistDictionary(dictionary);
}

export function renderLaunchdJob(job: NormalizedJob): RenderedJob {
  return {
    id: job.id,
    label: job.label,
    kind: job.kind,
    plistPath: job.plistPath,
    plist: renderPlist(launchdDictionary(job)),
  };
}

export function renderLaunchdManifest(
  manifest: NormalizedManifest,
): ReadonlyArray<RenderedJob> {
  return manifest.jobs.map(renderLaunchdJob);
}

export function explainLaunchdJob(job: NormalizedJob): JobExplanation {
  const entries: JobExplanation["entries"] = [
    {
      source: "job label",
      target: "Label",
      value: job.label,
      note: "Used as the launchd service identifier and plist filename.",
    },
    {
      source: "command",
      target: "ProgramArguments",
      value: JSON.stringify(job.command),
      note: "Passed directly as argv; no shell is inserted.",
    },
  ];

  const mutableEntries = [...entries];
  if (job.workingDirectory !== undefined) {
    mutableEntries.push({
      source: "workingDirectory",
      target: "WorkingDirectory",
      value: job.workingDirectory,
    });
  }
  if (Object.keys(job.environment).length > 0) {
    mutableEntries.push({
      source: "environment",
      target: "EnvironmentVariables",
      value: JSON.stringify(job.environment),
    });
  }

  if (job.kind === "service") {
    mutableEntries.push({
      source: "start",
      target: "RunAtLoad",
      value: String(job.start === "login"),
      note:
        job.start === "login"
          ? "The service is eligible to start when the LaunchAgent is loaded."
          : "The service remains registered but starts only on explicit request or another launchd trigger.",
    });
    mutableEntries.push({
      source: "restart",
      target: "KeepAlive",
      value:
        job.restart === "always"
          ? "true"
          : job.restart === "on-failure"
            ? '{ "SuccessfulExit": false }'
            : "omitted",
      ...(job.restart === "on-failure"
        ? { note: "launchd restarts the process after an unsuccessful exit." }
        : {}),
    });
    mutableEntries.push({
      source: "throttleIntervalSeconds",
      target: "ThrottleInterval",
      value: String(job.throttleIntervalSeconds),
    });
  } else {
    mutableEntries.push({
      source: "runAtLoad",
      target: "RunAtLoad",
      value: String(job.runAtLoad),
    });
    if (job.schedule?.type === "interval") {
      mutableEntries.push({
        source: `schedule.every (${job.schedule.source})`,
        target: "StartInterval",
        value: String(job.schedule.everySeconds),
      });
    } else if (job.schedule?.type === "calendar") {
      mutableEntries.push({
        source: "schedule.entries",
        target: "StartCalendarInterval",
        value: JSON.stringify(job.schedule.entries),
      });
    }
  }

  mutableEntries.push(
    {
      source: "logs.stdout",
      target: "StandardOutPath",
      value: job.logs.stdout,
    },
    {
      source: "logs.stderr",
      target: "StandardErrorPath",
      value: job.logs.stderr,
    },
  );

  return {
    id: job.id,
    label: job.label,
    kind: job.kind,
    plistPath: job.plistPath,
    entries: mutableEntries,
    portability: "launchd-user-agent",
  };
}
