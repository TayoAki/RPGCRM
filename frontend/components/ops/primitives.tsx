"use client";
import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";

/** Page title row with optional description and right-aligned actions. */
export function PageHeader({ title, description, actions, children }: { title: string; description?: string; actions?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        {children}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Page({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("h-full overflow-auto p-6", className)}><div className="space-y-6">{children}</div></div>;
}

export function StatusBadge({ label, className, title }: { label: string; className?: string; title?: string }) {
  return <span title={title} className={cn("inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium", className ?? "bg-secondary text-secondary-foreground")}>{label}</span>;
}

export function SectionCard({ title, action, className, children, padded = true }: { title?: string; action?: React.ReactNode; className?: string; children: React.ReactNode; padded?: boolean }) {
  return (
    <Card className={cn("gap-3", padded ? "p-4" : "p-0", className)}>
      {title ? (
        <div className={cn("flex items-center justify-between gap-2", !padded && "px-4 pt-4")}>
          <h2 className="text-sm font-semibold">{title}</h2>
          {action}
        </div>
      ) : null}
      {children}
    </Card>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "bad" | "warn" }) {
  const color = tone === "good" ? "text-[color:var(--risk-low)]" : tone === "bad" ? "text-[color:var(--risk-high)]" : tone === "warn" ? "text-[color:var(--risk-medium)]" : "";
  return (
    <Card className="gap-0 p-4">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className={cn("mt-1 text-2xl font-semibold tabular-nums", color)}>{value}</div>
      {sub ? <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div> : null}
    </Card>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">{children}</div>;
}

export function KV({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3 text-sm", className)}>
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="text-right tabular-nums">{children}</span>
    </div>
  );
}

export interface Column<T> {
  key: string;
  header: React.ReactNode;
  render: (row: T) => React.ReactNode;
  align?: "left" | "right";
  className?: string;
}

export function DataTable<T>({ columns, rows, rowKey, onRowClick, empty = "Nothing here yet.", dense, selectedKey }: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  empty?: React.ReactNode;
  dense?: boolean;
  selectedKey?: string | null;
}) {
  if (rows.length === 0) return <Empty>{empty}</Empty>;
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <table className="w-full text-sm">
        <thead className="bg-secondary/60 text-xs text-muted-foreground">
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={cn("px-3 py-2 text-left font-medium", c.align === "right" && "text-right", c.className)}>{c.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const k = rowKey(r);
            return (
              <tr
                key={k}
                onClick={onRowClick ? () => onRowClick(r) : undefined}
                className={cn("border-t border-border", onRowClick && "cursor-pointer hover:bg-accent/40", selectedKey === k && "bg-accent/60")}
              >
                {columns.map((c) => (
                  <td key={c.key} className={cn("px-3 align-middle", dense ? "py-1.5" : "py-2.5", c.align === "right" && "text-right tabular-nums", c.className)}>{c.render(r)}</td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Form field wrapper. */
export function Field({ label, children, hint, className }: { label: string; children: React.ReactNode; hint?: string; className?: string }) {
  return (
    <label className={cn("flex flex-col gap-1 text-sm", className)}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
      {hint ? <span className="text-[11px] text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

export function NativeSelect({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn("h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50", className)}
      {...props}
    >
      {children}
    </select>
  );
}

export { Input };

/** Side sheet with a submit button; used by every form in the workspace. */
export function FormSheet({ open, onOpenChange, title, description, children, onSubmit, submitLabel = "Save", busy, error, wide }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  onSubmit: () => Promise<void> | void;
  submitLabel?: string;
  busy?: boolean;
  error?: string | null;
  wide?: boolean;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className={cn("overflow-y-auto", wide ? "sm:max-w-xl" : "sm:max-w-md")}>
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          {description ? <SheetDescription>{description}</SheetDescription> : null}
        </SheetHeader>
        <form
          className="flex flex-col gap-3 px-4 pb-4"
          onSubmit={(e) => {
            e.preventDefault();
            void onSubmit();
          }}
        >
          {children}
          {error ? <div className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-800">{error}</div> : null}
          <div className="mt-2 flex gap-2">
            <Button type="submit" size="sm" disabled={busy}>{busy ? "Working…" : submitLabel}</Button>
            <Button type="button" size="sm" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}

/** Contained slide-over inside <main> (like the original deal drawer). */
export function Drawer({ open, onClose, title, subtitle, children, width = "w-[460px]" }: { open: boolean; onClose: () => void; title: React.ReactNode; subtitle?: React.ReactNode; children: React.ReactNode; width?: string }) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <>
      <div className="absolute inset-0 z-20 bg-black/20" onClick={onClose} />
      <aside className={cn("absolute inset-y-0 right-0 z-30 flex max-w-full flex-col border-l border-border bg-card shadow-xl", width)}>
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <div className="truncate text-base font-semibold">{title}</div>
            {subtitle ? <div className="text-xs text-muted-foreground">{subtitle}</div> : null}
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">{children}</div>
      </aside>
    </>
  );
}

export function DrawerSection({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Timeline({ items }: { items: { label: string; at: string; by?: string; note?: string }[] }) {
  if (items.length === 0) return <div className="text-xs text-muted-foreground">No events yet.</div>;
  return (
    <ol className="space-y-2 border-l border-border pl-3">
      {items.map((it, i) => (
        <li key={i} className="relative text-xs">
          <span className="absolute -left-[17px] top-1 h-2 w-2 rounded-full bg-primary" />
          <div className="font-medium text-foreground">{it.label}</div>
          <div className="text-muted-foreground">{it.at}{it.by ? ` · ${it.by}` : ""}{it.note ? ` · ${it.note}` : ""}</div>
        </li>
      ))}
    </ol>
  );
}
