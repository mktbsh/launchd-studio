import type {
  Diagnostic,
  JobDoctorReport,
  JobExplanation,
  ManifestPlan,
  RenderedJob,
} from "@launchd-studio/core";
import type {
  ApplyOperation,
  JobStatusResponse,
  LogsResponse,
} from "@launchd-studio/core/transport";

const useColor = Boolean(process.stdout.isTTY && !process.env.NO_COLOR);
const ansi = {
  reset: useColor ? "\u001b[0m" : "",
  red: useColor ? "\u001b[31m" : "",
  yellow: useColor ? "\u001b[33m" : "",
  green: useColor ? "\u001b[32m" : "",
  cyan: useColor ? "\u001b[36m" : "",
  dim: useColor ? "\u001b[2m" : "",
};

export function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

export function printDiagnostics(diagnostics: ReadonlyArray<Diagnostic>): void {
  for (const diagnostic of diagnostics) {
    const marker = diagnostic.severity === "error" ? "error" : "warning";
    const color = diagnostic.severity === "error" ? ansi.red : ansi.yellow;
    const location =
      diagnostic.line === undefined
        ? diagnostic.path
        : `${diagnostic.path}:${diagnostic.line}:${diagnostic.column ?? 1}`;
    console.error(
      `${color}${marker}${ansi.reset} ${location} ${diagnostic.message} ${ansi.dim}[${diagnostic.code}]${ansi.reset}`,
    );
  }
}

export function printRenderedJobs(jobs: ReadonlyArray<RenderedJob>): void {
  for (const [index, job] of jobs.entries()) {
    if (jobs.length > 1) {
      if (index > 0) {
        console.log();
      }
      console.log(`${ansi.cyan}# ${job.id} -> ${job.plistPath}${ansi.reset}`);
    }
    process.stdout.write(job.plist);
  }
}

export function printExplanations(jobs: ReadonlyArray<JobExplanation>): void {
  for (const [index, job] of jobs.entries()) {
    if (index > 0) {
      console.log();
    }
    console.log(`${ansi.cyan}${job.id}${ansi.reset} (${job.kind})`);
    console.log(`  label: ${job.label}`);
    console.log(`  plist: ${job.plistPath}`);
    for (const entry of job.entries) {
      console.log(`  ${entry.source} -> ${entry.target}: ${entry.value}`);
      if (entry.note !== undefined) {
        console.log(`    ${ansi.dim}${entry.note}${ansi.reset}`);
      }
    }
  }
}

export function printPlan(plan: ManifestPlan): void {
  for (const job of plan.jobs) {
    const marker = job.changed ? "~" : "=";
    const color = job.changed ? ansi.yellow : ansi.green;
    console.log(`${color}${marker} ${job.id}${ansi.reset}`);
    console.log(`  file: ${job.fileAction} (${job.plistPath})`);
    console.log(`  runtime: ${job.runtimeAction}`);
    if (job.runtime.loaded === true) {
      console.log(
        `  runtime definition: ${job.runtimeDefinitionMatches === true ? "tracked" : "reload required"}`,
      );
    }
  }
  console.log(
    `Plan: ${plan.summary.create} create, ${plan.summary.update} update, ${plan.summary.load} load, ${plan.summary.reload} reload, ${plan.summary.unchanged} unchanged`,
  );
}

export function printOperations(operations: ReadonlyArray<ApplyOperation>): void {
  for (const entry of operations) {
    const marker = entry.success ? "ok" : "failed";
    const color = entry.success ? ansi.green : ansi.red;
    console.log(`${color}${marker}${ansi.reset} ${entry.jobId} ${entry.action}: ${entry.message}`);
  }
}

export function printStatuses(jobs: ReadonlyArray<JobStatusResponse>): void {
  for (const job of jobs) {
    const runtime = !job.runtime.supported
      ? "unavailable"
      : job.runtime.loaded === null
        ? "unknown"
        : !job.runtime.loaded
        ? "unloaded"
        : job.runtime.running
          ? `running${job.runtime.pid === undefined ? "" : ` (pid ${job.runtime.pid})`}`
          : "loaded, not running";
    const drift = !job.plistExists ? "not applied" : job.drifted ? "drifted" : "in sync";
    const runtimeDefinition =
      job.runtimeDefinitionDrifted === null
        ? "runtime definition n/a"
        : job.runtimeDefinitionDrifted
          ? "runtime definition drifted"
          : "runtime definition tracked";
    console.log(
      `${ansi.cyan}${job.jobId}${ansi.reset}: ${runtime}; ${drift}; ${runtimeDefinition}`,
    );
    if (job.runtime.lastExitCode !== undefined) {
      console.log(`  last exit code: ${job.runtime.lastExitCode}`);
    }
    if (job.runtime.detail !== undefined && !job.runtime.loaded) {
      console.log(`  ${ansi.dim}${job.runtime.detail}${ansi.reset}`);
    }
  }
}

export function printDoctorReports(reports: ReadonlyArray<JobDoctorReport>): void {
  for (const report of reports) {
    console.log(`${ansi.cyan}${report.jobId}${ansi.reset} (${report.label})`);
    for (const check of report.checks) {
      const marker =
        check.status === "pass"
          ? "✓"
          : check.status === "fail"
            ? "✗"
            : check.status === "warning"
              ? "!"
              : "-";
      const color =
        check.status === "pass"
          ? ansi.green
          : check.status === "fail"
            ? ansi.red
            : check.status === "warning"
              ? ansi.yellow
              : ansi.dim;
      console.log(`  ${color}${marker}${ansi.reset} ${check.message}`);
      if (check.detail !== undefined) {
        console.log(`    ${ansi.dim}${check.detail}${ansi.reset}`);
      }
    }
  }
}

export function printLogs(logs: LogsResponse): void {
  if (!logs.exists) {
    console.error(`Log file does not exist: ${logs.path}`);
    return;
  }
  if (logs.truncated) {
    console.error(`${ansi.dim}Showing the tail of ${logs.path}.${ansi.reset}`);
  }
  process.stdout.write(logs.content);
  if (logs.content.length > 0 && !logs.content.endsWith("\n")) {
    process.stdout.write("\n");
  }
}
