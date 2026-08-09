import { describe, expect, test } from "bun:test";
import {
  compileManifest,
  createManifestPlan,
  DEFAULT_MANIFEST_SOURCE,
  formatManifestJson,
  parseDurationSeconds,
  parseManifestJson,
  planLaunchdJob,
  renderLaunchdJob,
} from "../src";

const context = { homeDirectory: "/Users/tester" } as const;

const SAMPLE_SOURCE = `{
  "version": 1,
  "jobs": {
    "local-api": {
      "kind": "service",
      "label": "dev.example.local-api",
      "command": ["/opt/homebrew/bin/bun", "run", "src/index.ts"],
      "workingDirectory": "~/src/local-api",
      "start": "login",
      "restart": "on-failure"
    },
    "daily-backup": {
      "kind": "task",
      "label": "dev.example.daily-backup",
      "command": ["~/.local/bin/backup"],
      "schedule": { "type": "calendar", "entries": [{ "hour": 3, "minute": 0 }] }
    }
  }
}
`;

describe("manifest JSON", () => {
  test("rejects comments and trailing commas as syntax errors", () => {
    for (const source of [`{\n  // comment\n  "value": 1\n}`, `{\n  "value": [1, 2,]\n}`]) {
      const result = parseManifestJson(source);
      expect(result.value).toBeUndefined();
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.code).toBe("json.syntax");
    }
  });

  test("locates a syntax error when the engine reports a position", () => {
    const result = parseManifestJson(`{\n  "value": 1\n  "other": 2\n}`);
    const diagnostic = result.diagnostics[0];
    expect(diagnostic?.code).toBe("json.syntax");
    // JavaScriptCore omits the offset; only assert the mapping when V8 supplies one.
    if (diagnostic !== undefined && diagnostic.offset !== undefined && diagnostic.offset > 0) {
      expect(diagnostic.line).toBe(3);
    }
  });

  test("formats to two-space indentation with a trailing newline", () => {
    const result = formatManifestJson(`{"version":1,"jobs":{}}`);
    expect(result.formatted).toBe(`{\n  "version": 1,\n  "jobs": {}\n}\n`);
  });
});

describe("manifest compiler", () => {
  test("compiles the starter manifest with no jobs", () => {
    const result = compileManifest(DEFAULT_MANIFEST_SOURCE, context);
    expect(result.valid).toBe(true);
    if (!result.valid) {
      throw new Error("starter manifest must compile");
    }
    expect(result.manifest.jobs).toEqual([]);
  });

  test("sorts jobs by id", () => {
    const result = compileManifest(SAMPLE_SOURCE, context);
    expect(result.valid).toBe(true);
    if (!result.valid) {
      throw new Error("sample manifest must compile");
    }
    expect(result.manifest.jobs.map((job) => job.id)).toEqual([
      "daily-backup",
      "local-api",
    ]);
  });

  test("rejects unknown properties", () => {
    const result = compileManifest(`{
      "version": 1,
      "jobs": {
        "bad": {
          "kind": "service",
          "command": ["/usr/bin/true"],
          "mystery": true
        }
      }
    }`, context);
    expect(result.valid).toBe(false);
    expect(result.diagnostics.some((entry) => entry.code === "manifest.unknown-key")).toBe(true);
  });


  test("rejects restart policies that make a manual service start at load", () => {
    const result = compileManifest(`{
      "version": 1,
      "jobs": {
        "manual": {
          "kind": "service",
          "command": ["/usr/bin/true"],
          "start": "manual",
          "restart": "on-failure"
        }
      }
    }`, context);
    expect(result.valid).toBe(false);
    expect(result.diagnostics.some((entry) => entry.code === "service.manual-restart")).toBe(true);
  });

  test("rejects characters that cannot be represented in plist XML", () => {
    const result = compileManifest(`{
      "version": 1,
      "jobs": {
        "bad": { "kind": "task", "command": ["/usr/bin/printf", "\\u0001"] }
      }
    }`, context);
    expect(result.valid).toBe(false);
    expect(result.diagnostics.some((entry) => entry.code === "job.command-argument")).toBe(true);
  });

  test("rejects an executable resolved through shell PATH", () => {
    const result = compileManifest(`{
      "version": 1,
      "jobs": {
        "bad": { "kind": "service", "command": ["bun", "run", "index.ts"] }
      }
    }`, context);
    expect(result.valid).toBe(false);
    expect(result.diagnostics.some((entry) => entry.code === "job.executable-path")).toBe(true);
  });
});

describe("plist rendering", () => {
  test("renders dictionaries separately from arrays", () => {
    const result = compileManifest(`{
      "version": 1,
      "jobs": {
        "api": {
          "kind": "service",
          "label": "dev.example.api",
          "command": ["/usr/bin/env", "true"],
          "restart": "on-failure",
          "environment": { "B": "2", "A": "1" }
        }
      }
    }`, context);
    if (!result.valid) {
      throw new Error(JSON.stringify(result.diagnostics));
    }
    const job = result.manifest.jobs[0];
    if (job === undefined) {
      throw new Error("job missing");
    }
    const plist = renderLaunchdJob(job).plist;
    expect(plist).toContain("<key>ProgramArguments</key>\n    <array>");
    expect(plist).toContain("<key>EnvironmentVariables</key>\n    <dict>");
    expect(plist).toContain("<key>KeepAlive</key>\n    <dict>");
    expect(plist.indexOf("<key>A</key>")).toBeLessThan(plist.indexOf("<key>B</key>"));
  });

  test("renders background attribution only when requested", () => {
    const result = compileManifest(SAMPLE_SOURCE, context);
    if (!result.valid || result.manifest.jobs[0] === undefined) {
      throw new Error("sample manifest did not compile");
    }

    const ordinary = renderLaunchdJob(result.manifest.jobs[0]).plist;
    const attributed = renderLaunchdJob(result.manifest.jobs[0], {
      associatedBundleIdentifiers: ["dev.launchd-studio.app"],
    }).plist;
    expect(ordinary).not.toContain("AssociatedBundleIdentifiers");
    expect(attributed).toContain(
      "<key>AssociatedBundleIdentifiers</key>\n    <array>\n      <string>dev.launchd-studio.app</string>",
    );
  });

  test("renders one calendar entry as a dictionary and several as an array", () => {
    const one = compileManifest(`{
      "version": 1,
      "jobs": {
        "task": {
          "kind": "task",
          "command": ["/usr/bin/true"],
          "schedule": { "type": "calendar", "entries": [{ "hour": 3 }] }
        }
      }
    }`, context);
    if (!one.valid || one.manifest.jobs[0] === undefined) {
      throw new Error("single schedule did not compile");
    }
    expect(renderLaunchdJob(one.manifest.jobs[0]).plist).toContain(
      "<key>StartCalendarInterval</key>\n    <dict>",
    );

    const several = compileManifest(`{
      "version": 1,
      "jobs": {
        "task": {
          "kind": "task",
          "command": ["/usr/bin/true"],
          "schedule": {
            "type": "calendar",
            "entries": [{ "hour": 3 }, { "hour": 12, "weekday": 1 }]
          }
        }
      }
    }`, context);
    if (!several.valid || several.manifest.jobs[0] === undefined) {
      throw new Error("multi schedule did not compile");
    }
    expect(renderLaunchdJob(several.manifest.jobs[0]).plist).toContain(
      "<key>StartCalendarInterval</key>\n    <array>",
    );
  });
});

describe("planning and durations", () => {
  test("plans create and load", () => {
    const result = compileManifest(SAMPLE_SOURCE, context);
    if (!result.valid || result.manifest.jobs[0] === undefined) {
      throw new Error("sample manifest did not compile");
    }
    const rendered = renderLaunchdJob(result.manifest.jobs[0]);
    const plan = planLaunchdJob(rendered, {
      fileContent: null,
      runtime: { supported: true, loaded: false, running: false },
      runtimeDefinitionMatches: null,
    });
    expect(plan.fileAction).toBe("create");
    expect(plan.runtimeAction).toBe("load");
    expect(createManifestPlan([plan]).summary).toEqual({
      create: 1,
      update: 0,
      load: 1,
      reload: 0,
      unchanged: 0,
    });
  });

  test("reloads a loaded job when its runtime definition is not tracked", () => {
    const result = compileManifest(SAMPLE_SOURCE, context);
    if (!result.valid || result.manifest.jobs[0] === undefined) {
      throw new Error("sample manifest did not compile");
    }
    const rendered = renderLaunchdJob(result.manifest.jobs[0]);
    const runtime = { supported: true, loaded: true, running: true } as const;

    expect(
      planLaunchdJob(rendered, {
        fileContent: rendered.plist,
        runtime,
        runtimeDefinitionMatches: false,
      }).runtimeAction,
    ).toBe("reload");
    expect(
      planLaunchdJob(rendered, {
        fileContent: rendered.plist,
        runtime,
        runtimeDefinitionMatches: true,
      }).runtimeAction,
    ).toBe("none");
  });

  test("parses compound duration strings", () => {
    expect(parseDurationSeconds("1h30m")).toBe(5400);
    expect(parseDurationSeconds("0s")).toBeNull();
    expect(parseDurationSeconds("1.5h")).toBeNull();
  });
});
