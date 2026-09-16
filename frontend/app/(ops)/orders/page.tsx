"use client";
import { useState } from "react";
import { useOpsContext } from "@/components/ops-context";
import { Page, PageHeader, DataTable, StatusBadge, SectionCard, Empty, NativeSelect, Input, Field } from "@/components/ops/primitives";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { NewOrderSheet } from "@/components/forms/NewOrderSheet";
import type { EmailIntake, Order, ParsedOrder } from "@/lib/domain";
import { ORDER_STATUSES } from "@/lib/domain";
import { customerName, fmtDate, gal, isOpenOrder, loadForOrder, locationName, orderStatusLabel, ORDER_STATUS_STYLE, productName, relativeTime, staffName, fmtDateTime } from "@/lib/ops";
import { cn } from "@/lib/utils";
import { Paperclip } from "lucide-react";

function IntakeCard({ intake }: { intake: EmailIntake }) {
  const { state, act, busy } = useOpsContext();
  const [edits, setEdits] = useState<Partial<ParsedOrder>>({});
  const p = { ...intake.parsed, ...edits };
  const locations = state.deliveryLocations.filter((l) => l.customerId === p.customerId);
  const conf = Math.round(intake.confidence * 100);
  const key = `intake/${intake.id}/review`;
  const ready = p.customerId && p.deliveryLocationId && p.productId && p.gallons && p.requestedDate;
  return (
    <div className="rounded-xl border border-border bg-card p-4 text-sm shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium">{intake.subject}</div>
          <div className="text-xs text-muted-foreground">{intake.from} · {relativeTime(intake.receivedAt)}</div>
          {intake.attachments?.length ? (
            <div className="mt-1 flex flex-wrap gap-1">
              {intake.attachments.map((a) => (
                <span key={a.filename} title={a.note ?? a.contentType} className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]", a.status === "parsed" ? "bg-accent text-accent-foreground" : "bg-secondary text-muted-foreground")}>
                  <Paperclip className="h-3 w-3" />{a.filename}
                  <span className="text-muted-foreground">· {a.status === "parsed" ? `${a.drafts} order${a.drafts === 1 ? "" : "s"}` : a.status === "error" ? "could not read" : "not parsed"}</span>
                </span>
              ))}
            </div>
          ) : null}
          {intake.parsed.source ? <div className="mt-1 text-xs text-brand-blue">Order details read from {intake.parsed.source.attachment}{intake.parsed.source.row ? `, row ${intake.parsed.source.row}` : ""}</div> : null}
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Confidence</span>
          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-secondary"><div className={cn("h-full rounded-full", conf >= 80 ? "bg-[color:var(--risk-low)]" : conf >= 50 ? "bg-[color:var(--risk-medium)]" : "bg-[color:var(--risk-high)]")} style={{ width: `${conf}%` }} /></div>
          <span className="tabular-nums">{conf}%</span>
        </div>
      </div>
      <pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap rounded-md bg-secondary p-2 text-xs text-muted-foreground">{intake.body}</pre>
      <div className="mt-3 grid gap-2 @2xl:grid-cols-3">
        <Field label={`Customer ${pctLabel(intake.parsed.fieldConfidence.customer)}`}>
          <NativeSelect value={p.customerId ?? ""} onChange={(e) => setEdits((x) => ({ ...x, customerId: e.target.value || undefined, deliveryLocationId: undefined }))}>
            <option value="">— not matched —</option>
            {state.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </NativeSelect>
        </Field>
        <Field label={`Location ${pctLabel(intake.parsed.fieldConfidence.location)}`}>
          <NativeSelect value={p.deliveryLocationId ?? ""} onChange={(e) => setEdits((x) => ({ ...x, deliveryLocationId: e.target.value || undefined }))} disabled={!p.customerId}>
            <option value="">— not matched —</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name} · {l.city}</option>)}
          </NativeSelect>
        </Field>
        <Field label={`Product ${pctLabel(intake.parsed.fieldConfidence.product)}`}>
          <NativeSelect value={p.productId ?? ""} onChange={(e) => setEdits((x) => ({ ...x, productId: e.target.value || undefined }))}>
            <option value="">— not recognized —</option>
            {state.products.map((pr) => <option key={pr.id} value={pr.id}>{pr.name}</option>)}
          </NativeSelect>
        </Field>
        <Field label={`Gallons ${pctLabel(intake.parsed.fieldConfidence.gallons)}`}><Input type="number" value={p.gallons ?? ""} onChange={(e) => setEdits((x) => ({ ...x, gallons: e.target.value ? Number(e.target.value) : undefined }))} /></Field>
        <Field label={`Requested date ${pctLabel(intake.parsed.fieldConfidence.date)}`}><Input type="date" value={p.requestedDate ?? ""} onChange={(e) => setEdits((x) => ({ ...x, requestedDate: e.target.value || undefined }))} /></Field>
        <Field label="Customer PO"><Input value={p.customerPo ?? ""} onChange={(e) => setEdits((x) => ({ ...x, customerPo: e.target.value || undefined }))} /></Field>
      </div>
      {intake.issues.length ? (
        <ul className="mt-2 space-y-0.5 text-xs text-[color:var(--risk-medium)]">{intake.issues.map((i) => <li key={i}>⚠ {i}</li>)}</ul>
      ) : null}
      <div className="mt-3 flex gap-2">
        <Button size="sm" disabled={!ready || busy === key} onClick={() => act(key, { decision: "approve", edits }).catch(() => undefined)}>Approve → create order</Button>
        <Button size="sm" variant="outline" disabled={busy === key} onClick={() => act(key, { decision: "reject" }).catch(() => undefined)}>Reject</Button>
      </div>
    </div>
  );
}

const pctLabel = (c?: number) => (c === undefined ? "" : `· ${Math.round(c * 100)}%`);

export default function OrdersPage() {
  const { state, act, busy, selectedOrderId, setSelectedOrderId } = useOpsContext();
  const [filter, setFilter] = useState<"open" | "all" | Order["status"]>("open");
  const [newOrder, setNewOrder] = useState(false);
  const pending = state.emailIntakes.filter((e) => e.reviewStatus === "pending").sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  const history = state.emailIntakes.filter((e) => e.reviewStatus !== "pending").sort((a, b) => (b.reviewedAt ?? "").localeCompare(a.reviewedAt ?? ""));
  const orders = state.orders
    .filter((o) => (filter === "all" ? true : filter === "open" ? isOpenOrder(o) : o.status === filter))
    .sort((a, b) => b.requestedDate.localeCompare(a.requestedDate) || b.orderNumber.localeCompare(a.orderNumber));
  return (
    <Page>
      <PageHeader title="Orders & intake" description="Customer orders from email, the portal, and manual entry. Emails are parsed into drafts that a person approves." actions={<><Button size="sm" variant="outline" disabled={!!busy} onClick={() => act("intake/run").catch(() => undefined)}>Run email intake</Button><Button size="sm" onClick={() => setNewOrder(true)}>New order</Button></>} />
      <Tabs defaultValue={pending.length ? "intake" : "orders"}>
        <TabsList>
          <TabsTrigger value="orders">Orders ({state.orders.filter(isOpenOrder).length} open)</TabsTrigger>
          <TabsTrigger value="intake">Intake queue ({pending.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="orders" className="space-y-3 pt-3">
          <div className="flex flex-wrap gap-1.5">
            {(["open", "all", ...ORDER_STATUSES] as const).map((f) => (
              <button key={f} type="button" onClick={() => setFilter(f)} className={cn("rounded-full border px-2.5 py-1 text-xs", filter === f ? "border-primary bg-accent text-accent-foreground" : "border-border text-muted-foreground hover:bg-secondary")}>{f === "open" ? "Open" : f === "all" ? "All" : orderStatusLabel(f)}</button>
            ))}
          </div>
          <DataTable
            rows={orders}
            rowKey={(o) => o.id}
            selectedKey={selectedOrderId}
            onRowClick={(o) => setSelectedOrderId(o.id)}
            empty="No orders match this filter."
            columns={[
              { key: "n", header: "Order", render: (o) => <span className="font-medium">{o.orderNumber}</span> },
              { key: "c", header: "Customer", render: (o) => customerName(state, o.customerId) },
              { key: "l", header: "Deliver to", render: (o) => locationName(state, o.deliveryLocationId) },
              { key: "p", header: "Product", render: (o) => productName(state, o.productId) },
              { key: "g", header: "Gallons", align: "right", render: (o) => gal(o.requestedGallons) },
              { key: "d", header: "Requested", render: (o) => fmtDate(o.requestedDate) },
              { key: "s", header: "Status", render: (o) => <span className="flex items-center gap-1.5"><StatusBadge label={orderStatusLabel(o.status)} className={ORDER_STATUS_STYLE[o.status]} />{o.creditHold ? <StatusBadge label="hold" className="bg-rose-100 text-rose-800" /> : null}</span> },
              { key: "src", header: "Source", render: (o) => <span className="capitalize text-muted-foreground">{o.source}</span> },
              { key: "po", header: "PO", render: (o) => o.customerPo ?? "—" },
              { key: "ld", header: "Load", render: (o) => loadForOrder(state, o.id)?.loadNumber ?? "—" },
            ]}
          />
        </TabsContent>
        <TabsContent value="intake" className="space-y-4 pt-3">
          {pending.length === 0 ? <Empty>Queue is empty. “Run email intake” pulls the inbox (sample emails in this MVP).</Empty> : pending.map((i) => <IntakeCard key={i.id} intake={i} />)}
          {history.length ? (
            <SectionCard title="Reviewed">
              <DataTable dense rows={history} rowKey={(e) => e.id} columns={[
                { key: "s", header: "Subject", render: (e) => e.subject },
                { key: "f", header: "From", render: (e) => e.from },
                { key: "r", header: "Decision", render: (e) => <StatusBadge label={e.reviewStatus} className={e.reviewStatus === "approved" ? "bg-emerald-100 text-emerald-800" : "bg-zinc-200 text-zinc-700"} /> },
                { key: "b", header: "By", render: (e) => e.reviewedBy ? `${staffName(state, e.reviewedBy)} · ${fmtDateTime(e.reviewedAt)}` : "—" },
                { key: "o", header: "Order", render: (e) => e.orderId ? <button type="button" className="text-primary hover:underline" onClick={() => setSelectedOrderId(e.orderId!)}>{state.orders.find((o) => o.id === e.orderId)?.orderNumber}</button> : "—" },
              ]} />
            </SectionCard>
          ) : null}
        </TabsContent>
      </Tabs>
      <NewOrderSheet open={newOrder} onOpenChange={setNewOrder} />
    </Page>
  );
}
