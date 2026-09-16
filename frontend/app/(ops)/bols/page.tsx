"use client";
import { useEffect, useState } from "react";
import { useOpsContext } from "@/components/ops-context";
import { Page, PageHeader, DataTable, StatusBadge, NativeSelect } from "@/components/ops/primitives";
import { Button } from "@/components/ui/button";
import { BolSheet } from "@/components/forms/BolSheet";
import type { Bol } from "@/lib/domain";
import { carrierName, fmtDateTime, gal, ppg, productName, supplierName, terminalName, relativeTime } from "@/lib/ops";
import { cn } from "@/lib/utils";

const MATCH_STYLE: Record<Bol["matchStatus"], string> = { matched: "bg-emerald-100 text-emerald-800", unmatched: "bg-rose-100 text-rose-800", duplicate: "bg-zinc-200 text-zinc-600" };

export default function BolsPage() {
  const { state, act, busy, setSelectedLoadId, version } = useOpsContext();
  // Which connector feeds BOLs (DTN when configured, otherwise the sample file).
  const [source, setSource] = useState<{ kind: string; name: string; configured: boolean; mode?: string; detail?: string; lastRun: { finishedAt: string; summary: string } | null } | null>(null);
  useEffect(() => {
    act<NonNullable<typeof source>>("integrations/bol-source", undefined, "GET").then(setSource).catch(() => undefined);
  }, [act, version]);
  const [filter, setFilter] = useState<"all" | Bol["matchStatus"]>("all");
  const [entry, setEntry] = useState(false);
  const [matchTarget, setMatchTarget] = useState<Record<string, string>>({});
  const rows = [...state.bols].filter((b) => filter === "all" || b.matchStatus === filter).sort((a, b) => b.liftedAt.localeCompare(a.liftedAt));
  const candidates = state.loads.filter((l) => !l.bolId && ["dispatched", "loading", "in_transit", "delivered"].includes(l.status));
  return (
    <Page>
      <PageHeader title="Bills of lading" description="Electronic BOLs from suppliers and terminals (the sample feed, or DTN once DTN_BOL_MODE is set) plus manual entries. Each BOL is deduplicated and matched to a load; matched loads enter the billing workflow." actions={<><Button size="sm" variant="outline" onClick={() => setEntry(true)}>Enter BOL manually</Button><Button size="sm" disabled={!!busy} onClick={() => act("bols/pull").catch(() => undefined)}>{source?.kind === "dtn" ? "Pull from DTN" : "Pull BOL feed"}</Button></>}>
        {source ? (
          <p className="text-xs text-muted-foreground">
            BOL source: <span className={source.configured ? "font-medium text-foreground" : "font-medium text-[color:var(--risk-medium)]"}>{source.name}{source.configured ? "" : " (not configured)"}</span>
            {source.detail ? <span> · {source.detail}</span> : null}
            {source.lastRun ? <span> · last pull {relativeTime(source.lastRun.finishedAt)}: {source.lastRun.summary}</span> : null}
          </p>
        ) : null}
      </PageHeader>
      <div className="flex flex-wrap gap-1.5">
        {(["all", "matched", "unmatched", "duplicate"] as const).map((f) => (
          <button key={f} type="button" onClick={() => setFilter(f)} className={cn("rounded-full border px-2.5 py-1 text-xs capitalize", filter === f ? "border-primary bg-accent text-accent-foreground" : "border-border text-muted-foreground hover:bg-secondary")}>{f}{f !== "all" ? ` (${state.bols.filter((b) => b.matchStatus === f).length})` : ""}</button>
        ))}
      </div>
      <DataTable rows={rows} rowKey={(b) => b.id} empty="No BOLs yet. Pull the feed or enter one manually." columns={[
        { key: "n", header: "BOL #", render: (b) => <span className="font-medium">{b.bolNumber}</span> },
        { key: "s", header: "Supplier / terminal", render: (b) => `${supplierName(state, b.supplierId)} · ${terminalName(state, b.terminalId)}` },
        { key: "c", header: "Carrier", render: (b) => carrierName(state, b.carrierId) },
        { key: "l", header: "Lifted", render: (b) => fmtDateTime(b.liftedAt) },
        { key: "p", header: "Product", render: (b) => b.lines.map((l) => productName(state, l.productId)).join(", ") },
        { key: "g", header: "Gross / net", align: "right", render: (b) => `${gal(b.lines.reduce((s, l) => s + l.grossGallons, 0))} / ${gal(b.lines.reduce((s, l) => s + l.netGallons, 0))}` },
        { key: "cost", header: "Cost / taxes $/gal", align: "right", render: (b) => `${ppg(b.lines[0]?.supplierCostPerGallon)} / ${ppg(b.lines[0]?.taxesPerGallon)}` },
        { key: "ref", header: "Customer ref", render: (b) => <span title={b.destinationText}>{b.customerRef}</span> },
        { key: "m", header: "Match", render: (b) => <StatusBadge label={b.matchStatus} className={MATCH_STYLE[b.matchStatus]} /> },
        { key: "ld", header: "Load", render: (b) => b.loadId ? <button type="button" className="text-primary hover:underline" onClick={() => setSelectedLoadId(b.loadId!)}>{state.loads.find((l) => l.id === b.loadId)?.loadNumber}</button> : b.matchStatus === "unmatched" ? (
          <span className="flex items-center gap-1">
            <NativeSelect className="h-7 w-36 text-xs" value={matchTarget[b.id] ?? ""} onChange={(e) => setMatchTarget({ ...matchTarget, [b.id]: e.target.value })}>
              <option value="">Match to…</option>
              {candidates.map((l) => <option key={l.id} value={l.id}>{l.loadNumber} · {state.customers.find((c) => c.id === l.customerId)?.code}</option>)}
            </NativeSelect>
            <Button size="sm" variant="outline" className="h-7 text-xs" disabled={!matchTarget[b.id] || !!busy} onClick={() => act(`bols/${b.id}/match`, { loadId: matchTarget[b.id] }).catch(() => undefined)}>Match</Button>
          </span>
        ) : "—" },
      ]} />
      {entry ? <BolSheet open={entry} onOpenChange={setEntry} /> : null}
    </Page>
  );
}
