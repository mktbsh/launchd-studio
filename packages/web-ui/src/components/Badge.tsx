import type { ReactNode } from "react";

export function Badge({ children, tone = "neutral" }: { readonly children: ReactNode; readonly tone?: "neutral" | "good" | "warning" | "bad" }) {
  const classes =
    tone === "good"
      ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
      : tone === "warning"
        ? "border-amber-400/30 bg-amber-400/10 text-amber-200"
        : tone === "bad"
          ? "border-rose-400/30 bg-rose-400/10 text-rose-200"
          : "border-slate-700 bg-slate-900 text-slate-300";
  return <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${classes}`}>{children}</span>;
}
