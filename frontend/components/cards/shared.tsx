"use client";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Common frame for copilot cards: pending state while the tool runs, then the content. */
export function CardShell({ title, status, pendingLabel = "Working…", children, actions, tone }: { title: string; status: string; pendingLabel?: string; children?: React.ReactNode; actions?: React.ReactNode; tone?: "error" }) {
  if (status !== "complete") {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />{pendingLabel}
      </div>
    );
  }
  return (
    <div className={cn("rounded-xl border bg-card p-3 text-sm shadow-sm", tone === "error" ? "border-rose-200" : "border-border")}>
      <div className={cn("mb-2 text-xs font-semibold uppercase tracking-wide", tone === "error" ? "text-rose-700" : "text-primary")}>{title}</div>
      {children}
      {actions ? <div className="mt-3 flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="flex items-baseline justify-between gap-3"><span className="text-muted-foreground">{label}</span><span className="text-right tabular-nums">{value}</span></div>;
}

export function MiniTable({ headers, rows }: { headers: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="text-muted-foreground"><tr>{headers.map((h, i) => <th key={i} className={cn("py-1 pr-2 text-left font-medium", i > 0 && "text-right")}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} className="border-t border-border">{r.map((c, j) => <td key={j} className={cn("py-1 pr-2", j > 0 && "text-right tabular-nums")}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

export function Action({ children, onClick, variant = "outline" }: { children: React.ReactNode; onClick: () => void; variant?: "outline" | "default" | "ghost" }) {
  return <Button size="sm" variant={variant} onClick={onClick}>{children}</Button>;
}

export function parseResult<T>(result: unknown): T | undefined {
  if (!result) return undefined;
  if (typeof result === "string") {
    try { return JSON.parse(result) as T; } catch { return undefined; }
  }
  return result as T;
}

export const money = (n: number | null | undefined, d = 2) => (n === null || n === undefined ? "—" : `$${n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`);
export const ppg = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `$${n.toFixed(4)}`);
export const gal = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${Math.round(n).toLocaleString()} gal`);
export const titleCase = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
