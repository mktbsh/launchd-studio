import { constants } from "node:fs";
import {
  access,
  chmod,
  copyFile,
  mkdir,
  open,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function readTextIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function ensureDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o755 });
}

export async function ensureParentDirectory(path: string): Promise<void> {
  await ensureDirectory(dirname(path));
}

export async function writeTextAtomic(
  path: string,
  content: string,
  mode = 0o644,
): Promise<void> {
  await ensureParentDirectory(path);
  const temporaryPath = join(
    dirname(path),
    `.${path.split("/").at(-1) ?? "file"}.${process.pid}.${crypto.randomUUID()}.tmp`,
  );

  try {
    await writeFile(temporaryPath, content, { encoding: "utf8", mode });
    await chmod(temporaryPath, mode);
    await rename(temporaryPath, path);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

export async function removeFileIfExists(path: string): Promise<boolean> {
  try {
    await unlink(path);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export async function backupFileIfExists(
  sourcePath: string,
  backupDirectory: string,
): Promise<string | null> {
  if (!(await pathExists(sourcePath))) {
    return null;
  }
  await ensureDirectory(backupDirectory);
  const timestamp = new Date().toISOString().replaceAll(":", "-");
  const backupPath = join(backupDirectory, `${timestamp}.plist`);
  await copyFile(sourcePath, backupPath);
  await chmod(backupPath, 0o600);
  return backupPath;
}

export async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

export async function isExecutableFile(path: string): Promise<boolean> {
  try {
    const information = await stat(path);
    if (!information.isFile()) {
      return false;
    }
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function isWritableDirectory(path: string): Promise<boolean> {
  try {
    const information = await stat(path);
    if (!information.isDirectory()) {
      return false;
    }
    await access(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export async function readTail(
  path: string,
  lineCount: number,
  maximumBytes = 1024 * 1024,
): Promise<{ readonly content: string; readonly truncated: boolean } | null> {
  let information;
  try {
    information = await stat(path);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }

  const bytesToRead = Math.min(information.size, maximumBytes);
  const start = Math.max(0, information.size - bytesToRead);
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(bytesToRead);
    await handle.read(buffer, 0, bytesToRead, start);
    const text = buffer.toString("utf8");
    const lines = text.split(/\r?\n/u);
    const content = lines.slice(Math.max(0, lines.length - lineCount - 1)).join("\n");
    return {
      content,
      truncated: start > 0 || lines.length > lineCount + 1,
    };
  } finally {
    await handle.close();
  }
}

export function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
