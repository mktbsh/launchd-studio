import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";

async function filesUnder(directory: string): Promise<ReadonlyArray<string>> {
  const entries = (await readdir(directory, { withFileTypes: true })).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? filesUnder(path) : [path];
    }),
  );
  return files.flat();
}

async function run(): Promise<void> {
  const webBuild = Bun.spawn([process.execPath, "run", "build:web"], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const webBuildExitCode = await webBuild.exited;
  if (webBuildExitCode !== 0) {
    process.exitCode = webBuildExitCode;
    return;
  }

  await mkdir("dist", { recursive: true });
  const webFiles = await filesUnder("apps/web/dist");
  const result = await Bun.build({
    entrypoints: [
      "./apps/cli/src/main.ts",
      ...webFiles.map((path) => `./${path}`),
    ],
    compile: {
      outfile: "./dist/launchd-studio",
    },
    minify: true,
    loader: {
      ".html": "file",
      ".js": "file",
    },
    naming: {
      asset: "[dir]/[name].[ext]",
    },
  });
  if (!result.success) {
    for (const log of result.logs) {
      console.error(log);
    }
    process.exitCode = 1;
  }
}

try {
  await run();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
