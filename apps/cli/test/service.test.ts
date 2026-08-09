import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileManifest, renderLaunchdJob, stringifyManifest } from "@launchd-studio/core";
import { writeTextAtomic } from "../src/adapters/filesystem";
import type { LaunchdAdapter } from "../src/adapters/launchd";
import { hashPlist, ManagedStateStore } from "../src/adapters/state";
import { LocalStudioService, SELF_SERVICE_LABEL } from "../src/service";

const SOURCE = `{
  "version": 1,
  "jobs": {
    "api": {
      "kind": "service",
      "label": "dev.example.api",
      "command": ["/usr/bin/true"],
      "start": "login",
      "restart": "on-failure"
    }
  }
}\n`;

function loadedLaunchd(): LaunchdAdapter {
  return {
    supported: true,
    status: async () => ({ supported: true, loaded: true, running: true }),
    assertSupported: () => undefined,
  } as unknown as LaunchdAdapter;
}

function unloadedLaunchd(): LaunchdAdapter {
  return {
    supported: true,
    status: async () => ({ supported: true, loaded: false, running: false }),
    assertSupported: () => undefined,
  } as unknown as LaunchdAdapter;
}

function selfServiceLaunchd(): LaunchdAdapter {
  return {
    supported: true,
    status: async () => ({
      supported: true,
      loaded: true,
      running: true,
      pid: process.pid,
    }),
    kickstart: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
    assertSupported: () => undefined,
  } as unknown as LaunchdAdapter;
}

describe("local studio service state reconciliation", () => {
  test("reloads an untracked loaded definition and accepts the tracked definition", async () => {
    const home = await mkdtemp(join(tmpdir(), "launchd-studio-home-"));
    try {
      const configPath = join(home, "launchd-studio.json");
      const state = new ManagedStateStore(join(home, "state.json"));
      const service = new LocalStudioService({
        configPath,
        homeDirectory: home,
        launchd: loadedLaunchd(),
        managedState: state,
      });
      const compilation = compileManifest(SOURCE, { homeDirectory: home });
      if (!compilation.valid || compilation.manifest.jobs[0] === undefined) {
        throw new Error("test manifest did not compile");
      }
      const job = compilation.manifest.jobs[0];
      const rendered = renderLaunchdJob(job);
      await writeTextAtomic(rendered.plistPath, rendered.plist);

      const untracked = await service.planManifest(SOURCE, "api");
      expect(untracked.plan?.jobs[0]?.runtimeAction).toBe("reload");

      await state.record({
        jobId: job.id,
        label: job.label,
        plistPath: rendered.plistPath,
        plistHash: hashPlist(rendered.plist),
        manifestPath: configPath,
        appliedAt: "2026-08-08T00:00:00.000Z",
      });
      const tracked = await service.planManifest(SOURCE, "api");
      expect(tracked.plan?.jobs[0]?.runtimeAction).toBe("none");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("removes a tracked job after it was deleted from the manifest", async () => {
    const home = await mkdtemp(join(tmpdir(), "launchd-studio-home-"));
    try {
      const configPath = join(home, "launchd-studio.json");
      const state = new ManagedStateStore(join(home, "state.json"));
      const service = new LocalStudioService({
        configPath,
        homeDirectory: home,
        launchd: unloadedLaunchd(),
        managedState: state,
      });
      const plistPath = join(home, "Library", "LaunchAgents", "dev.example.api.plist");
      await writeTextAtomic(plistPath, "plist");
      await state.record({
        jobId: "api",
        label: "dev.example.api",
        plistPath,
        plistHash: hashPlist("plist"),
        manifestPath: configPath,
        appliedAt: "2026-08-08T00:00:00.000Z",
      });

      const operations = await service.removeJob(null, "api", false);
      expect(operations.every((entry) => entry.success)).toBe(true);
      expect(await state.get("dev.example.api")).toBeNull();
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("restarts the Web UI only when the current process owns its service", async () => {
    const service = new LocalStudioService({
      configPath: "/Users/test/launchd-studio.json",
      launchd: selfServiceLaunchd(),
    });
    expect(await service.restartSelfService()).toBe(true);
  });

  test("associates only the self-service job with the attribution app", async () => {
    const home = await mkdtemp(join(tmpdir(), "launchd-studio-home-"));
    try {
      const service = new LocalStudioService({
        configPath: join(home, "launchd-studio.json"),
        homeDirectory: home,
        launchd: unloadedLaunchd(),
      });
      const offer = (await service.getCapabilities()).selfService;
      expect(offer.job.label).toBe(SELF_SERVICE_LABEL);
      expect(offer.job.command).not.toContain("--config");
      const source = stringifyManifest({
        version: 1,
        jobs: {
          [offer.id]: offer.job,
          api: {
            kind: "service",
            command: ["/usr/bin/true"],
            start: "login",
            restart: "on-failure",
          },
        },
      });
      const rendered = await service.renderManifest(source);

      expect(rendered.valid).toBe(true);
      expect(rendered.jobs.find((job) => job.id === offer.id)?.plist).toContain(
        "AssociatedBundleIdentifiers",
      );
      expect(rendered.jobs.find((job) => job.id === "api")?.plist).not.toContain(
        "AssociatedBundleIdentifiers",
      );
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
