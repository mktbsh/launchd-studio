import { useState } from "react";
import type {
  CalendarEntryDefinition,
  JobDefinition,
  RenderedJob,
} from "@launchd-studio/core";
import type {
  ControlAction,
  JobStatusResponse,
  LogStream,
  StudioCapabilities,
  ToolPath,
} from "@launchd-studio/core/transport";
import {
  Chip,
  CommandEditor,
  Disclosure,
  Group,
  LogView,
  PressButton,
  Row,
  Segmented,
  StatusDot,
  TextArea,
  TextInput,
} from "./controls";
import {
  jobState,
  restartSummary,
  scheduleSummary,
  stateDetail,
  stateLabel,
  stateTone,
} from "./draft";
import {
  DEFAULT_CALENDAR,
  parseInterval,
  pathHasDirectory,
  withEnvironment,
  withKind,
  withPathDirectory,
  withSchedule,
  withText,
  type EnvironmentEntries,
} from "./job";

export interface InspectorProps {
  readonly id: string;
  readonly job: JobDefinition;
  readonly status: JobStatusResponse | undefined;
  readonly rendered: RenderedJob | undefined;
  readonly dirty: boolean;
  readonly busy: boolean;
  readonly capabilities: StudioCapabilities;
  readonly logs: { readonly stream: LogStream; readonly path: string; readonly content: string } | null;
  readonly onChange: (job: JobDefinition) => void;
  readonly onRename: (id: string) => void;
  readonly onDelete: () => void;
  readonly onControl: (action: ControlAction) => void;
  readonly onUninstall: () => void;
  readonly onLoadLogs: (stream: LogStream) => void;
}

export function Inspector(props: InspectorProps) {
  const { id, job, status, dirty, busy, capabilities, logs } = props;
  const state = jobState(job.kind, status);
  const installed = status?.plistExists === true;

  return (
    <main className="ui-scroll relative overflow-auto">
      <header className="ui-chrome sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--hairline)] px-7 py-3.5">
        <div className="flex min-w-0 items-center gap-3">
          <h2 className="truncate text-[15px] font-semibold">{id}</h2>
          <Chip tone={stateTone(state)}>
            <StatusDot tone={stateTone(state)} pulse={state === "running"} />
            {stateLabel(state)}
          </Chip>
          {dirty ? <Chip tone="amber">Staged</Chip> : null}
        </div>
        <div className="flex items-center gap-2">
          {capabilities.launchd ? (
            state === "running" ? (
              <PressButton disabled={busy} onClick={() => props.onControl("stop")}>
                Stop
              </PressButton>
            ) : (
              <PressButton variant="tinted" disabled={busy || !installed} onClick={() => props.onControl("start")}>
                {job.kind === "task" ? "Run now" : "Start"}
              </PressButton>
            )
          ) : null}
          {capabilities.launchd && job.kind === "service" ? (
            <PressButton disabled={busy || !installed} onClick={() => props.onControl("restart")}>
              Restart
            </PressButton>
          ) : null}
          {capabilities.launchd ? (
            <PressButton variant="destructive" disabled={busy || !installed} onClick={props.onUninstall}>
              Uninstall
            </PressButton>
          ) : null}
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-7 py-6">
        <section className="mb-6 rounded-xl border border-[var(--hairline)] bg-[var(--surface-1)] px-5 py-4">
          <p className="text-[13px] text-[var(--text-2)]">{stateDetail(state, status)}</p>
          <p className="mt-1 text-[12px] text-[var(--text-3)]">
            {scheduleSummary(job)} · {restartSummary(job)}
          </p>
        </section>

        <Group title="What it runs">
          <Row label="Name">
            <TextInput value={id} onChange={props.onRename} aria-label="Job name" />
          </Row>
          <Row label="Command" align="start">
            <CommandEditor
              command={job.command}
              toolPaths={capabilities.toolPaths}
              onChange={(command) => props.onChange({ ...job, command })}
            />
          </Row>
          <Row label="Folder" align="start">
            <div className="space-y-1.5">
              <TextInput
                mono
                value={job.workingDirectory ?? ""}
                placeholder="Home folder"
                onChange={(value) => props.onChange(withText(job, "workingDirectory", value))}
              />
              <p className="text-[11px] text-[var(--text-3)]">
                Relative arguments resolve here. macOS keeps <code>~/Desktop</code>, <code>~/Documents</code>,
                and <code>~/Downloads</code> out of reach of a LaunchAgent.
              </p>
            </div>
          </Row>
          <Row label="Environment" align="start">
            <EnvironmentEditor
              key={id}
              job={job}
              toolPaths={capabilities.toolPaths}
              onChange={props.onChange}
            />
          </Row>
        </Group>

        <Group title="When it runs">
          <Row label="Type">
            <Segmented
              value={job.kind}
              onChange={(kind) => props.onChange(withKind(job, kind))}
              options={[
                { value: "service", label: "Keep running" },
                { value: "task", label: "Run on a schedule" },
              ]}
            />
          </Row>
          {job.kind === "service" ? (
            <Row label="Start">
              <Segmented
                value={job.start ?? "login"}
                onChange={(start) => props.onChange({ ...job, start })}
                options={[
                  { value: "login", label: "At login" },
                  { value: "manual", label: "Only when I start it" },
                ]}
              />
            </Row>
          ) : (
            <Row label="Schedule" align="start">
              <ScheduleEditor job={job} onChange={props.onChange} />
            </Row>
          )}
        </Group>

        {job.kind === "service" ? (
          <Group title="If it stops">
            <Row label="Restart">
              <Segmented
                value={job.restart ?? "on-failure"}
                onChange={(restart) => props.onChange({ ...job, restart })}
                options={[
                  { value: "never", label: "Leave it" },
                  { value: "on-failure", label: "On error" },
                  { value: "always", label: "Always" },
                ]}
              />
            </Row>
          </Group>
        ) : null}

        <Group title="Notes">
          <Row label="Description">
            <TextInput
              value={job.description ?? ""}
              onChange={(value) => props.onChange(withText(job, "description", value))}
            />
          </Row>
          <Row label="Comment" align="start">
            <TextArea
              value={job.comment ?? ""}
              placeholder="Why this job is set up the way it is"
              onChange={(value) => props.onChange(withText(job, "comment", value))}
            />
          </Row>
        </Group>

        <LogSection
          path={logs?.path ?? ""}
          content={logs?.content ?? ""}
          stream={logs?.stream ?? "stderr"}
          busy={busy}
          onLoad={props.onLoadLogs}
        />

        <Disclosure label="Advanced">
          <div className="space-y-4">
            <div>
              <span className="mb-1.5 block text-[12px] text-[var(--text-3)]">launchd label</span>
              <TextInput
                mono
                value={job.label ?? ""}
                placeholder={`dev.local.${id}`}
                onChange={(value) => props.onChange(withText(job, "label", value))}
              />
            </div>
            {props.rendered !== undefined ? (
              <div>
                <span className="mb-1.5 block break-all font-mono text-[11.5px] text-[var(--text-3)]">
                  {props.rendered.plistPath}
                </span>
                <LogView text={props.rendered.plist} empty="" />
              </div>
            ) : null}
            <PressButton variant="destructive" disabled={busy} onClick={props.onDelete}>
              Delete from manifest
            </PressButton>
          </div>
        </Disclosure>
      </div>
    </main>
  );
}

function LogSection({ path, content, stream, busy, onLoad }: {
  readonly path: string;
  readonly content: string;
  readonly stream: LogStream;
  readonly busy: boolean;
  readonly onLoad: (stream: LogStream) => void;
}) {
  return (
    <section className="mb-6">
      <div className="mb-2 flex items-center justify-between gap-3 px-1">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-3)]">
          Recent output
        </h3>
        <div className="flex items-center gap-2">
          <Segmented
            value={stream}
            onChange={onLoad}
            options={[
              { value: "stderr", label: "Errors" },
              { value: "stdout", label: "Output" },
            ]}
          />
          <PressButton disabled={busy} onClick={() => onLoad(stream)}>
            Refresh
          </PressButton>
        </div>
      </div>
      {path.length > 0 ? (
        <p className="mb-2 break-all px-1 font-mono text-[11px] text-[var(--text-3)]">{path}</p>
      ) : null}
      <LogView text={content} empty="Nothing loaded yet." />
    </section>
  );
}

function EnvironmentEditor({ job, toolPaths, onChange }: {
  readonly job: JobDefinition;
  readonly toolPaths: ReadonlyArray<ToolPath>;
  readonly onChange: (job: JobDefinition) => void;
}) {
  // Held locally so clearing a key does not make the row vanish mid-edit.
  const [entries, setEntries] = useState<EnvironmentEntries>(
    Object.entries(job.environment ?? {}),
  );

  const commit = (next: EnvironmentEntries): void => {
    setEntries(next);
    onChange(withEnvironment(job, next));
  };

  return (
    <div className="space-y-1.5">
      {toolPaths.map((tool) => (
        <label
          key={tool.directory}
          className="flex items-center gap-2 pb-1 text-xs text-[var(--text-2)]"
          title={tool.directory}
        >
          <input
            type="checkbox"
            checked={pathHasDirectory(entries, tool.directory)}
            onChange={(event) =>
              commit(withPathDirectory(entries, tool.directory, event.target.checked))
            }
            className="accent-[var(--sys-blue)]"
          />
          Use {tool.name}
        </label>
      ))}
      {entries.map(([key, value], position) => (
        <div key={position} className="flex items-center gap-1.5">
          <input
            value={key}
            aria-label={`Variable ${position + 1} name`}
            spellCheck={false}
            onChange={(event) =>
              commit(entries.map((entry, index) => (index === position ? [event.target.value, entry[1]] : entry)))
            }
            className="w-40 rounded-md border border-[var(--hairline)] bg-[var(--surface-2)] px-2 py-1 font-mono text-xs text-[var(--text-2)] outline-none focus:border-[var(--sys-blue)]"
          />
          <input
            value={value}
            aria-label={`Variable ${position + 1} value`}
            spellCheck={false}
            onChange={(event) =>
              commit(entries.map((entry, index) => (index === position ? [entry[0], event.target.value] : entry)))
            }
            className="min-w-0 flex-1 rounded-md border border-[var(--hairline)] bg-[var(--surface-2)] px-2 py-1 font-mono text-xs outline-none focus:border-[var(--sys-blue)]"
          />
          <button
            type="button"
            aria-label={`Remove variable ${position + 1}`}
            onClick={() => commit(entries.filter((_entry, index) => index !== position))}
            className="ui-press rounded px-1 text-xs text-[var(--text-3)] hover:text-[var(--sys-red)]"
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => setEntries([...entries, ["", ""]])}
        className="ui-press rounded-md border border-dashed border-[var(--hairline-strong)] px-2 py-1 text-xs text-[var(--text-3)] hover:text-[var(--text-1)]"
      >
        + variable
      </button>
    </div>
  );
}

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const SELECT_CLASS =
  "rounded-md border border-[var(--hairline)] bg-[var(--surface-2)] px-2 py-1 text-[13px] text-[var(--text-1)] outline-none focus:border-[var(--sys-blue)]";

function ScheduleEditor({ job, onChange }: {
  readonly job: JobDefinition;
  readonly onChange: (job: JobDefinition) => void;
}) {
  if (job.kind !== "task") {
    return null;
  }
  const schedule = job.schedule ?? DEFAULT_CALENDAR;

  return (
    <div className="space-y-2.5">
      <Segmented
        value={schedule.type}
        onChange={(type) =>
          onChange(withSchedule(job, type === "interval" ? { type: "interval", every: "15m" } : DEFAULT_CALENDAR))
        }
        options={[
          { value: "calendar", label: "At a time" },
          { value: "interval", label: "At an interval" },
        ]}
      />
      {schedule.type === "interval" ? (
        <IntervalEditor
          every={schedule.every}
          onChange={(every) => onChange(withSchedule(job, { type: "interval", every }))}
        />
      ) : (
        <CalendarEditor
          entries={schedule.entries}
          onChange={(entries) => onChange(withSchedule(job, { type: "calendar", entries }))}
        />
      )}
    </div>
  );
}

const UNIT_LABEL: Record<string, string> = { m: "minutes", h: "hours", d: "days" };

function IntervalEditor({ every, onChange }: {
  readonly every: string;
  readonly onChange: (every: string) => void;
}) {
  const parts = parseInterval(every);
  if (parts === undefined) {
    return <TextInput mono value={every} onChange={onChange} aria-label="Interval" />;
  }
  return (
    <div className="flex items-center gap-2 text-[13px] text-[var(--text-2)]">
      Every
      <input
        type="number"
        min={1}
        value={parts.amount}
        aria-label="Interval amount"
        onChange={(event) => onChange(`${Math.max(1, Number(event.target.value))}${parts.unit}`)}
        className={`w-20 ${SELECT_CLASS}`}
      />
      <select
        value={parts.unit}
        aria-label="Interval unit"
        onChange={(event) => onChange(`${parts.amount}${event.target.value}`)}
        className={SELECT_CLASS}
      >
        {Object.entries(UNIT_LABEL).map(([unit, label]) => (
          <option key={unit} value={unit}>{label}</option>
        ))}
      </select>
    </div>
  );
}

function CalendarEditor({ entries, onChange }: {
  readonly entries: ReadonlyArray<CalendarEntryDefinition>;
  readonly onChange: (entries: ReadonlyArray<CalendarEntryDefinition>) => void;
}) {
  const replace = (position: number, entry: CalendarEntryDefinition): void => {
    onChange(entries.map((current, index) => (index === position ? entry : current)));
  };

  return (
    <div className="space-y-1.5">
      {entries.map((entry, position) => (
        <div key={position} className="flex flex-wrap items-center gap-2 text-[13px] text-[var(--text-2)]">
          <select
            value={entry.weekday ?? "daily"}
            aria-label={`Day for entry ${position + 1}`}
            onChange={(event) => {
              const { weekday: _drop, ...rest } = entry;
              replace(
                position,
                event.target.value === "daily" ? rest : { ...rest, weekday: Number(event.target.value) },
              );
            }}
            className={SELECT_CLASS}
          >
            <option value="daily">Every day</option>
            {WEEKDAY_NAMES.map((day, index) => (
              <option key={day} value={index}>Every {day}</option>
            ))}
          </select>
          at
          <input
            type="time"
            aria-label={`Time for entry ${position + 1}`}
            value={`${String(entry.hour ?? 0).padStart(2, "0")}:${String(entry.minute ?? 0).padStart(2, "0")}`}
            onChange={(event) => {
              const [hour, minute] = event.target.value.split(":");
              replace(position, { ...entry, hour: Number(hour ?? 0), minute: Number(minute ?? 0) });
            }}
            className={SELECT_CLASS}
          />
          {entries.length > 1 ? (
            <button
              type="button"
              aria-label={`Remove entry ${position + 1}`}
              onClick={() => onChange(entries.filter((_entry, index) => index !== position))}
              className="ui-press rounded px-1 text-xs text-[var(--text-3)] hover:text-[var(--sys-red)]"
            >
              ×
            </button>
          ) : null}
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...entries, { hour: 9, minute: 0 }])}
        className="ui-press rounded-md border border-dashed border-[var(--hairline-strong)] px-2 py-1 text-xs text-[var(--text-3)] hover:text-[var(--text-1)]"
      >
        + time
      </button>
    </div>
  );
}
