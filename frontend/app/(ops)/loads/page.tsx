"use client";
import { useOpsContext } from "@/components/ops-context";
import { Page, PageHeader, StatusBadge } from "@/components/ops/primitives";
import { Board } from "@/components/ops/Board";
import { Button } from "@/components/ui/button";
import type { Load, LoadStatus } from "@/lib/domain";
import { LOAD_STATUSES } from "@/lib/domain";
import { billingStatusLabel, BILLING_STATUS_STYLE, carrierName, customerName, fmtDateTime, gal, loadStatusLabel, LOAD_STATUS_STYLE, NEXT_LOAD_STATUS, productCode, terminalName } from "@/lib/ops";
import { cn } from "@/lib/utils";

export default function LoadsPage() {
  const { state, act, busy, selectedLoadId, setSelectedLoadId } = useOpsContext();
  const columns = LOAD_STATUSES.map((s) => ({ key: s, label: loadStatusLabel(s), style: LOAD_STATUS_STYLE[s] }));
  return (
    <Page>
      <PageHeader title="Loads" description="Dispatch board. Drag a load to its next status; delivery is recorded from the load's drawer with the ticket." actions={<Button size="sm" variant="outline" disabled={!!busy} onClick={() => act("bols/pull").catch(() => undefined)}>Pull BOL feed</Button>} />
      <Board<Load, LoadStatus>
        columns={columns}
        items={state.loads}
        columnOf={(l) => l.status}
        itemKey={(l) => l.id}
        canMove={(l, to) => NEXT_LOAD_STATUS[l.status] === to && to !== "delivered"}
        onMove={(id, to) => { act(`loads/${id}/status`, { status: to }).catch(() => undefined); }}
        summary={(items) => gal(items.reduce((s, l) => s + l.plannedGallons, 0))}
        renderCard={(l) => (
          <button
            type="button"
            onClick={() => setSelectedLoadId(l.id)}
            className={cn("w-full rounded-xl border bg-card p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md", selectedLoadId === l.id ? "border-primary ring-1 ring-ring" : "border-border")}
          >
            <div className="flex items-center justify-between gap-2"><span className="text-xs text-muted-foreground">{l.loadNumber}</span><span className="rounded bg-secondary px-1.5 text-[11px] font-medium">{productCode(state, l.productId)}</span></div>
            <div className="mt-1 truncate text-sm font-medium">{customerName(state, l.customerId)}</div>
            <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground"><span>{gal(l.plannedGallons)}</span><span>{carrierName(state, l.carrierId)}</span></div>
            <div className="mt-1 text-xs text-muted-foreground">{terminalName(state, l.terminalId)} · {fmtDateTime(l.scheduledPickupAt)}</div>
            <div className="mt-2 flex items-center gap-1.5">
              {l.bolId ? <StatusBadge label="BOL" className="bg-emerald-100 text-emerald-800" /> : <StatusBadge label="no BOL" className="bg-zinc-100 text-zinc-600" />}
              {l.billingStatus ? <StatusBadge label={billingStatusLabel(l.billingStatus)} className={BILLING_STATUS_STYLE[l.billingStatus]} /> : null}
            </div>
          </button>
        )}
      />
    </Page>
  );
}
