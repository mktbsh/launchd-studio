import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";
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
  LogStream,
  StudioCapabilities,
  StudioTransport,
} from "@launchd-studio/core/transport";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";

type OutputTab = "plist" | "explain" | "plan" | "status" | "logs" | "doctor";

export interface LaunchdStudioAppProps {
  readonly transport: StudioTransport;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function diagnosticsTone(diagnostics: ReadonlyArray<Diagnostic>): "good" | "warning" | "bad" {
  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return "bad";
  }
  if (diagnostics.length > 0) {
    return "warning";
  }
  return "good";
}

function tabClass(active: boolean): string {
  return active
    ? "border-sky-400/60 bg-sky-400/10 text-sky-100"
    : "border-transparent text-slate-400 hover:border-slate-700 hover:text-slate-200";
}

export function LaunchdStudioApp({ transport }: LaunchdStudioAppProps) {
  const [capabilities, setCapabilities] = useState<StudioCapabilities | null>(null);
  const [source, setSource] = useState("");
  const [manifestPath, setManifestPath] = useState<string | undefined>(undefined);
  const [manifestExists, setManifestExists] = useState(false);
  const [diagnostics, setDiagnostics] = useState<ReadonlyArray<Diagnostic>>([]);
  const [jobIds, setJobIds] = useState<ReadonlyArray<string>>([]);
  const [selectedJobId, setSelectedJobId] = useState<string>("");
  const [renderedJobs, setRenderedJobs] = useState<ReadonlyArray<RenderedJob>>([]);
  const [explanations, setExplanations] = useState<ReadonlyArray<JobExplanation>>([]);
  const [plan, setPlan] = useState<ManifestPlan | undefined>(undefined);
  const [plannedSource, setPlannedSource] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<ReadonlyArray<JobStatusResponse>>([]);
  const [operations, setOperations] = useState<ReadonlyArray<ApplyOperation>>([]);
  const [logs, setLogs] = useState("");
  const [logPath, setLogPath] = useState("");
  const [logStream, setLogStream] = useState<LogStream>("stdout");
  const [doctorReports, setDoctorReports] = useState<ReadonlyArray<JobDoctorReport>>([]);
  const [activeTab, setActiveTab] = useState<OutputTab>("plist");
  const [busy, setBusy] = useState<string | null>("loading");
  const [notice, setNotice] = useState<string>("");

  const selectedRendered = useMemo(
    () => renderedJobs.find((job) => job.id === selectedJobId) ?? renderedJobs[0],
    [renderedJobs, selectedJobId],
  );
  const selectedExplanation = useMemo(
    () => explanations.find((job) => job.id === selectedJobId) ?? explanations[0],
    [explanations, selectedJobId],
  );
  const selectedStatus = useMemo(
    () => statuses.find((job) => job.jobId === selectedJobId) ?? statuses[0],
    [statuses, selectedJobId],
  );
  const selectedDoctor = useMemo(
    () => doctorReports.find((report) => report.jobId === selectedJobId) ?? doctorReports[0],
    [doctorReports, selectedJobId],
  );

  const run = useCallback(async <T,>(name: string, action: () => Promise<T>): Promise<T | undefined> => {
    setBusy(name);
    setNotice("");
    try {
      return await action();
    } catch (error) {
      setNotice(errorMessage(error));
      return undefined;
    } finally {
      setBusy(null);
    }
  }, []);

  const validate = useCallback(
    async (currentSource: string): Promise<void> => {
      const result = await transport.validateManifest(currentSource);
      setDiagnostics(result.diagnostics);
      setJobIds(result.jobIds);
      setSelectedJobId((current) =>
        result.jobIds.includes(current) ? current : result.jobIds[0] ?? "",
      );
    },
    [transport],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await run("loading", async () => {
        const [nextCapabilities, manifest] = await Promise.all([
          transport.getCapabilities(),
          transport.loadManifest(),
        ]);
        return { nextCapabilities, manifest };
      });
      if (cancelled || result === undefined) {
        return;
      }
      setCapabilities(result.nextCapabilities);
      setSource(result.manifest.source);
      setManifestPath(result.manifest.path);
      setManifestExists(result.manifest.exists);
      await validate(result.manifest.source);
      const rendered = await transport.renderManifest(result.manifest.source);
      if (!cancelled && rendered.valid) {
        setRenderedJobs(rendered.jobs);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [run, transport, validate]);

  useEffect(() => {
    if (source.length === 0) {
      return;
    }
    const timer = window.setTimeout(() => {
      void validate(source);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [source, validate]);

  const chooseJob = (value: string): void => {
    setSelectedJobId(value);
    setLogs("");
    setDoctorReports([]);
  };

  const handleSourceChange = (value: string): void => {
    setSource(value);
    setPlan(undefined);
    setPlannedSource(null);
    setOperations([]);
  };

  const handleFormat = async (): Promise<void> => {
    await run("format", async () => {
      const result = await transport.formatManifest(source);
      setDiagnostics(result.diagnostics);
      if (result.valid && result.source !== undefined) {
        handleSourceChange(result.source);
        setNotice("Formatted JSONC without removing comments.");
      }
    });
  };

  const handleRender = async (): Promise<void> => {
    await run("render", async () => {
      const result = await transport.renderManifest(source, selectedJobId || undefined);
      setDiagnostics(result.diagnostics);
      setRenderedJobs(result.jobs);
      setActiveTab("plist");
    });
  };

  const handleExplain = async (): Promise<void> => {
    await run("explain", async () => {
      const result = await transport.explainManifest(source, selectedJobId || undefined);
      setDiagnostics(result.diagnostics);
      setExplanations(result.jobs);
      setActiveTab("explain");
    });
  };

  const handleSave = async (): Promise<void> => {
    await run("save", async () => {
      const result = await transport.saveManifest(source);
      setManifestPath(result.path);
      setManifestExists(true);
      setNotice(`Saved ${result.path}`);
    });
  };

  const handlePlan = async (): Promise<void> => {
    await run("plan", async () => {
      const result = await transport.planManifest(source, selectedJobId || undefined);
      setDiagnostics(result.diagnostics);
      setPlan(result.plan);
      setPlannedSource(result.valid ? source : null);
      setOperations([]);
      setActiveTab("plan");
    });
  };

  const refreshStatus = async (): Promise<void> => {
    const result = await transport.getStatus(source, selectedJobId || undefined);
    setDiagnostics(result.diagnostics);
    setStatuses(result.jobs);
    setActiveTab("status");
  };

  const handleApply = async (): Promise<void> => {
    if (plannedSource !== source) {
      setNotice("Run Plan after the latest edit before applying.");
      return;
    }
    await run("apply", async () => {
      const result = await transport.applyManifest(source, selectedJobId || undefined, false);
      setDiagnostics(result.diagnostics);
      setOperations(result.operations);
      setPlan(result.plan);
      setNotice(result.valid ? "Applied the planned changes." : "One or more apply operations failed.");
      await refreshStatus();
    });
  };

  const handleStatus = async (): Promise<void> => {
    await run("status", refreshStatus);
  };

  const handleRemove = async (): Promise<void> => {
    if (selectedJobId.length === 0) {
      return;
    }
    const confirmed = window.confirm(
      `Unload ${selectedJobId} and remove its generated plist? The manifest entry will be retained.`,
    );
    if (!confirmed) {
      return;
    }
    await run("remove", async () => {
      const result = await transport.removeJob(source, selectedJobId, false);
      setOperations(result);
      setPlan(undefined);
      setPlannedSource(null);
      setNotice(
        result.every((entry) => entry.success)
          ? "Removed the applied LaunchAgent. The manifest entry remains available for a future apply."
          : "One or more remove operations failed.",
      );
      await refreshStatus();
    });
  };

  const handleControl = async (action: "start" | "stop" | "restart"): Promise<void> => {
    if (selectedJobId.length === 0) {
      return;
    }
    await run(action, async () => {
      const result = await transport.controlJob(source, selectedJobId, action);
      setNotice(result.message);
      await refreshStatus();
    });
  };

  const handleLogs = async (): Promise<void> => {
    if (selectedJobId.length === 0) {
      return;
    }
    await run("logs", async () => {
      const result = await transport.getLogs(source, selectedJobId, logStream, 300);
      setLogs(result.exists ? result.content : "No log file exists yet.");
      setLogPath(result.path);
      setActiveTab("logs");
    });
  };

  const handleDoctor = async (): Promise<void> => {
    await run("doctor", async () => {
      const result = await transport.doctor(source, selectedJobId || undefined);
      setDiagnostics(result.diagnostics);
      setDoctorReports(result.reports);
      setActiveTab("doctor");
    });
  };

  const local = capabilities?.mode === "local";
  const hasErrors = diagnostics.some((diagnostic) => diagnostic.severity === "error");
  const canApply = Boolean(capabilities?.apply && plannedSource === source && !hasErrors);

  return (
    <div className="min-h-screen text-slate-100">
      <header className="border-b border-slate-800/90 bg-slate-950/75 backdrop-blur">
        <div className="mx-auto flex max-w-[1800px] flex-wrap items-center justify-between gap-4 px-5 py-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-lg font-semibold tracking-tight">Launchd Studio</h1>
              <Badge tone={local ? "good" : "neutral"}>{local ? "Local CLI" : "Browser preview"}</Badge>
            </div>
            <p className="mt-1 text-sm text-slate-400">
              Intent-based JSONC for user LaunchAgents. No implicit shell, no hidden prune.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button disabled={busy !== null} onClick={() => void validate(source)}>Validate</Button>
            <Button disabled={busy !== null} onClick={() => void handleFormat()}>Format</Button>
            <Button disabled={busy !== null || hasErrors} onClick={() => void handleRender()}>Render</Button>
            <Button disabled={busy !== null || hasErrors} onClick={() => void handleExplain()}>Explain</Button>
            {capabilities?.manifestWrite ? (
              <Button disabled={busy !== null || hasErrors} onClick={() => void handleSave()}>Save</Button>
            ) : null}
            {capabilities?.plan ? (
              <Button tone="primary" disabled={busy !== null || hasErrors} onClick={() => void handlePlan()}>Plan</Button>
            ) : null}
            {capabilities?.apply ? (
              <Button tone="danger" disabled={busy !== null || !canApply} onClick={() => void handleApply()}>Apply planned</Button>
            ) : null}
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-[1800px] gap-4 p-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(420px,0.95fr)]">
        <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950/70 shadow-2xl shadow-black/20">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold">Manifest</h2>
              <p className="mt-0.5 max-w-3xl truncate text-xs text-slate-500">
                {manifestPath ?? "In-browser draft"}{local && !manifestExists ? " · not saved" : ""}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge tone={diagnosticsTone(diagnostics)}>
                {hasErrors ? "Invalid" : diagnostics.length > 0 ? `${diagnostics.length} warning(s)` : "Valid"}
              </Badge>
              <span className="text-xs text-slate-500">{source.length.toLocaleString()} chars</span>
            </div>
          </div>
          <textarea
            aria-label="Launchd Studio JSONC manifest"
            className="h-[64vh] min-h-[560px] w-full resize-y bg-transparent p-4 font-mono text-[13px] leading-6 text-slate-200 outline-none placeholder:text-slate-700"
            spellCheck={false}
            value={source}
            onChange={(event: ChangeEvent<HTMLTextAreaElement>) => handleSourceChange(event.target.value)}
          />
          <div className="border-t border-slate-800 bg-slate-950/70 px-4 py-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Diagnostics</h3>
            <div className="mt-2 max-h-36 space-y-1.5 overflow-auto">
              {diagnostics.length === 0 ? (
                <p className="text-sm text-emerald-300">No diagnostics.</p>
              ) : (
                diagnostics.map((diagnostic, index) => (
                  <div key={`${diagnostic.code}-${diagnostic.path}-${index}`} className="flex gap-2 text-sm">
                    <span className={diagnostic.severity === "error" ? "text-rose-300" : "text-amber-300"}>
                      {diagnostic.severity}
                    </span>
                    <span className="font-mono text-xs text-slate-500">{diagnostic.path}</span>
                    <span className="text-slate-300">{diagnostic.message}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>

        <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950/70 shadow-2xl shadow-black/20">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-4 py-3">
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-semibold">Output</h2>
              <select
                aria-label="Selected job"
                className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-200 outline-none focus:border-sky-500"
                value={selectedJobId}
                onChange={(event: ChangeEvent<HTMLSelectElement>) => chooseJob(event.target.value)}
              >
                {jobIds.length === 0 ? <option value="">No valid jobs</option> : null}
                {jobIds.map((jobId) => <option key={jobId} value={jobId}>{jobId}</option>)}
              </select>
            </div>
            {busy !== null ? <Badge tone="warning">{busy}</Badge> : null}
          </div>

          <nav className="flex flex-wrap gap-1 border-b border-slate-800 px-3 py-2" aria-label="Output views">
            {(["plist", "explain", "plan", "status", "logs", "doctor"] as const).map((tab) => {
              const available =
                tab === "plist" || tab === "explain" ||
                (tab === "plan" ? capabilities?.plan :
                  tab === "status" ? capabilities?.status :
                    tab === "logs" ? capabilities?.logs : capabilities?.doctor);
              if (!available) {
                return null;
              }
              return (
                <button
                  key={tab}
                  className={`rounded-md border px-2.5 py-1.5 text-xs font-medium capitalize transition ${tabClass(activeTab === tab)}`}
                  onClick={() => setActiveTab(tab)}
                >
                  {tab}
                </button>
              );
            })}
          </nav>

          <div className="h-[70vh] min-h-[620px] overflow-auto p-4">
            {activeTab === "plist" ? (
              selectedRendered === undefined ? (
                <EmptyState text="Render a valid job to inspect its plist." />
              ) : (
                <div>
                  <p className="mb-3 break-all text-xs text-slate-500">{selectedRendered.plistPath}</p>
                  <pre className="overflow-auto whitespace-pre-wrap rounded-lg border border-slate-800 bg-black/30 p-4 font-mono text-xs leading-5 text-slate-300">{selectedRendered.plist}</pre>
                </div>
              )
            ) : null}

            {activeTab === "explain" ? (
              selectedExplanation === undefined ? (
                <EmptyState text="Run Explain to inspect each launchd mapping." />
              ) : (
                <div className="space-y-3">
                  {selectedExplanation.entries.map((entry) => (
                    <article key={`${entry.source}-${entry.target}`} className="rounded-lg border border-slate-800 bg-slate-900/45 p-3">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <code className="text-sky-200">{entry.source}</code>
                        <span className="text-slate-600">→</span>
                        <code className="text-violet-200">{entry.target}</code>
                      </div>
                      <pre className="mt-2 whitespace-pre-wrap break-all font-mono text-xs text-slate-300">{entry.value}</pre>
                      {entry.note !== undefined ? <p className="mt-2 text-xs text-slate-500">{entry.note}</p> : null}
                    </article>
                  ))}
                </div>
              )
            ) : null}

            {activeTab === "plan" ? (
              <div>
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-sm text-slate-400">Plan must match the current editor source before Apply is enabled.</p>
                  <Button disabled={busy !== null || hasErrors} onClick={() => void handlePlan()}>Refresh plan</Button>
                </div>
                {plan === undefined ? <EmptyState text="Run Plan to compare desired, file, and runtime state." /> : (
                  <div className="space-y-3">
                    {plan.jobs.map((job) => (
                      <article key={job.id} className="rounded-lg border border-slate-800 bg-slate-900/45 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <strong className="text-sm">{job.id}</strong>
                          <Badge tone={job.changed ? "warning" : "good"}>{job.changed ? "change" : "in sync"}</Badge>
                        </div>
                        <dl className="mt-3 grid grid-cols-[7rem_1fr] gap-2 text-xs">
                          <dt className="text-slate-500">File</dt><dd>{job.fileAction}</dd>
                          <dt className="text-slate-500">Runtime</dt><dd>{job.runtimeAction}</dd>
                          <dt className="text-slate-500">Definition</dt>
                          <dd>
                            {job.runtime.loaded === true
                              ? job.runtimeDefinitionMatches === true
                                ? "tracked"
                                : "reload required"
                              : "not loaded"}
                          </dd>
                          <dt className="text-slate-500">Path</dt><dd className="break-all font-mono text-slate-400">{job.plistPath}</dd>
                        </dl>
                      </article>
                    ))}
                    {operations.length > 0 ? (
                      <div className="rounded-lg border border-slate-800 bg-black/20 p-3">
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Last apply</h3>
                        <div className="mt-2 space-y-1">
                          {operations.map((entry, index) => (
                            <p key={`${entry.jobId}-${entry.action}-${index}`} className={entry.success ? "text-sm text-emerald-300" : "text-sm text-rose-300"}>
                              {entry.jobId} · {entry.action} · {entry.message}
                            </p>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            ) : null}

            {activeTab === "status" ? (
              <div>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex gap-2">
                    <Button disabled={busy !== null} onClick={() => void handleStatus()}>Refresh</Button>
                    {capabilities?.control ? (
                      <>
                        <Button disabled={busy !== null || selectedJobId.length === 0} onClick={() => void handleControl("start")}>Start</Button>
                        <Button disabled={busy !== null || selectedJobId.length === 0} onClick={() => void handleControl("stop")}>Stop</Button>
                        <Button tone="danger" disabled={busy !== null || selectedJobId.length === 0} onClick={() => void handleControl("restart")}>Restart</Button>
                      </>
                    ) : null}
                    {capabilities?.remove ? (
                      <Button
                        tone="danger"
                        disabled={busy !== null || selectedJobId.length === 0}
                        onClick={() => void handleRemove()}
                      >
                        Remove applied
                      </Button>
                    ) : null}
                  </div>
                </div>
                {selectedStatus === undefined ? <EmptyState text="Refresh Status to inspect launchd runtime state." /> : (
                  <article className="rounded-lg border border-slate-800 bg-slate-900/45 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <strong>{selectedStatus.jobId}</strong>
                      <Badge tone={selectedStatus.runtime.running ? "good" : selectedStatus.runtime.loaded ? "warning" : "neutral"}>
                        {!selectedStatus.runtime.supported ? "unavailable" : selectedStatus.runtime.running ? "running" : selectedStatus.runtime.loaded ? "loaded" : "unloaded"}
                      </Badge>
                    </div>
                    <dl className="mt-4 grid grid-cols-[8rem_1fr] gap-2 text-sm">
                      <dt className="text-slate-500">Plist</dt><dd>{selectedStatus.plistExists ? selectedStatus.drifted ? "drifted" : "in sync" : "not applied"}</dd>
                      <dt className="text-slate-500">Definition</dt>
                      <dd>
                        {selectedStatus.runtimeDefinitionDrifted === null
                          ? "not loaded"
                          : selectedStatus.runtimeDefinitionDrifted
                            ? "untracked or drifted"
                            : "tracked"}
                      </dd>
                      <dt className="text-slate-500">PID</dt><dd>{selectedStatus.runtime.pid ?? "—"}</dd>
                      <dt className="text-slate-500">Runs</dt><dd>{selectedStatus.runtime.runs ?? "—"}</dd>
                      <dt className="text-slate-500">Last exit</dt><dd>{selectedStatus.runtime.lastExitCode ?? "—"}</dd>
                      <dt className="text-slate-500">Path</dt><dd className="break-all font-mono text-xs text-slate-400">{selectedStatus.plistPath}</dd>
                    </dl>
                  </article>
                )}
              </div>
            ) : null}

            {activeTab === "logs" ? (
              <div>
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <select className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm" value={logStream} onChange={(event: ChangeEvent<HTMLSelectElement>) => setLogStream(event.target.value as LogStream)}>
                    <option value="stdout">stdout</option>
                    <option value="stderr">stderr</option>
                  </select>
                  <Button disabled={busy !== null || selectedJobId.length === 0} onClick={() => void handleLogs()}>Refresh logs</Button>
                </div>
                {logPath.length > 0 ? <p className="mb-3 break-all font-mono text-xs text-slate-500">{logPath}</p> : null}
                <pre className="min-h-96 whitespace-pre-wrap break-words rounded-lg border border-slate-800 bg-black/35 p-4 font-mono text-xs leading-5 text-slate-300">{logs || "No logs loaded."}</pre>
              </div>
            ) : null}

            {activeTab === "doctor" ? (
              <div>
                <div className="mb-3"><Button disabled={busy !== null} onClick={() => void handleDoctor()}>Run doctor</Button></div>
                {selectedDoctor === undefined ? <EmptyState text="Run Doctor to inspect common launchd failure causes." /> : (
                  <div className="space-y-2">
                    {selectedDoctor.checks.map((check) => (
                      <article key={check.id} className="flex items-start justify-between gap-3 rounded-lg border border-slate-800 bg-slate-900/45 p-3">
                        <div><p className="text-sm text-slate-200">{check.message}</p>{check.detail !== undefined ? <p className="mt-1 text-xs text-slate-500">{check.detail}</p> : null}</div>
                        <Badge tone={check.status === "pass" ? "good" : check.status === "fail" ? "bad" : check.status === "warning" ? "warning" : "neutral"}>{check.status}</Badge>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </section>
      </main>

      {notice.length > 0 ? (
        <div className="fixed bottom-4 left-1/2 z-20 max-w-[min(92vw,760px)] -translate-x-1/2 rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-slate-200 shadow-2xl shadow-black/50">
          {notice}
        </div>
      ) : null}
    </div>
  );
}

function EmptyState({ text }: { readonly text: string }) {
  return <div className="flex min-h-80 items-center justify-center rounded-lg border border-dashed border-slate-800 text-center text-sm text-slate-500">{text}</div>;
}
