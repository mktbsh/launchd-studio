import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import type { ToolPath } from "@launchd-studio/core/transport";
import type { Tone } from "./draft";

const TONE_COLOR: Record<Tone, string> = {
  green: "var(--sys-green)",
  amber: "var(--sys-amber)",
  red: "var(--sys-red)",
  gray: "var(--sys-gray)",
  blue: "var(--sys-blue)",
};

export function StatusDot({ tone, pulse = false }: { readonly tone: Tone; readonly pulse?: boolean }) {
  return (
    <span
      className={`relative inline-block h-2 w-2 shrink-0 rounded-full ${pulse ? "ui-pulse" : ""}`}
      style={{ backgroundColor: TONE_COLOR[tone], color: TONE_COLOR[tone] }}
    />
  );
}

export function Chip({ tone, children }: { readonly tone: Tone; readonly children: ReactNode }) {
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium"
      style={{
        backgroundColor: `color-mix(in srgb, ${TONE_COLOR[tone]} 16%, transparent)`,
        color: TONE_COLOR[tone],
      }}
    >
      {children}
    </span>
  );
}

export interface PressButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: "plain" | "filled" | "tinted" | "destructive";
  readonly children: ReactNode;
}

export function PressButton({ variant = "plain", className = "", children, ...rest }: PressButtonProps) {
  const style =
    variant === "filled"
      ? "bg-[var(--sys-blue)] text-white hover:brightness-110"
      : variant === "tinted"
        ? "bg-[color-mix(in_srgb,var(--sys-blue)_18%,transparent)] text-[var(--sys-blue)] hover:bg-[color-mix(in_srgb,var(--sys-blue)_26%,transparent)]"
        : variant === "destructive"
          ? "bg-[color-mix(in_srgb,var(--sys-red)_16%,transparent)] text-[var(--sys-red)] hover:bg-[color-mix(in_srgb,var(--sys-red)_24%,transparent)]"
          : "border border-[var(--hairline)] bg-[var(--surface-2)] text-[var(--text-1)] hover:bg-[var(--surface-3)]";
  return (
    <button
      type="button"
      className={`ui-press inline-flex min-h-8 items-center justify-center gap-1.5 rounded-lg px-3 text-[13px] font-medium disabled:opacity-35 ${style} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export interface SegmentedOption<T extends string> {
  readonly value: T;
  readonly label: string;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className = "",
}: {
  readonly options: ReadonlyArray<SegmentedOption<T>>;
  readonly value: T;
  readonly onChange: (value: T) => void;
  readonly className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null);
  const index = Math.max(0, options.findIndex((option) => option.value === value));

  useLayoutEffect(() => {
    const container = containerRef.current;
    const active = container?.querySelectorAll<HTMLButtonElement>("[data-seg-option]")[index];
    if (container === null || active === undefined) {
      return;
    }
    setThumb({ left: active.offsetLeft - 2, width: active.offsetWidth });
  }, [index, options]);

  return (
    <div ref={containerRef} className={`ui-seg ${className}`} role="tablist">
      {thumb !== null ? (
        <span
          className="ui-seg-thumb"
          style={{ width: `${thumb.width}px`, transform: `translateX(${thumb.left}px)` }}
        />
      ) : null}
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          data-seg-option
          data-active={option.value === value}
          aria-selected={option.value === value}
          className="ui-seg-option"
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Group({ title, footnote, children }: {
  readonly title?: string;
  readonly footnote?: string;
  readonly children: ReactNode;
}) {
  return (
    <section className="mb-6">
      {title !== undefined ? (
        <h3 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-3)]">
          {title}
        </h3>
      ) : null}
      <div className="divide-y divide-[var(--hairline)] overflow-hidden rounded-xl border border-[var(--hairline)] bg-[var(--surface-1)]">
        {children}
      </div>
      {footnote !== undefined ? <p className="mt-2 px-1 text-xs text-[var(--text-3)]">{footnote}</p> : null}
    </section>
  );
}

export function Row({ label, children, align = "center" }: {
  readonly label: string;
  readonly children: ReactNode;
  readonly align?: "center" | "start";
}) {
  return (
    <div className={`flex gap-4 px-4 py-3 ${align === "center" ? "items-center" : "items-start"}`}>
      <span className="w-36 shrink-0 pt-px text-[13px] text-[var(--text-2)]">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function TextInput({ value, onChange, placeholder, mono = false, ...rest }: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly placeholder?: string;
  readonly mono?: boolean;
  readonly "aria-label"?: string;
}) {
  return (
    <input
      value={value}
      placeholder={placeholder}
      spellCheck={false}
      onChange={(event) => onChange(event.target.value)}
      className={`w-full rounded-lg border border-[var(--hairline)] bg-[var(--surface-2)] px-2.5 py-1.5 text-[13px] text-[var(--text-1)] outline-none transition-colors placeholder:text-[var(--text-3)] focus:border-[var(--sys-blue)] ${mono ? "font-mono" : ""}`}
      {...rest}
    />
  );
}

export function TextArea({ value, onChange, placeholder, rows = 3 }: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly placeholder?: string;
  readonly rows?: number;
}) {
  return (
    <textarea
      value={value}
      rows={rows}
      placeholder={placeholder}
      spellCheck={false}
      onChange={(event) => onChange(event.target.value)}
      className="ui-scroll w-full resize-y rounded-lg border border-[var(--hairline)] bg-[var(--surface-2)] px-2.5 py-1.5 text-[13px] leading-5 text-[var(--text-1)] outline-none transition-colors placeholder:text-[var(--text-3)] focus:border-[var(--sys-blue)]"
    />
  );
}

// The command is an argv array, never a shell string — the editor has to say so.
export function CommandEditor({ command, toolPaths, onChange }: {
  readonly command: ReadonlyArray<string>;
  readonly toolPaths: ReadonlyArray<ToolPath>;
  readonly onChange: (command: ReadonlyArray<string>) => void;
}) {
  const executable = command[0] ?? "";
  const bare = executable.length > 0 && !executable.includes("/");

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {command.map((argument, position) => (
          <span key={position} className="inline-flex items-center">
            <input
              value={argument}
              spellCheck={false}
              size={Math.max(argument.length, 4)}
              aria-label={position === 0 ? "Executable" : `Argument ${position}`}
              onChange={(event) =>
                onChange(command.map((entry, index) => (index === position ? event.target.value : entry)))
              }
              className={`rounded-md border px-2 py-1 font-mono text-xs outline-none transition-colors focus:border-[var(--sys-blue)] ${
                position === 0
                  ? "border-[var(--hairline-strong)] bg-[var(--surface-3)] text-[var(--text-1)]"
                  : "border-[var(--hairline)] bg-[var(--surface-2)] text-[var(--text-2)]"
              }`}
            />
            {position > 0 ? (
              <button
                type="button"
                aria-label={`Remove argument ${position}`}
                onClick={() => onChange(command.filter((_entry, index) => index !== position))}
                className="ui-press ml-0.5 rounded px-1 text-xs text-[var(--text-3)] hover:text-[var(--sys-red)]"
              >
                ×
              </button>
            ) : null}
          </span>
        ))}
        <button
          type="button"
          onClick={() => onChange([...command, ""])}
          className="ui-press rounded-md border border-dashed border-[var(--hairline-strong)] px-2 py-1 text-xs text-[var(--text-3)] hover:text-[var(--text-1)]"
        >
          + argument
        </button>
      </div>
      {bare && toolPaths.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {toolPaths.map((tool) => (
            <button
              key={tool.directory}
              type="button"
              title={`${tool.directory}/${executable}`}
              onClick={() => onChange([`${tool.directory}/${executable}`, ...command.slice(1)])}
              className="ui-press rounded-md border border-[var(--hairline-strong)] bg-[var(--surface-3)] px-2 py-1 text-[11px] text-[var(--text-2)] hover:text-[var(--text-1)]"
            >
              Resolve in {tool.name}
            </button>
          ))}
        </div>
      ) : null}
      <p className="text-[11px] text-[var(--text-3)]">
        Run directly, not through a shell. First box is the executable; use an absolute path or <code>~/</code>.
      </p>
    </div>
  );
}

export function LogView({ text, empty }: { readonly text: string; readonly empty: string }) {
  return (
    <pre className="ui-scroll max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-[var(--hairline)] bg-black/40 p-3 font-mono text-[11.5px] leading-5 text-[var(--text-2)]">
      {text.length > 0 ? text : empty}
    </pre>
  );
}

export function Disclosure({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-[var(--hairline)] bg-[var(--surface-1)]">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="ui-press flex w-full items-center justify-between px-4 py-3 text-[13px] text-[var(--text-2)] hover:text-[var(--text-1)]"
      >
        <span>{label}</span>
        <span
          className="text-[var(--text-3)] transition-transform duration-200 ease-[var(--ease-out-strong)]"
          style={{ transform: open ? "rotate(90deg)" : "none" }}
        >
          ›
        </span>
      </button>
      {open ? <div className="border-t border-[var(--hairline)] px-4 py-4">{children}</div> : null}
    </div>
  );
}

// Mounted-then-open so the closed→open transition actually runs on first paint.
export function useTransitionState(open: boolean): { mounted: boolean; state: "open" | "closed" } {
  const [mounted, setMounted] = useState(open);
  const [state, setState] = useState<"open" | "closed">("closed");

  useEffect(() => {
    if (open) {
      setMounted(true);
      const frame = requestAnimationFrame(() => setState("open"));
      return () => cancelAnimationFrame(frame);
    }
    setState("closed");
    const timer = window.setTimeout(() => setMounted(false), 400);
    return () => window.clearTimeout(timer);
  }, [open]);

  return { mounted, state };
}

export function Sheet({ open, onClose, title, children, footer }: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: ReactNode;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
}) {
  const { mounted, state } = useTransitionState(open);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!mounted) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-40">
      <button
        type="button"
        aria-label="Close"
        data-state={state}
        className="ui-scrim absolute inset-0 h-full w-full cursor-default"
        onClick={onClose}
      />
      <div
        data-state={state}
        className="ui-sheet absolute inset-y-0 right-0 flex w-[min(46rem,94vw)] flex-col border-l border-[var(--hairline)] bg-[var(--surface-1)] shadow-[0_0_60px_rgb(0_0_0/0.6)]"
      >
        <header className="flex items-center justify-between gap-3 border-b border-[var(--hairline)] px-5 py-4">
          <div className="min-w-0">{title}</div>
          <PressButton onClick={onClose}>Done</PressButton>
        </header>
        <div className="ui-scroll flex-1 overflow-auto px-5 py-5">{children}</div>
        {footer !== undefined ? (
          <footer className="border-t border-[var(--hairline)] px-5 py-3">{footer}</footer>
        ) : null}
      </div>
    </div>
  );
}

export function EmptyState({ text }: { readonly text: string }) {
  return (
    <div className="flex min-h-48 items-center justify-center rounded-xl border border-dashed border-[var(--hairline-strong)] px-6 text-center text-[13px] text-[var(--text-3)]">
      {text}
    </div>
  );
}
