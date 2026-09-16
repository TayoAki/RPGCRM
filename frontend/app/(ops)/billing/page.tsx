"use client";
import { useState } from "react";
import { useOpsContext } from "@/components/ops-context";
import { Page, PageHeader, StatusBadge, DataTable, SectionCard, KV } from "@/components/ops/primitives";
import { Board } from "@/components/ops/Board";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import type { BillingStatus, Load } from "@/lib/domain";
import { BILLING_STATUSES } from "@/lib/domain";
import { billingStatusLabel, BILLING_STATUS_STYLE, customerName, fmtDate, gal, INVOICE_STATUS_STYLE, money, ppg, productCode, productName, staffName, titleCase } from "@/lib/ops";
import { useActorId } from "@/components/Providers";
import { cn } from "@/lib/utils";

const ORDER = (s: BillingStatus) => BILLING_STATUSES.indexOf(s);

export default function BillingPage() {
  const { state, act, busy, setSelectedLoadId } = useOpsContext();
  const actorId = useActorId();
  const actor = state.staff.find((u) => u.id === actorId);
  const canApprove = !actor || ["management", "admin"].includes(actor.role);
  const [selected, setSelected] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const loads = state.loads.filter((l) => l.bolId && l.billingStatus);
  const invoices = [...state.invoices].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const inv = invoices.find((i) => i.id === selected);
  const columns = BILLING_STATUSES.map((s) => ({ key: s, label: billingStatusLabel(s), style: BILLING_STATUS_STYLE[s], hint: s === "invoiced" || s === "paid" ? "Set by invoicing and QuickBooks payments" : undefined }));
  const sync = () => act("quickbooks/sync-invoices").then(() => act("quickbooks/sync-payments")).catch(() => undefined);
  return (
    <Page>
      <PageHeader title="Billing" description="BOL Received → Pricing Verified → Ready to Invoice → Invoiced → Paid. Invoices need management approval before they reach QuickBooks." actions={<><Button size="sm" variant="outline" disabled={!!busy} onClick={() => act("invoices/prepare", {}).catch(() => undefined)}>Prepare invoices</Button><Button size="sm" disabled={!!busy} onClick={sync}>Sync QuickBooks</Button></>} />
      <Tabs defaultValue="board">
        <TabsList>
          <TabsTrigger value="board">Billing board ({loads.length})</TabsTrigger>
          <TabsTrigger value="invoices">Invoices ({invoices.filter((i) => i.status === "pending_approval").length} pending approval)</TabsTrigger>
          <TabsTrigger value="quickbooks">QuickBooks ledger</TabsTrigger>
        </TabsList>
        <TabsContent value="board" className="pt-3">
          <Board<Load, BillingStatus>
            columns={columns}
            items={loads}
            columnOf={(l) => l.billingStatus}
            itemKey={(l) => l.id}
            canMove={(l, to) => !!l.billingStatus && ORDER(l.billingStatus) < 3 && ORDER(to) < 3 && ORDER(to) === ORDER(l.billingStatus) + 1}
            onMove={(id, to) => { act(`loads/${id}/billing-status`, { status: to }).catch(() => undefined); }}
            summary={(items) => money(items.reduce((s, l) => s + (state.loadMargins.find((m) => m.loadId === l.id)?.revenue ?? 0), 0), 0)}
            renderCard={(l) => {
              const invoice = l.invoiceId ? state.invoices.find((i) => i.id === l.invoiceId) : undefined;
              const bol = state.bols.find((b) => b.id === l.bolId);
              return (
                <button type="button" onClick={() => setSelectedLoadId(l.id)} className="w-full rounded-xl border border-border bg-card p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md">
                  <div className="flex items-center justify-between gap-2"><span className="text-xs text-muted-foreground">{l.loadNumber}</span><span className="rounded bg-secondary px-1.5 text-[11px] font-medium">{productCode(state, l.productId)}</span></div>
                  <div className="mt-1 truncate text-sm font-medium">{customerName(state, l.customerId)}</div>
                  <div className="mt-1 text-xs text-muted-foreground">BOL {bol?.bolNumber ?? "—"} · {gal(bol?.lines.reduce((s, x) => s + x.netGallons, 0) ?? l.plannedGallons)}</div>
                  {invoice ? <div className="mt-1 text-xs"><span className="font-medium">{invoice.invoiceNumber}</span> · {money(invoice.total)} · <span className="capitalize">{titleCase(invoice.status)}</span></div> : null}
                </button>
              );
            }}
          />
        </TabsContent>
        <TabsContent value="invoices" className="space-y-4 pt-3">
          <DataTable
            rows={invoices}
            rowKey={(i) => i.id}
            selectedKey={selected}
            onRowClick={(i) => setSelected(i.id === selected ? null : i.id)}
            empty="No invoices yet. Prepare invoices for loads with a BOL."
            columns={[
              { key: "n", header: "Invoice", render: (i) => <span className="font-medium">{i.invoiceNumber}</span> },
              { key: "c", header: "Customer", render: (i) => customerName(state, i.customerId) },
              { key: "l", header: "Load", render: (i) => state.loads.find((l) => l.id === i.loadId)?.loadNumber },
              { key: "g", header: "Gallons", align: "right", render: (i) => gal(i.lines.reduce((s, l) => s + l.billedGallons, 0)) },
              { key: "sub", header: "Product", align: "right", render: (i) => money(i.subtotal) },
              { key: "tax", header: "Taxes", align: "right", render: (i) => money(i.taxTotal) },
              { key: "t", header: "Total", align: "right", render: (i) => <span className="font-medium">{money(i.total)}</span> },
              { key: "d", header: "Due", render: (i) => fmtDate(i.dueDate) },
              { key: "s", header: "Status", render: (i) => <StatusBadge label={titleCase(i.status)} className={INVOICE_STATUS_STYLE[i.status]} /> },
              { key: "qb", header: "QuickBooks", render: (i) => i.quickbooksInvoiceId ? `#${i.quickbooksInvoiceId}` : "—" },
            ]}
          />
          {inv ? (
            <SectionCard title={`${inv.invoiceNumber} · ${customerName(state, inv.customerId)}`} action={<StatusBadge label={titleCase(inv.status)} className={INVOICE_STATUS_STYLE[inv.status]} />}>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1.5 text-sm">
                  <KV label="Issued / due">{fmtDate(inv.issueDate)} / {fmtDate(inv.dueDate)}</KV>
                  {inv.lines.map((l) => (
                    <div key={l.id} className="rounded-md bg-secondary p-2 text-xs">
                      <div className="flex justify-between"><span>{productName(state, l.productId)} · {gal(l.billedGallons)} ({l.basis})</span><span className="tabular-nums">{ppg(l.pricePerGallon)}</span></div>
                      <div className="flex justify-between text-muted-foreground"><span>Freight / fees</span><span className="tabular-nums">{money(l.freight)} / {money(l.fees)}</span></div>
                      {l.taxes.map((t) => <div key={t.component} className="flex justify-between text-muted-foreground"><span>{titleCase(t.component)} @ {ppg(t.ratePerGallon)}</span><span className="tabular-nums">{money(t.amount)}</span></div>)}
                      <div className="flex justify-between font-medium"><span>Line total</span><span className="tabular-nums">{money(l.lineTotal)}</span></div>
                    </div>
                  ))}
                  <KV label="Total">{money(inv.total)}</KV>
                  {inv.approvedBy ? <KV label="Approved">{staffName(state, inv.approvedBy)} · {fmtDate(inv.approvedAt)}</KV> : null}
                  {inv.rejectionReason ? <KV label="Rejected">{inv.rejectionReason}</KV> : null}
                </div>
                <div className="space-y-2 text-sm">
                  {inv.status === "pending_approval" || inv.status === "draft" ? (
                    <>
                      <div className={cn("rounded-md px-3 py-2 text-xs", canApprove ? "bg-accent text-accent-foreground" : "bg-amber-50 text-amber-900")}>{canApprove ? "You can approve this invoice (management)." : `Acting as ${actor?.name} (${actor?.role}); switch to a management user to approve.`}</div>
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" disabled={!!busy || !canApprove} onClick={() => act(`invoices/${inv.id}/approve`).catch(() => undefined)}>Approve</Button>
                        <input className="h-8 flex-1 rounded-md border border-input bg-background px-2 text-xs" placeholder="Rejection reason" value={reason} onChange={(e) => setReason(e.target.value)} />
                        <Button size="sm" variant="outline" disabled={!!busy || !reason} onClick={() => act(`invoices/${inv.id}/reject`, { reason }).then(() => setReason("")).catch(() => undefined)}>Reject</Button>
                      </div>
                    </>
                  ) : inv.status === "approved" ? (
                    <Button size="sm" disabled={!!busy} onClick={sync}>Send to QuickBooks</Button>
                  ) : (
                    <div className="text-xs text-muted-foreground">{inv.status === "synced" ? "In QuickBooks, awaiting payment." : inv.status === "paid" ? "Paid." : "Void."}</div>
                  )}
                </div>
              </div>
            </SectionCard>
          ) : null}
        </TabsContent>
        <TabsContent value="quickbooks" className="space-y-4 pt-3">
          <SectionCard title="Invoices in QuickBooks (mock ledger)">
            <DataTable dense rows={state.qbInvoices} rowKey={(q) => q.id} empty="Nothing synced yet." columns={[
              { key: "id", header: "QB Id", render: (q) => q.id },
              { key: "doc", header: "DocNumber", render: (q) => q.docNumber },
              { key: "c", header: "CustomerRef", render: (q) => q.customerRef },
              { key: "d", header: "TxnDate", render: (q) => fmtDate(q.txnDate) },
              { key: "t", header: "TotalAmt", align: "right", render: (q) => money(q.totalAmt) },
              { key: "b", header: "Balance", align: "right", render: (q) => money(q.balance) },
              { key: "s", header: "Status", render: (q) => <StatusBadge label={q.status} className={q.status === "paid" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"} /> },
            ]} />
          </SectionCard>
          <SectionCard title="Payments received">
            <DataTable dense rows={state.payments} rowKey={(p) => p.id} empty="No payments yet." columns={[
              { key: "i", header: "Invoice", render: (p) => state.invoices.find((i) => i.id === p.invoiceId)?.invoiceNumber },
              { key: "q", header: "QB payment", render: (p) => p.quickbooksPaymentId },
              { key: "a", header: "Amount", align: "right", render: (p) => money(p.amount) },
              { key: "m", header: "Method", render: (p) => p.method },
              { key: "d", header: "Received", render: (p) => fmtDate(p.receivedAt) },
            ]} />
          </SectionCard>
        </TabsContent>
      </Tabs>
    </Page>
  );
}
