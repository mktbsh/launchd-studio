import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defaultManifestPath, findManifestPath } from "../src/adapters/paths";

async function temporaryRoot(): Promise<string> {
  const scratch = join(process.cwd(), ".context");
  await mkdir(scratch, { recursive: true });
  return mkdtemp(join(scratch, "manifest-paths-"));
}

describe("manifest paths", () => {
  test("uses macOS Application Support for the default manifest", () => {
    expect(defaultManifestPath("/Users/tester")).toBe(
      "/Users/tester/Library/Application Support/launchd-studio/launchd-studio.json",
    );
  });

  test("keeps explicit and project-local manifests ahead of the default", async () => {
    const root = await temporaryRoot();
    try {
      const project = join(root, "project");
      const nested = join(project, "packages", "cli");
      await mkdir(nested, { recursive: true });
      const projectManifest = join(project, "launchd-studio.json");
      await writeFile(projectManifest, "{}\n", "utf8");

      expect(await findManifestPath(undefined, nested, root)).toBe(projectManifest);
      expect(await findManifestPath("/Users/tester/custom.json", nested, root)).toBe(
        "/Users/tester/custom.json",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("falls back to the default when no project manifest exists", async () => {
    const home = "/Users/tester";
    expect(await findManifestPath(undefined, `${home}/empty`, home)).toBe(
      defaultManifestPath(home),
    );
  });
});
