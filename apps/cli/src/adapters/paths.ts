import { join } from "node:path";

export function defaultManifestPath(homeDirectory: string): string {
  return join(
    homeDirectory,
    "Library",
    "Application Support",
    "launchd-studio",
    "launchd-studio.json",
  );
}
