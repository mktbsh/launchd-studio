import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashPlist, ManagedStateStore } from "../src/adapters/state";

describe("managed state", () => {
  test("records, resolves, and removes applied jobs atomically", async () => {
    const directory = await mkdtemp(join(tmpdir(), "launchd-studio-state-"));
    try {
      const path = join(directory, "state.json");
      const store = new ManagedStateStore(path);
      const record = {
        jobId: "api",
        label: "dev.example.api",
        plistPath: "/Users/test/Library/LaunchAgents/dev.example.api.plist",
        plistHash: hashPlist("plist"),
        manifestPath: "/Users/test/launchd-studio.json",
        appliedAt: "2026-08-08T00:00:00.000Z",
      } as const;

      await store.record(record);
      expect(await store.get(record.label)).toEqual(record);
      expect(await store.findByJobId(record.jobId, record.manifestPath)).toEqual(record);
      expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
        version: 1,
        jobs: { [record.label]: record },
      });
      expect((await stat(path)).mode & 0o777).toBe(0o600);

      await store.remove(record.label);
      expect(await store.get(record.label)).toBeNull();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
