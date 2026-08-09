import { createHash } from "node:crypto";
import { chmod, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { gunzipSync } from "node:zlib";
import { BunProcessRunner, type ProcessRunner } from "./adapters/launchd";

export const UPDATE_MANIFEST_URL =
  "https://github.com/mktbsh/launchd-studio/releases/latest/download/latest.json";

const RELEASES_URL = "https://github.com/mktbsh/launchd-studio/releases/download";
const UPDATE_TIMEOUT_MS = 5_000;
const UPDATE_SKIP_ENV = "LAUNCHD_STUDIO_SKIP_UPDATE";
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/u;
const TAG_PATTERN = /^v?\d+\.\d+\.\d+$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export type UpdatePlatform = "darwin-arm64" | "darwin-x64";

export interface UpdateArtifact {
  readonly sha256: string;
  readonly size: number;
}

export interface UpdateManifest {
  readonly schemaVersion: 1;
  readonly version: string;
  readonly tag: string;
  readonly platforms: Readonly<Partial<Record<UpdatePlatform, UpdateArtifact>>>;
}

export type UpdateStatus = "unsupported" | "up-to-date" | "available" | "updated";

export interface UpdateResult {
  readonly status: UpdateStatus;
  readonly currentVersion: string;
  readonly latestVersion?: string;
  readonly platform?: UpdatePlatform;
  readonly executablePath?: string;
  readonly reason?: string;
}

export class UpdateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UpdateError";
  }
}

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new UpdateError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function stringField(value: Record<string, unknown>, key: string): string {
  const field = value[key];
  if (typeof field !== "string" || field.length === 0) {
    throw new UpdateError(`${key} must be a non-empty string.`);
  }
  return field;
}

function parseVersion(value: string, label: string): [number, number, number] {
  // ponytail: release versions are numeric x.y.z; add prerelease ordering if tags adopt it.
  if (!VERSION_PATTERN.test(value)) {
    throw new UpdateError(`${label} must use numeric major.minor.patch form.`);
  }
  const parts = value.split(".").map(Number);
  if (parts.some((part) => !Number.isSafeInteger(part))) {
    throw new UpdateError(`${label} contains an unsafe number.`);
  }
  return parts as [number, number, number];
}

export function compareVersions(left: string, right: string): number {
  const leftParts = parseVersion(left, "version");
  const rightParts = parseVersion(right, "version");
  for (let index = 0; index < leftParts.length; index += 1) {
    const difference = leftParts[index]! - rightParts[index]!;
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

function artifactName(platform: UpdatePlatform): string {
  return `launchd-studio-${platform}.gz`;
}

export function updateArtifactUrl(tag: string, platform: UpdatePlatform): string {
  if (!TAG_PATTERN.test(tag)) {
    throw new UpdateError("Update tag has an invalid format.");
  }
  return `${RELEASES_URL}/${encodeURIComponent(tag)}/${artifactName(platform)}`;
}

export function currentUpdatePlatform(
  platform = process.platform,
  architecture = process.arch,
): UpdatePlatform | null {
  if (platform !== "darwin") {
    return null;
  }
  if (architecture === "arm64") {
    return "darwin-arm64";
  }
  if (architecture === "x64") {
    return "darwin-x64";
  }
  return null;
}

export function parseUpdateManifest(value: unknown): UpdateManifest {
  const source = record(value, "manifest");
  if (source.schemaVersion !== 1) {
    throw new UpdateError("Update manifest schemaVersion must be 1.");
  }

  const version = stringField(source, "version");
  parseVersion(version, "manifest.version");
  const tag = stringField(source, "tag");
  if (!TAG_PATTERN.test(tag) || tag.replace(/^v/u, "") !== version) {
    throw new UpdateError("Update manifest tag must match its version.");
  }

  const platformSource = record(source.platforms, "manifest.platforms");
  const platforms: Partial<Record<UpdatePlatform, UpdateArtifact>> = {};
  for (const [key, rawArtifact] of Object.entries(platformSource)) {
    if (key !== "darwin-arm64" && key !== "darwin-x64") {
      throw new UpdateError(`Unsupported update platform ${JSON.stringify(key)}.`);
    }
    const artifact = record(rawArtifact, `manifest.platforms.${key}`);
    const sha256 = stringField(artifact, "sha256");
    if (!SHA256_PATTERN.test(sha256)) {
      throw new UpdateError(`manifest.platforms.${key}.sha256 must be lowercase SHA-256.`);
    }
    const size = artifact.size;
    if (!Number.isSafeInteger(size) || (size as number) < 1) {
      throw new UpdateError(`manifest.platforms.${key}.size must be a positive safe integer.`);
    }
    platforms[key] = { sha256, size: size as number };
  }
  if (Object.keys(platforms).length === 0) {
    throw new UpdateError("Update manifest has no supported platform artifacts.");
  }

  return { schemaVersion: 1, version, tag, platforms };
}

async function fetchManifest(
  url: string,
  fetcher: Fetcher,
): Promise<UpdateManifest> {
  const response = await fetchWithTimeout(
    url,
    { headers: { Accept: "application/json" } },
    fetcher,
    "Update manifest",
  );
  if (!response.ok) {
    throw new UpdateError(`Update manifest request failed with HTTP ${response.status}.`);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new UpdateError("Update manifest is not valid JSON.");
  }
  return parseUpdateManifest(body);
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  fetcher: Fetcher,
  description: string,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPDATE_TIMEOUT_MS);
  try {
    return await fetcher(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new UpdateError(`${description} request timed out.`);
    }
    throw new UpdateError(
      `Could not fetch ${description.toLowerCase()}: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function downloadArtifact(
  url: string,
  expected: UpdateArtifact,
  fetcher: Fetcher,
): Promise<Uint8Array> {
  const response = await fetchWithTimeout(
    url,
    { headers: { Accept: "application/gzip" } },
    fetcher,
    "Update download",
  );
  if (!response.ok) {
    throw new UpdateError(`Update download failed with HTTP ${response.status}.`);
  }
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    throw new UpdateError(
      `Could not read update download: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (bytes.byteLength !== expected.size) {
    throw new UpdateError(
      `Update download size mismatch: expected ${expected.size} bytes, got ${bytes.byteLength}.`,
    );
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== expected.sha256) {
    throw new UpdateError("Update download failed SHA-256 verification.");
  }
  return bytes;
}

function commandDetail(result: { readonly stdout: string; readonly stderr: string }): string {
  return (result.stderr || result.stdout).trim();
}

function teamIdentifier(output: string): string | null {
  return /^TeamIdentifier=([^\s]+)$/mu.exec(output)?.[1] ?? null;
}

async function verifyCandidate(
  currentPath: string,
  candidatePath: string,
  expectedVersion: string,
  runner: ProcessRunner,
): Promise<void> {
  const currentSignature = await runner.run([
    "/usr/bin/codesign",
    "--display",
    "--verbose=4",
    currentPath,
  ]);
  if (currentSignature.exitCode !== 0) {
    throw new UpdateError(`Current executable is not code signed: ${commandDetail(currentSignature)}.`);
  }

  const candidateSignature = await runner.run([
    "/usr/bin/codesign",
    "--verify",
    "--strict",
    candidatePath,
  ]);
  if (candidateSignature.exitCode !== 0) {
    throw new UpdateError(`Downloaded executable failed code-signature verification: ${commandDetail(candidateSignature)}.`);
  }

  const candidateDetails = await runner.run([
    "/usr/bin/codesign",
    "--display",
    "--verbose=4",
    candidatePath,
  ]);
  if (candidateDetails.exitCode !== 0) {
    throw new UpdateError(`Downloaded executable signature details are unavailable: ${commandDetail(candidateDetails)}.`);
  }
  const currentTeam = teamIdentifier(`${currentSignature.stdout}\n${currentSignature.stderr}`);
  const candidateTeam = teamIdentifier(`${candidateDetails.stdout}\n${candidateDetails.stderr}`);
  if (currentTeam === null || candidateTeam === null || currentTeam !== candidateTeam) {
    throw new UpdateError("Downloaded executable was not signed by the current Team ID.");
  }

  const versionResult = await runner.run([candidatePath, "version"]);
  if (versionResult.exitCode !== 0 || versionResult.stdout.trim() !== expectedVersion) {
    throw new UpdateError("Downloaded executable reported an unexpected version.");
  }
}

function isBunRuntime(path: string): boolean {
  const executable = basename(path);
  return executable === "bun" || executable === "bun.exe";
}

export function isHomebrewManagedPath(path: string): boolean {
  return /\/(?:Cellar|Caskroom)\/[^/]+\/[^/]+(?:\/|$)/u.test(path);
}

export function isCompiledMacExecutable(): boolean {
  return (
    process.platform === "darwin" &&
    !isBunRuntime(process.execPath) &&
    Bun.embeddedFiles.length > 0
  );
}

async function defaultExecutablePath(): Promise<string> {
  if (!isCompiledMacExecutable()) {
    throw new UpdateError("Self-update is available only from a compiled macOS executable.");
  }
  return realpath(process.execPath);
}

async function installArtifact(
  currentPath: string,
  bytes: Uint8Array,
  expectedVersion: string,
  runner: ProcessRunner,
): Promise<void> {
  const directory = dirname(currentPath);
  const temporaryPath = join(
    directory,
    `.${basename(currentPath)}.update.${process.pid}.${crypto.randomUUID()}`,
  );
  try {
    const binary = gunzipSync(bytes);
    await writeFile(temporaryPath, binary, { mode: 0o755 });
    await chmod(temporaryPath, 0o755);
    await verifyCandidate(currentPath, temporaryPath, expectedVersion, runner);
    await rename(temporaryPath, currentPath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    if (error instanceof UpdateError) {
      throw error;
    }
    throw new UpdateError(
      `Could not install update: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export interface UpdateOptions {
  readonly currentVersion: string;
  readonly install: boolean;
  readonly manifestUrl?: string;
  readonly fetcher?: Fetcher;
  readonly runner?: ProcessRunner;
  readonly currentPath?: string;
  readonly platform?: UpdatePlatform | null;
}

export async function updateSelf(options: UpdateOptions): Promise<UpdateResult> {
  const platform = options.platform === undefined
    ? currentUpdatePlatform()
    : options.platform;
  if (platform === null) {
    return {
      status: "unsupported",
      currentVersion: options.currentVersion,
      reason: "Self-update is available only on macOS arm64 and x64.",
    };
  }

  const manifest = await fetchManifest(
    options.manifestUrl ?? UPDATE_MANIFEST_URL,
    options.fetcher ?? globalThis.fetch,
  );
  const comparison = compareVersions(options.currentVersion, manifest.version);
  if (comparison >= 0) {
    return {
      status: "up-to-date",
      currentVersion: options.currentVersion,
      latestVersion: manifest.version,
      platform,
      ...(comparison > 0 ? { reason: "Current version is newer than the release feed." } : {}),
    };
  }

  const artifact = manifest.platforms[platform];
  if (artifact === undefined) {
    throw new UpdateError(`No update artifact is available for ${platform}.`);
  }
  if (!options.install) {
    return {
      status: "available",
      currentVersion: options.currentVersion,
      latestVersion: manifest.version,
      platform,
    };
  }

  const currentPath = options.currentPath ?? (await defaultExecutablePath());
  if (isHomebrewManagedPath(currentPath)) {
    return {
      status: "unsupported",
      currentVersion: options.currentVersion,
      latestVersion: manifest.version,
      platform,
      reason: "Homebrew manages this installation; run brew upgrade --cask launchd-studio.",
    };
  }
  const bytes = await downloadArtifact(
    updateArtifactUrl(manifest.tag, platform),
    artifact,
    options.fetcher ?? globalThis.fetch,
  );
  await installArtifact(
    currentPath,
    bytes,
    manifest.version,
    options.runner ?? new BunProcessRunner(),
  );
  return {
    status: "updated",
    currentVersion: options.currentVersion,
    latestVersion: manifest.version,
    platform,
    executablePath: currentPath,
  };
}

export function autoUpdateEnabled(): boolean {
  return process.env[UPDATE_SKIP_ENV] !== "1";
}

export function spawnUpdatedProcess(
  argv: ReadonlyArray<string>,
  executablePath: string,
): void {
  const previous = process.env[UPDATE_SKIP_ENV];
  process.env[UPDATE_SKIP_ENV] = "1";
  try {
    const child = Bun.spawn([executablePath, ...argv], {
      stdin: "ignore",
      stdout: "inherit",
      stderr: "inherit",
    });
    child.unref();
  } finally {
    if (previous === undefined) {
      delete process.env[UPDATE_SKIP_ENV];
    } else {
      process.env[UPDATE_SKIP_ENV] = previous;
    }
  }
}
