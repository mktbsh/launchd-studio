import type { ButtonHTMLAttributes, ReactNode } from "react";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly children: ReactNode;
  readonly tone?: "default" | "primary" | "danger";
}

export function Button({ children, tone = "default", className = "", ...props }: ButtonProps) {
  const toneClass =
    tone === "primary"
      ? "border-sky-400/50 bg-sky-400/15 text-sky-100 hover:bg-sky-400/25"
      : tone === "danger"
        ? "border-rose-400/50 bg-rose-400/10 text-rose-100 hover:bg-rose-400/20"
        : "border-slate-700 bg-slate-900/80 text-slate-200 hover:border-slate-600 hover:bg-slate-800";
  return (
    <button
      className={`inline-flex min-h-9 items-center justify-center rounded-md border px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${toneClass} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
