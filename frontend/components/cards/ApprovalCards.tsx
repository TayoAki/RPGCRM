"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Row, money, ppg, gal } from "./shared";
import { useOpsContext } from "@/components/ops-context";
import { useSessionUser } from "@/components/Providers";
import { Field, Input, NativeSelect } from "@/components/ops/primitives";

/** Human-in-the-loop cards: nothing money-related happens until a person clicks. */

const frame = "rounded-xl border border-primary/40 bg-card p-3 text-sm shadow-sm";
const head = "mb-2 text-xs font-semibold uppercase tracking-wide text-primary";

export function ConfirmOrderCard({ args, status, respond }: { args?: { customer?: string; location?: string; product?: string; gallons?: number; requestedDate?: string; customerPo?: string; specialInstructions?: string }; status: string; respond?: (v: { approved: boolean; gallons?: number; requestedDate?: string; customerPo?: string; specialInstructions?: string }) => void }) {
  const [gallons, setGallons] = useState(String(args?.gallons ?? ""));
  const [date, setDate] = useState(args?.requestedDate ?? "");
  const [po, setPo] = useState(args?.customerPo ?? "");
  const done = status === "complete";
  return (
    <div className={frame}>
      <div className={head}>New order · confirmation needed</div>
      <div className="space-y-1">
        <Row label="Customer" value={args?.customer ?? "—"} />
        <Row label="Deliver to" value={args?.location ?? "(default location)"} />
        <Row label="Product" value={args?.product ?? "—"} />
        {done ? <><Row label="Gallons" value={gal(Number(gallons))} /><Row label="Requested" value={date} /></> : (
          <div className="grid grid-cols-2 gap-2 pt-1">
            <Field label="Gallons"><Input type="number" value={gallons} onChange={(e) => setGallons(e.target.value)} /></Field>
            <Field label="Requested date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <Field label="Customer PO" className="col-span-2"><Input value={po} onChange={(e) => setPo(e.target.value)} /></Field>
          </div>
        )}
        {args?.specialInstructions ? <div className="text-xs text-muted-foreground">{args.specialInstructions}</div> : null}
      </div>
      {!done ? (
        <div className="mt-3 flex gap-2">
          <Button size="sm" onClick={() => respond?.({ approved: true, gallons: Number(gallons), requestedDate: date, customerPo: po || undefined, specialInstructions: args?.specialInstructions })}>Create order</Button>
          <Button size="sm" variant="outline" onClick={() => respond?.({ approved: false })}>Cancel</Button>
        </div>
      ) : <div className="mt-2 text-xs text-muted-foreground">Responded ✓</div>}
    </div>
  );
}

export function ConfirmIntakeCard({ args, status, respond }: { args?: { intakeId?: string; customerName?: string; customerId?: string; deliveryLocationId?: string; deliveryLocationName?: string; productId?: string; productName?: string; gallons?: number; requestedDate?: string; customerPo?: string; issues?: string[] }; status: string; respond?: (v: { approved: boolean; edits?: Record<string, unknown> }) => void }) {
  const { state } = useOpsContext();
  const [customerId, setCustomerId] = useState(args?.customerId ?? "");
  const [locationId, setLocationId] = useState(args?.deliveryLocationId ?? "");
  const [productId, setProductId] = useState(args?.productId ?? "");
  const [gallons, setGallons] = useState(String(args?.gallons ?? ""));
  const [date, setDate] = useState(args?.requestedDate ?? "");
  const done = status === "complete";
  const locations = state.deliveryLocations.filter((l) => l.customerId === customerId);
  const ready = customerId && (locationId || locations[0]) && productId && Number(gallons) > 0 && date;
  return (
    <div className={frame}>
      <div className={head}>Approve order email {args?.intakeId ?? ""}</div>
      {done ? (
        <div className="space-y-1"><Row label="Customer" value={state.customers.find((c) => c.id === customerId)?.name ?? args?.customerName ?? "—"} /><Row label="Gallons" value={gal(Number(gallons))} /><Row label="Date" value={date} /></div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Customer" className="col-span-2"><NativeSelect value={customerId} onChange={(e) => { setCustomerId(e.target.value); setLocationId(""); }}><option value="">— select —</option>{state.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</NativeSelect></Field>
          <Field label="Location" className="col-span-2"><NativeSelect value={locationId || locations[0]?.id || ""} onChange={(e) => setLocationId(e.target.value)} disabled={!customerId}>{locations.map((l) => <option key={l.id} value={l.id}>{l.name} · {l.city}</option>)}</NativeSelect></Field>
          <Field label="Product" className="col-span-2"><NativeSelect value={productId} onChange={(e) => setProductId(e.target.value)}><option value="">— select —</option>{state.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</NativeSelect></Field>
          <Field label="Gallons"><Input type="number" value={gallons} onChange={(e) => setGallons(e.target.value)} /></Field>
          <Field label="Requested date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        </div>
      )}
      {args?.issues?.length ? <div className="mt-1 text-xs text-[color:var(--risk-medium)]">⚠ {args.issues.join("; ")}</div> : null}
      {!done ? (
        <div className="mt-3 flex gap-2">
          <Button size="sm" disabled={!ready} onClick={() => respond?.({ approved: true, edits: { customerId, deliveryLocationId: locationId || locations[0]?.id, productId, gallons: Number(gallons), requestedDate: date, customerPo: args?.customerPo } })}>Approve → create order</Button>
          <Button size="sm" variant="outline" onClick={() => respond?.({ approved: false })}>Not now</Button>
        </div>
      ) : <div className="mt-2 text-xs text-muted-foreground">Responded ✓</div>}
    </div>
  );
}

export function ConfirmInvoiceCard({ args, status, respond }: { args?: { invoiceId?: string; invoiceNumber?: string; customerName?: string; loadNumber?: string; gallons?: number; pricePerGallon?: number; subtotal?: number; taxTotal?: number; total?: number; dueDate?: string }; status: string; respond?: (v: { approved: boolean }) => void }) {
  const actor = useSessionUser();
  const canApprove = ["management", "admin"].includes(actor.role);
  const done = status === "complete";
  return (
    <div className={frame}>
      <div className={head}>Approve invoice {args?.invoiceNumber ?? ""}</div>
      <div className="space-y-1">
        <Row label="Customer" value={args?.customerName ?? "—"} />
        <Row label="Load" value={args?.loadNumber ?? "—"} />
        <Row label="Gallons × price" value={`${gal(args?.gallons)} × ${ppg(args?.pricePerGallon)}`} />
        <Row label="Product / taxes" value={`${money(args?.subtotal)} / ${money(args?.taxTotal)}`} />
        <Row label="Total" value={<span className="font-semibold">{money(args?.total)}</span>} />
        <Row label="Due" value={args?.dueDate ?? "—"} />
      </div>
      {!canApprove && !done ? <div className="mt-2 rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-900">Signed in as {actor.name} ({actor.role}). Only management or admin can approve invoices; ask a manager to approve this one.</div> : null}
      {!done ? (
        <div className="mt-3 flex gap-2">
          <Button size="sm" disabled={!canApprove} onClick={() => respond?.({ approved: true })}>Approve</Button>
          <Button size="sm" variant="outline" onClick={() => respond?.({ approved: false })}>Hold</Button>
        </div>
      ) : <div className="mt-2 text-xs text-muted-foreground">Responded ✓</div>}
    </div>
  );
}
