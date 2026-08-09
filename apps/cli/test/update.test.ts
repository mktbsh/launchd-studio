import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  compareVersions,
  currentUpdatePlatform,
  parseUpdateManifest,
  updateArtifactUrl,
  updateSelf,
  UpdateError,
} from "../src/update";
import type { ProcessRunner } from "../src/adapters/launchd";

const MANIFEST = {
  schemaVersion: 1,
  version: "0.0.5",
  tag: "v0.0.5",
  platforms: {
    "darwin-arm64": {
      sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      size: 12,
    },
  },
} as const;

describe("self-update", () => {
  test("compares and validates numeric release versions", () => {
    expect(compareVersions("0.0.5", "0.0.4")).toBeGreaterThan(0);
    expect(compareVersions("0.0.4", "0.0.4")).toBe(0);
    expect(compareVersions("0.0.3", "0.0.4")).toBeLessThan(0);
    expect(() => parseUpdateManifest({ ...MANIFEST, tag: "v0.0.6" })).toThrow(UpdateError);
    expect(updateArtifactUrl("v0.0.5", "darwin-arm64")).toContain(
      "/v0.0.5/launchd-studio-darwin-arm64.gz",
    );
  });

  test("maps only supported macOS architectures", () => {
    expect(currentUpdatePlatform("darwin", "arm64")).toBe("darwin-arm64");
    expect(currentUpdatePlatform("darwin", "x64")).toBe("darwin-x64");
    expect(currentUpdatePlatform("linux", "x64")).toBeNull();
  });

  test("checks the feed without downloading when the update is current", async () => {
    const result = await updateSelf({
      currentVersion: "0.0.5",
      install: false,
      platform: "darwin-arm64",
      fetcher: async () => new Response(JSON.stringify(MANIFEST), { status: 200 }),
    });
    expect(result.status).toBe("up-to-date");
    expect(result.latestVersion).toBe("0.0.5");
  });

  test("verifies and atomically installs a downloaded artifact", async () => {
    const directory = await mkdtemp(join(tmpdir(), "launchd-studio-update-"));
    try {
      const currentPath = join(directory, "launchd-studio");
      const binary = Buffer.from("new binary");
      const artifact = gzipSync(binary);
      const manifest = {
        ...MANIFEST,
        platforms: {
          "darwin-arm64": {
            sha256: createHash("sha256").update(artifact).digest("hex"),
            size: artifact.byteLength,
          },
        },
      } as const;
      await writeFile(currentPath, "old binary", { mode: 0o755 });

      let requestCount = 0;
      const fetcher = async (): Promise<Response> => {
        requestCount += 1;
        return requestCount === 1
          ? new Response(JSON.stringify(manifest), { status: 200 })
          : new Response(artifact, { status: 200 });
      };
      const runner: ProcessRunner = {
        async run(argv) {
          if (argv[1] === "version") {
            return { exitCode: 0, stdout: "0.0.5\n", stderr: "" };
          }
          return { exitCode: 0, stdout: "", stderr: "TeamIdentifier=TESTTEAM\n" };
        },
      };

      const result = await updateSelf({
        currentVersion: "0.0.4",
        install: true,
        platform: "darwin-arm64",
        currentPath,
        fetcher,
        runner,
      });

      expect(result.status).toBe("updated");
      expect(await readFile(currentPath, "utf8")).toBe("new binary");
      expect((await stat(currentPath)).mode & 0o777).toBe(0o755);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
