import type { JobDefinition } from "@launchd-studio/core";
import type { JobStatusResponse, StudioCapabilities } from "@launchd-studio/core/transport";
import { Chip, EmptyState, PressButton, StatusDot } from "./controls";
import {
  jobIds,
  jobState,
  JOB_STATES,
  scheduleSummary,
  stateDetail,
  stateLabel,
  stateTone,
  type ManifestDraft,
  type Tone,
} from "./draft";

export interface OverviewProps {
  readonly draft: ManifestDraft;
  readonly statuses: ReadonlyArray<JobStatusResponse>;
  readonly changed: ReadonlyArray<string>;
  readonly capabilities: StudioCapabilities;
  readonly busy: boolean;
  readonly onOpen: (id: string) => void;
  readonly onAdd: () => void;
  readonly onRefresh: () => void;
}

export function Overview(props: OverviewProps) {
  const { draft, statuses, changed, capabilities, busy } = props;
  const ids = jobIds(draft);
  const states = ids.map((id) => ({
    id,
    job: draft.jobs[id] as JobDefinition,
    state: jobState((draft.jobs[id] as JobDefinition).kind, findStatus(statuses, id)),
  }));
  const failing = states.filter((entry) => entry.state === "failed").length;
  const unapplied = states.filter((entry) => entry.state === "unapplied").length;
  const pending = Math.max(changed.length, unapplied);
  const tone: Tone = failing > 0 ? "red" : pending > 0 ? "amber" : "green";

  return (
    <main className="ui-scroll relative overflow-auto">
      <header className="ui-chrome sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-[var(--hairline)] px-7 py-3.5">
        <h2 className="text-[15px] font-semibold">Overview</h2>
        <div className="flex items-center gap-2">
          {capabilities.status ? (
            <PressButton disabled={busy} onClick={props.onRefresh}>Refresh</PressButton>
          ) : null}
          <PressButton variant="filled" onClick={props.onAdd}>New job</PressButton>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-7 py-6">
        <section className="mb-6 rounded-2xl border border-[var(--hairline)] bg-[var(--surface-1)] px-6 py-5">
          <div className="flex items-center gap-3">
            <StatusDot tone={tone} pulse={tone === "green"} />
            <h3 className="text-[21px] font-semibold tracking-[-0.02em]">
              {headline(ids.length, failing, pending)}
            </h3>
          </div>
          <dl className="mt-4 flex flex-wrap gap-x-7 gap-y-2">
            {JOB_STATES.map((state) => {
              const count = states.filter((entry) => entry.state === state).length;
              return count === 0 ? null : (
                <div key={state} className="flex items-baseline gap-2">
                  <dt className="text-[12.5px] text-[var(--text-3)]">{stateLabel(state)}</dt>
                  <dd className="text-[15px] font-medium tabular-nums">{count}</dd>
                </div>
              );
            })}
          </dl>
        </section>

        {ids.length === 0 ? (
          <EmptyState text="No jobs yet." />
        ) : (
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(19rem,1fr))]">
            {states.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => props.onOpen(entry.id)}
                className="ui-press ui-enter rounded-xl border border-[var(--hairline)] bg-[var(--surface-1)] p-4 text-left hover:border-[var(--hairline-strong)]"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <StatusDot tone={stateTone(entry.state)} pulse={entry.state === "running"} />
                    <span className="truncate text-[13.5px] font-medium">{entry.id}</span>
                  </span>
                  {changed.includes(entry.id) ? <Chip tone="amber">Staged</Chip> : null}
                </div>
                <p className="mt-2 text-[12.5px] text-[var(--text-2)]">
                  {stateDetail(entry.state, findStatus(statuses, entry.id))}
                </p>
                <p className="mt-0.5 text-[12px] text-[var(--text-3)]">{scheduleSummary(entry.job)}</p>
              </button>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function findStatus(
  statuses: ReadonlyArray<JobStatusResponse>,
  id: string,
): JobStatusResponse | undefined {
  return statuses.find((status) => status.jobId === id);
}

function headline(total: number, failing: number, pending: number): string {
  if (total === 0) {
    return "Nothing scheduled";
  }
  if (failing > 0) {
    return `${failing} ${failing === 1 ? "job is" : "jobs are"} failing`;
  }
  if (pending > 0) {
    return `${pending} ${pending === 1 ? "job is" : "jobs are"} not installed`;
  }
  return "All jobs healthy";
}
