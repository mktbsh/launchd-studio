import type { RuntimeJobStatus } from "@launchd-studio/core";

export interface CommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface ProcessRunner {
  run(argv: readonly [string, ...string[]]): Promise<CommandResult>;
}

export class BunProcessRunner implements ProcessRunner {
  async run(argv: readonly [string, ...string[]]): Promise<CommandResult> {
    const processHandle = Bun.spawn([...argv], {
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      processHandle.exited,
      new Response(processHandle.stdout).text(),
      new Response(processHandle.stderr).text(),
    ]);
    return { exitCode, stdout, stderr };
  }
}

function parseInteger(output: string, key: string): number | undefined {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = new RegExp(`^\\s*${escaped}\\s*=\\s*(-?\\d+)\\s*$`, "mu").exec(output);
  return match?.[1] === undefined ? undefined : Number.parseInt(match[1], 10);
}

export function parseLaunchctlPrint(output: string): RuntimeJobStatus {
  const stateMatch = /^\s*state\s*=\s*(.+?)\s*$/mu.exec(output);
  const state = stateMatch?.[1];
  const pid = parseInteger(output, "pid");
  const runs = parseInteger(output, "runs");
  const lastExitCode = parseInteger(output, "last exit code");
  return {
    supported: true,
    loaded: true,
    running: state === "running" || pid !== undefined,
    ...(state !== undefined ? { state } : {}),
    ...(pid !== undefined ? { pid } : {}),
    ...(runs !== undefined ? { runs } : {}),
    ...(lastExitCode !== undefined ? { lastExitCode } : {}),
  };
}

export class LaunchdAdapter {
  readonly #runner: ProcessRunner;
  readonly #uid: number | null;

  constructor(runner: ProcessRunner = new BunProcessRunner()) {
    this.#runner = runner;
    this.#uid = typeof process.getuid === "function" ? process.getuid() : null;
  }

  get supported(): boolean {
    return process.platform === "darwin" && this.#uid !== null;
  }

  get domain(): string | null {
    return this.#uid === null ? null : `gui/${this.#uid}`;
  }

  serviceTarget(label: string): string {
    const domain = this.domain;
    if (domain === null) {
      throw new Error("Unable to determine the current user launchd domain.");
    }
    return `${domain}/${label}`;
  }

  async status(label: string): Promise<RuntimeJobStatus> {
    if (!this.supported) {
      return {
        supported: false,
        loaded: null,
        running: null,
        detail: "launchctl operations are available only on macOS user sessions.",
      };
    }

    const result = await this.#runner.run([
      "/bin/launchctl",
      "print",
      this.serviceTarget(label),
    ]);
    if (result.exitCode === 0) {
      return parseLaunchctlPrint(result.stdout);
    }

    const detail = (result.stderr || result.stdout).trim();
    const missing = /could not find service|service .* not found|no such process/iu.test(detail);
    if (missing) {
      return {
        supported: true,
        loaded: false,
        running: false,
        ...(detail.length > 0 ? { detail } : {}),
      };
    }
    return {
      supported: true,
      loaded: null,
      running: null,
      detail: detail.length > 0 ? detail : "launchctl did not return service state.",
    };
  }

  async lint(plistPath: string): Promise<CommandResult> {
    this.assertSupported();
    return this.#runner.run(["/usr/bin/plutil", "-lint", "--", plistPath]);
  }

  async bootstrap(plistPath: string): Promise<CommandResult> {
    this.assertSupported();
    return this.#runner.run([
      "/bin/launchctl",
      "bootstrap",
      this.domain as string,
      plistPath,
    ]);
  }

  async bootout(label: string): Promise<CommandResult> {
    this.assertSupported();
    return this.#runner.run([
      "/bin/launchctl",
      "bootout",
      this.serviceTarget(label),
    ]);
  }

  async kickstart(label: string, force: boolean): Promise<CommandResult> {
    this.assertSupported();
    return this.#runner.run([
      "/bin/launchctl",
      "kickstart",
      ...(force ? ["-k"] : []),
      this.serviceTarget(label),
    ] as [string, ...string[]]);
  }

  assertSupported(): void {
    if (!this.supported) {
      throw new Error("launchd mutation requires macOS and a logged-in user session.");
    }
  }
}

export function commandFailureMessage(result: CommandResult): string {
  const detail = (result.stderr || result.stdout).trim();
  return detail.length > 0 ? detail : `Command exited with code ${result.exitCode}.`;
}
