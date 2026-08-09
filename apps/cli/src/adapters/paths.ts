import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathExists } from "./filesystem";

const MANIFEST_FILENAMES = ["launchd-studio.json", ".launchd-studio.json"] as const;

export function defaultManifestPath(homeDirectory: string): string {
  return join(
    homeDirectory,
    "Library",
    "Application Support",
    "launchd-studio",
    "launchd-studio.json",
  );
}

export async function findManifestPath(
  explicitPath?: string,
  currentDirectory = process.cwd(),
  homeDirectory = homedir(),
): Promise<string> {
  if (explicitPath !== undefined) {
    return resolve(explicitPath);
  }

  let directory = resolve(currentDirectory);
  while (true) {
    for (const filename of MANIFEST_FILENAMES) {
      const candidate = join(directory, filename);
      if (await pathExists(candidate)) {
        return candidate;
      }
    }
    const parent = dirname(directory);
    if (parent === directory) {
      return defaultManifestPath(homeDirectory);
    }
    directory = parent;
  }
}
