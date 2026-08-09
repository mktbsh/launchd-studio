import { chmod, copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const binaryPath = join("dist", "launchd-studio");
const appPath = join("dist", "Launchd Studio.app");
const appContentsPath = join(appPath, "Contents");
const appExecutablePath = join(appContentsPath, "MacOS", "launchd-studio");
const infoTemplatePath = join("packaging", "Launchd Studio.app", "Contents", "Info.plist");

function packageVersion(value: unknown): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("apps/cli/package.json must contain an object.");
  }
  const version = (value as { readonly version?: unknown }).version;
  if (typeof version !== "string" || version.length === 0) {
    throw new Error("apps/cli/package.json must contain a non-empty version.");
  }
  return version;
}

async function run(): Promise<void> {
  const packageJson = JSON.parse(await readFile("apps/cli/package.json", "utf8")) as unknown;
  const version = packageVersion(packageJson);
  const infoPlist = (await readFile(infoTemplatePath, "utf8")).replaceAll("__VERSION__", version);

  await rm(appPath, { recursive: true, force: true });
  await mkdir(dirname(appExecutablePath), { recursive: true });
  await copyFile(binaryPath, appExecutablePath);
  await chmod(appExecutablePath, 0o755);
  await writeFile(join(appContentsPath, "Info.plist"), infoPlist, "utf8");
}

try {
  await run();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
