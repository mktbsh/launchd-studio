import { useCallback, useEffect, useMemo, useState } from "react";
import type { Diagnostic, RenderedJob } from "@launchd-studio/core";
import type {
  ControlAction,
  JobStatusResponse,
  LogStream,
  SelfServiceOffer,
  StudioCapabilities,
  StudioTransport,
} from "@launchd-studio/core/transport";
import { Inspector } from "./Inspector";
import { Overview } from "./Overview";
import { PressButton, Sheet, StatusDot, TextInput } from "./controls";
import {
  changedJobIds,
  draftToSource,
  dropJob,
  EMPTY_DRAFT,
  jobIds,
  jobState,
  newJob,
  parseDraft,
  putJob,
  renameJob,
  stateDetail,
  stateTone,
  uniqueJobId,
  type ManifestDraft,
} from "./draft";

export interface LaunchdStudioAppProps {
  readonly transport: StudioTransport;
}

interface LoadedLogs {
  readonly jobId: string;
  readonly stream: LogStream;
  readonly path: string;
  readonly content: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function LaunchdStudioApp({ transport }: LaunchdStudioAppProps) {
  const [capabilities, setCapabilities] = useState<StudioCapabilities | null>(null);
  const [draft, setDraft] = useState<ManifestDraft>(EMPTY_DRAFT);
  const [savedDraft, setSavedDraft] = useState<ManifestDraft>(EMPTY_DRAFT);
  const [savedSource, setSavedSource] = useState("");
  const [manifestPath, setManifestPath] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [diagnostics, setDiagnostics] = useState<ReadonlyArray<Diagnostic>>([]);
  const [renderedJobs, setRenderedJobs] = useState<ReadonlyArray<RenderedJob>>([]);
  const [statuses, setStatuses] = useState<ReadonlyArray<JobStatusResponse>>([]);
  const [logs, setLogs] = useState<LoadedLogs | null>(null);
  const [busy, setBusy] = useState<string | null>("loading");
  const [notice, setNotice] = useState("");
  const [sourceSheet, setSourceSheet] = useState<string | null>(null);

  const source = useMemo(() => draftToSource(draft), [draft]);
  const changed = useMemo(() => changedJobIds(draft, savedDraft), [draft, savedDraft]);
  const removed = useMemo(
    () => changed.filter((id) => draft.jobs[id] === undefined),
    [changed, draft],
  );
  const hasErrors = diagnostics.some((diagnostic) => diagnostic.severity === "error");
  const ids = useMemo(() => jobIds(draft), [draft]);

  const run = useCallback(
    async <T,>(name: string, action: () => Promise<T>): Promise<T | undefined> => {
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
    },
    [],
  );

  const refreshStatus = useCallback(
    async (current: string): Promise<void> => {
      const result = await transport.getStatus(current);
      setStatuses(result.jobs);
    },
    [transport],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const loaded = await run("loading", async () => {
        const [nextCapabilities, manifest] = await Promise.all([
          transport.getCapabilities(),
          transport.loadManifest(),
        ]);
        return { nextCapabilities, manifest };
      });
      if (cancelled || loaded === undefined) {
        return;
      }
      setCapabilities(loaded.nextCapabilities);
      setManifestPath(loaded.manifest.path);
      setSavedSource(loaded.manifest.source);

      const parsed = parseDraft(loaded.manifest.source);
      setDiagnostics(parsed.diagnostics);
      if (parsed.draft === undefined) {
        // Nothing safe to put in the form; the raw source is the only way back.
        setSourceSheet(loaded.manifest.source);
        return;
      }
      setDraft(parsed.draft);
      setSavedDraft(parsed.draft);
      await refreshStatus(loaded.manifest.source).catch(() => undefined);
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshStatus, run, transport]);

  useEffect(() => {
    if (capabilities === null) {
      return;
    }
    const timer = window.setTimeout(() => {
      void transport
        .renderManifest(source)
        .then((result) => {
          setDiagnostics(result.diagnostics);
          setRenderedJobs(result.jobs);
        })
        .catch((error: unknown) => setNotice(errorMessage(error)));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [capabilities, source, transport]);

  const selected = selectedId === null ? undefined : draft.jobs[selectedId];

  const openJob = (id: string): void => {
    setSelectedId(id);
    setLogs(null);
  };

  const addJob = (): void => {
    const id = uniqueJobId(draft, "new-job");
    setDraft(putJob(draft, id, newJob("service")));
    openJob(id);
  };

  const addSelfService = (offer: SelfServiceOffer): void => {
    setDraft(putJob(draft, offer.id, offer.job));
    openJob(offer.id);
    setNotice(`Install the staged change, then open ${offer.url}.`);
  };

  const install = async (): Promise<void> => {
    await run("install", async () => {
      for (const id of removed) {
        await transport.removeJob(savedSource, id, false);
      }
      await transport.saveManifest(source);
      const result = await transport.applyManifest(source);
      setDiagnostics(result.diagnostics);
      if (!result.valid) {
        setNotice("One or more operations failed.");
        return;
      }
      setSavedDraft(draft);
      setSavedSource(source);
      setNotice(`Installed ${changed.length} ${changed.length === 1 ? "change" : "changes"}.`);
      await refreshStatus(source);
    });
  };

  const control = async (id: string, action: ControlAction): Promise<void> => {
    await run(action, async () => {
      const result = await transport.controlJob(source, id, action);
      setNotice(result.message);
      await refreshStatus(source);
    });
  };

  const uninstall = async (id: string): Promise<void> => {
    if (!window.confirm(`Unload ${id} and remove its generated plist? The manifest entry stays.`)) {
      return;
    }
    await run("uninstall", async () => {
      const operations = await transport.removeJob(source, id, false);
      setNotice(
        operations.every((entry) => entry.success) ? `Uninstalled ${id}.` : "One or more operations failed.",
      );
      await refreshStatus(source);
    });
  };

  const loadLogs = async (id: string, stream: LogStream): Promise<void> => {
    await run("logs", async () => {
      const result = await transport.getLogs(source, id, stream, 300);
      setLogs({
        jobId: id,
        stream,
        path: result.path,
        content: result.exists ? result.content : "",
      });
    });
  };

  const applySourceSheet = (text: string): void => {
    const parsed = parseDraft(text);
    setDiagnostics(parsed.diagnostics);
    if (parsed.draft === undefined) {
      setNotice("The manifest could not be parsed.");
      return;
    }
    setDraft(parsed.draft);
    setSourceSheet(null);
    setNotice("");
  };

  if (capabilities === null) {
    return (
      <div className="flex min-h-screen items-center justify-center text-[13px] text-[var(--text-3)]">
        Loading…
      </div>
    );
  }

  const visible = ids.filter((id) =>
    `${id} ${draft.jobs[id]?.description ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <div className="grid h-screen grid-cols-[17rem_minmax(0,1fr)] overflow-hidden">
      <aside className="flex flex-col overflow-hidden border-r border-[var(--hairline)] bg-[var(--surface-1)]">
        <div className="flex items-center justify-between px-4 pb-2 pt-5">
          <h1 className="text-[15px] font-semibold tracking-[-0.01em]">Launchd Studio</h1>
          <PressButton onClick={addJob} aria-label="New job" className="!min-h-7 !px-2">+</PressButton>
        </div>
        <div className="px-3 pb-2">
          <TextInput value={query} onChange={setQuery} placeholder="Search" aria-label="Search jobs" />
        </div>

        <nav className="ui-scroll flex-1 overflow-auto px-2 pb-3">
          <button
            type="button"
            onClick={() => setSelectedId(null)}
            className={`ui-row mb-3 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left ${
              selectedId === null ? "bg-[var(--surface-3)]" : "hover:bg-[var(--surface-2)]"
            }`}
          >
            <StatusDot tone={hasErrors ? "red" : changed.length > 0 ? "amber" : "green"} />
            <span className="text-[13px] font-medium">Overview</span>
          </button>

          {(["service", "task"] as const).map((kind) => {
            const rows = visible.filter((id) => draft.jobs[id]?.kind === kind);
            if (rows.length === 0) {
              return null;
            }
            return (
              <div key={kind} className="mb-3">
                <h2 className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-3)]">
                  {kind === "service" ? "Always on" : "Scheduled"}
                </h2>
                {rows.map((id) => {
                  const status = statuses.find((entry) => entry.jobId === id);
                  const state = jobState(kind, status);
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => openJob(id)}
                      className={`ui-row flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left ${
                        id === selectedId ? "bg-[var(--surface-3)]" : "hover:bg-[var(--surface-2)]"
                      }`}
                    >
                      <StatusDot tone={stateTone(state)} pulse={state === "running"} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium">{id}</span>
                        <span className="block truncate text-[11.5px] text-[var(--text-3)]">
                          {stateDetail(state, status)}
                        </span>
                      </span>
                      {changed.includes(id) ? (
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--sys-amber)]" />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </nav>

        <div className="border-t border-[var(--hairline)] p-3">
          {diagnostics.length > 0 ? (
            <div className="ui-scroll mb-2 max-h-32 overflow-auto rounded-xl border border-[color-mix(in_srgb,var(--sys-red)_35%,transparent)] bg-[color-mix(in_srgb,var(--sys-red)_10%,transparent)] p-2.5">
              {diagnostics.map((diagnostic, index) => (
                <p key={`${diagnostic.code}-${diagnostic.path}-${index}`} className="text-[11.5px] leading-4 text-[var(--text-2)]">
                  <span className="font-mono text-[var(--text-3)]">{diagnostic.path}</span> {diagnostic.message}
                </p>
              ))}
            </div>
          ) : null}

          {changed.length > 0 ? (
            <div className="ui-enter mb-2 rounded-xl border border-[color-mix(in_srgb,var(--sys-amber)_35%,transparent)] bg-[color-mix(in_srgb,var(--sys-amber)_10%,transparent)] p-3">
              <p className="text-[12.5px] text-[var(--text-1)]">
                {changed.length} {changed.length === 1 ? "change" : "changes"} not installed
              </p>
              {capabilities.launchd ? (
                <PressButton
                  variant="filled"
                  className="mt-2 w-full"
                  disabled={busy !== null || hasErrors}
                  onClick={() => void install()}
                >
                  Install {changed.length} {changed.length === 1 ? "change" : "changes"}
                </PressButton>
              ) : (
                <PressButton
                  className="mt-2 w-full"
                  onClick={() => {
                    void navigator.clipboard.writeText(source);
                    setNotice("Manifest copied to the clipboard.");
                  }}
                >
                  Copy manifest
                </PressButton>
              )}
            </div>
          ) : null}

          <button
            type="button"
            onClick={() => setSourceSheet(source)}
            className="ui-press w-full truncate rounded-lg px-2 py-1.5 text-left text-[11.5px] text-[var(--text-3)] hover:text-[var(--text-1)]"
          >
            {manifestPath}
          </button>
        </div>
      </aside>

      {selectedId === null || selected === undefined ? (
        <Overview
          draft={draft}
          statuses={statuses}
          changed={changed}
          busy={busy !== null}
          onOpen={openJob}
          onAdd={addJob}
          onRefresh={() => void run("status", () => refreshStatus(source))}
          onAddSelfService={
            draft.jobs[capabilities.selfService.id] === undefined
              ? () => addSelfService(capabilities.selfService)
              : null
          }
        />
      ) : (
        <Inspector
          key={selectedId}
          id={selectedId}
          job={selected}
          status={statuses.find((entry) => entry.jobId === selectedId)}
          rendered={renderedJobs.find((entry) => entry.id === selectedId)}
          dirty={changed.includes(selectedId)}
          busy={busy !== null}
          capabilities={capabilities}
          logs={logs?.jobId === selectedId ? logs : null}
          onChange={(job) => setDraft(putJob(draft, selectedId, job))}
          onRename={(next) => {
            if (next.length === 0 || draft.jobs[next] !== undefined) {
              return;
            }
            setDraft(renameJob(draft, selectedId, next));
            setSelectedId(next);
          }}
          onDelete={() => {
            setDraft(dropJob(draft, selectedId));
            setSelectedId(null);
          }}
          onControl={(action) => void control(selectedId, action)}
          onUninstall={() => void uninstall(selectedId)}
          onLoadLogs={(stream) => void loadLogs(selectedId, stream)}
        />
      )}

      <Sheet
        open={sourceSheet !== null}
        onClose={() => setSourceSheet(null)}
        title={<h2 className="text-[15px] font-semibold">Manifest source</h2>}
        footer={
          <div className="flex justify-end gap-2">
            <PressButton onClick={() => setSourceSheet(source)}>Reset</PressButton>
            <PressButton
              variant="filled"
              onClick={() => applySourceSheet(sourceSheet ?? source)}
            >
              Use this source
            </PressButton>
          </div>
        }
      >
        <textarea
          aria-label="Manifest source"
          spellCheck={false}
          value={sourceSheet ?? ""}
          onChange={(event) => setSourceSheet(event.target.value)}
          className="ui-scroll h-[70vh] w-full resize-none rounded-xl border border-[var(--hairline)] bg-black/30 p-4 font-mono text-[12.5px] leading-5 text-[var(--text-1)] outline-none focus:border-[var(--sys-blue)]"
        />
      </Sheet>

      {notice.length > 0 ? (
        <button
          type="button"
          onClick={() => setNotice("")}
          className="ui-enter ui-chrome fixed bottom-4 left-1/2 z-50 max-w-[min(92vw,44rem)] -translate-x-1/2 rounded-xl border border-[var(--hairline-strong)] px-4 py-3 text-[13px] text-[var(--text-1)] shadow-[0_10px_40px_rgb(0_0_0/0.5)]"
        >
          {notice}
        </button>
      ) : null}
    </div>
  );
}
