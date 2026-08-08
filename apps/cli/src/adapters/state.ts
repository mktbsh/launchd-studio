import { createHash } from "node:crypto";
import { join } from "node:path";
import { readTextIfExists, writeTextAtomic } from "./filesystem";

export interface ManagedJobRecord {
  readonly jobId: string;
  readonly label: string;
  readonly plistPath: string;
  readonly plistHash: string;
  readonly manifestPath: string;
  readonly appliedAt: string;
}

interface ManagedStateV1 {
  readonly version: 1;
  readonly jobs: Readonly<Record<string, ManagedJobRecord>>;
}

const EMPTY_STATE: ManagedStateV1 = { version: 1, jobs: {} };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(
  record: Readonly<Record<string, unknown>>,
  field: keyof ManagedJobRecord,
  label: string,
): string {
  const value = record[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Invalid ${field} in managed state record for ${label}.`);
  }
  return value;
}

function parseManagedRecord(value: unknown, keyLabel: string): ManagedJobRecord {
  if (!isRecord(value)) {
    throw new Error(`Invalid managed state record for ${keyLabel}.`);
  }

  const record: ManagedJobRecord = {
    jobId: requiredString(value, "jobId", keyLabel),
    label: requiredString(value, "label", keyLabel),
    plistPath: requiredString(value, "plistPath", keyLabel),
    plistHash: requiredString(value, "plistHash", keyLabel),
    manifestPath: requiredString(value, "manifestPath", keyLabel),
    appliedAt: requiredString(value, "appliedAt", keyLabel),
  };
  if (record.label !== keyLabel) {
    throw new Error(`Managed state label key does not match record label ${record.label}.`);
  }
  return record;
}

function parseState(source: string): ManagedStateV1 {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch (error) {
    throw new Error(
      `Managed state is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!isRecord(value) || value.version !== 1 || !isRecord(value.jobs)) {
    throw new Error("Managed state must contain version 1 and a jobs object.");
  }

  const jobs: Record<string, ManagedJobRecord> = {};
  for (const [label, candidate] of Object.entries(value.jobs)) {
    jobs[label] = parseManagedRecord(candidate, label);
  }
  return { version: 1, jobs };
}

export function hashPlist(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export class ManagedStateStore {
  readonly #path: string;
  #mutationTail: Promise<void> = Promise.resolve();

  constructor(path: string) {
    this.#path = path;
  }

  get path(): string {
    return this.#path;
  }

  async get(label: string): Promise<ManagedJobRecord | null> {
    const state = await this.#load();
    return state.jobs[label] ?? null;
  }

  async findByJobId(jobId: string, manifestPath: string): Promise<ManagedJobRecord | null> {
    const state = await this.#load();
    const matches = Object.values(state.jobs).filter(
      (record) => record.jobId === jobId && record.manifestPath === manifestPath,
    );
    if (matches.length > 1) {
      throw new Error(
        `Managed state contains multiple records for job ${jobId} and manifest ${manifestPath}.`,
      );
    }
    return matches[0] ?? null;
  }

  record(record: ManagedJobRecord): Promise<void> {
    return this.#mutate((state) => ({
      version: 1,
      jobs: {
        ...state.jobs,
        [record.label]: record,
      },
    }));
  }

  remove(label: string): Promise<void> {
    return this.#mutate((state) => {
      const jobs = { ...state.jobs };
      delete jobs[label];
      return { version: 1, jobs };
    });
  }

  async #load(): Promise<ManagedStateV1> {
    const source = await readTextIfExists(this.#path);
    return source === null ? EMPTY_STATE : parseState(source);
  }

  #mutate(action: (state: ManagedStateV1) => ManagedStateV1): Promise<void> {
    const mutation = this.#mutationTail.then(async () => {
      const current = await this.#load();
      const next = action(current);
      await writeTextAtomic(this.#path, `${JSON.stringify(next, null, 2)}\n`, 0o600);
    });
    this.#mutationTail = mutation.catch(() => undefined);
    return mutation;
  }
}

export function defaultManagedStatePath(homeDirectory: string): string {
  return join(
    homeDirectory,
    "Library",
    "Application Support",
    "launchd-studio",
    "state.json",
  );
}

export function defaultTokenPath(homeDirectory: string): string {
  return join(
    homeDirectory,
    "Library",
    "Application Support",
    "launchd-studio",
    "web-ui-token",
  );
}

// The token outlives the process so a Web UI running as a LaunchAgent keeps the
// same bookmarkable URL across restarts.
export async function readOrCreateToken(path: string): Promise<string> {
  const existing = (await readTextIfExists(path))?.trim();
  if (existing !== undefined && existing.length > 0) {
    return existing;
  }
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const token = Buffer.from(bytes).toString("base64url");
  await writeTextAtomic(path, `${token}\n`, 0o600);
  return token;
}
