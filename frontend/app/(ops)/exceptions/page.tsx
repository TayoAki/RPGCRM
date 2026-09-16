"use client";
import { useEffect, useState } from "react";
import { useOpsContext } from "@/components/ops-context";
import { Page, PageHeader, DataTable, StatusBadge, SectionCard } from "@/components/ops/primitives";
import { Button } from "@/components/ui/button";
import { ResolveExceptionSheet } from "@/components/forms/ResolveExceptionSheet";
import type { OpsException } from "@/lib/domain";
import { fmtDateTime, money, SEVERITY_STYLE, staffName, titleCase } from "@/lib/ops";

interface Triaged extends OpsException { rank: number; score: number; moneyAtRisk: number; ageHours: number; nextStep: string }

export default function ExceptionsPage() {
  const { state, act, busy, version, setSelectedLoadId, setSelectedOrderId } = useOpsContext();
  const [triage, setTriage] = useState<{ priorities: Triaged[]; rest: Triaged[]; totalOpen: number } | null>(null);
  const [resolving, setResolving] = useState<OpsException | null>(null);
  useEffect(() => {
    let alive = true;
    act<{ priorities: Triaged[]; rest: Triaged[]; totalOpen: number }>("exceptions/triage", undefined, "GET").then((t) => { if (alive) setTriage(t); }).catch(() => undefined);
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);
  const open = triage ? [...triage.priorities, ...triage.rest] : [];
  const resolved = state.exceptions.filter((e) => e.status === "resolved").sort((a, b) => (b.resolvedAt ?? "").localeCompare(a.resolvedAt ?? "")).slice(0, 30);
  const openEntity = (e: OpsException) => {
    if (e.entityType === "load") setSelectedLoadId(e.entityId);
    if (e.entityType === "order") setSelectedOrderId(e.entityId);
    if (e.entityType === "invoice") { const inv = state.invoices.find((i) => i.id === e.entityId); if (inv) setSelectedLoadId(inv.loadId); }
    if (e.entityType === "bol") { const b = state.bols.find((x) => x.id === e.entityId); if (b?.loadId) setSelectedLoadId(b.loadId); }
  };
  return (
    <Page>
      <PageHeader title="Exceptions" description="Data-integrity checkpoints evaluated after every change: missing or duplicate BOLs, unmatched customers, pricing gaps and mismatches, uninvoiced loads, low-margin loads, credit holds, stale indexes. Ranked by severity, money at risk, and age." />
      <DataTable rows={open} rowKey={(e) => e.id} empty={triage ? "No open exceptions." : "Loading…"} columns={[
        { key: "r", header: "#", render: (e) => <span className="text-muted-foreground">{e.rank}</span> },
        { key: "s", header: "Severity", render: (e) => <StatusBadge label={e.severity} className={SEVERITY_STYLE[e.severity]} /> },
        { key: "t", header: "Type", render: (e) => titleCase(e.type) },
        { key: "m", header: "What", render: (e) => <div><div>{e.message}</div><div className="text-xs text-muted-foreground">Next: {e.nextStep}</div></div> },
        { key: "$", header: "At risk", align: "right", render: (e) => e.moneyAtRisk ? money(e.moneyAtRisk, 0) : "—" },
        { key: "age", header: "Age", align: "right", render: (e) => `${e.ageHours}h` },
        { key: "st", header: "Status", render: (e) => <span className="capitalize text-muted-foreground">{e.status}</span> },
        { key: "a", header: "", render: (e) => (
          <span className="flex justify-end gap-1">
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => openEntity(e)}>Open</Button>
            {e.status === "open" ? <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={!!busy} onClick={() => act(`exceptions/${e.id}/acknowledge`).catch(() => undefined)}>Ack</Button> : null}
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setResolving(e)}>Resolve</Button>
          </span>
        ) },
      ]} />
      {resolved.length ? (
        <SectionCard title="Recently resolved">
          <DataTable dense rows={resolved} rowKey={(e) => e.id} columns={[
            { key: "t", header: "Type", render: (e) => titleCase(e.type) },
            { key: "m", header: "What", render: (e) => e.message },
            { key: "by", header: "Resolved by", render: (e) => `${staffName(state, e.resolvedBy ?? "system")} · ${fmtDateTime(e.resolvedAt)}` },
            { key: "n", header: "Note", render: (e) => <span className="text-muted-foreground">{e.resolutionNote}</span> },
          ]} />
        </SectionCard>
      ) : null}
      <ResolveExceptionSheet exception={resolving} open={!!resolving} onOpenChange={(o) => { if (!o) setResolving(null); }} />
    </Page>
  );
}
