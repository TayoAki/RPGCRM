"use client";
import { useState } from "react";
import { useOpsContext } from "@/components/ops-context";
import { Drawer, DrawerSection, KV, StatusBadge, Timeline } from "@/components/ops/primitives";
import { Button } from "@/components/ui/button";
import { DeliverySheet } from "@/components/forms/DeliverySheet";
import { BolSheet } from "@/components/forms/BolSheet";
import { billingStatusLabel, BILLING_STATUS_STYLE, carrierName, customerName, fmtDateTime, gal, INVOICE_STATUS_STYLE, loadStatusLabel, LOAD_STATUS_STYLE, locationName, money, NEXT_LOAD_STATUS, ppg, productName, signed, staffName, supplierName, terminalName, titleCase } from "@/lib/ops";

export function LoadDrawer({ loadId, onClose }: { loadId: string | null; onClose: () => void }) {
  const { state, act, busy, setSelectedOrderId } = useOpsContext();
  const [delivery, setDelivery] = useState(false);
  const [bolEntry, setBolEntry] = useState(false);
  const load = state.loads.find((l) => l.id === loadId);
  if (!load) return null;
  const bol = load.bolId ? state.bols.find((b) => b.id === load.bolId) : undefined;
  const deliveryRec = state.deliveries.find((d) => d.loadId === load.id);
  const invoice = load.invoiceId ? state.invoices.find((i) => i.id === load.invoiceId) : undefined;
  const margin = state.loadMargins.find((m) => m.loadId === load.id);
  const events = state.loadEvents.filter((e) => e.loadId === load.id).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  const next = NEXT_LOAD_STATUS[load.status];
  const canBill = (to: string) => act(`loads/${load.id}/billing-status`, { status: to }).catch(() => undefined);
  return (
    <Drawer open onClose={onClose} title={`${load.loadNumber} · ${customerName(state, load.customerId)}`} subtitle={<span className="flex items-center gap-2"><StatusBadge label={loadStatusLabel(load.status)} className={LOAD_STATUS_STYLE[load.status]} />{load.billingStatus ? <StatusBadge label={billingStatusLabel(load.billingStatus)} className={BILLING_STATUS_STYLE[load.billingStatus]} /> : <span className="text-xs">No BOL yet</span>}</span>}>
      <DrawerSection title="Load">
        <div className="space-y-1.5">
          <KV label="Orders">{load.orderIds.map((id) => <button key={id} type="button" className="text-primary underline-offset-2 hover:underline" onClick={() => setSelectedOrderId(id)}>{state.orders.find((o) => o.id === id)?.orderNumber ?? id}</button>)}</KV>
          <KV label="Product">{productName(state, load.productId)} · {gal(load.plannedGallons)} planned</KV>
          <KV label="Deliver to">{locationName(state, load.deliveryLocationId)}</KV>
          <KV label="Carrier">{carrierName(state, load.carrierId)}{load.driverName ? ` · ${load.driverName}` : ""}</KV>
          <KV label="Lift">{terminalName(state, load.terminalId)} · {supplierName(state, load.supplierId)}</KV>
          <KV label="Pickup">{fmtDateTime(load.scheduledPickupAt)}</KV>
          <KV label="Delivery">{fmtDateTime(load.scheduledDeliveryAt)}</KV>
          <KV label="Freight cost">{load.freightCost ? money(load.freightCost) : "estimated"}</KV>
        </div>
      </DrawerSection>
      <DrawerSection title="Bill of lading" action={!bol ? <Button size="sm" variant="outline" onClick={() => setBolEntry(true)}>Enter BOL</Button> : null}>
        {bol ? (
          <div className="space-y-1.5">
            <KV label="BOL #">{bol.bolNumber} <span className="text-xs text-muted-foreground">({bol.source})</span></KV>
            <KV label="Lifted">{fmtDateTime(bol.liftedAt)}</KV>
            {bol.lines.map((l, i) => (
              <div key={i} className="rounded-md bg-secondary px-2 py-1.5 text-xs">
                <div className="flex justify-between"><span>{productName(state, l.productId)}</span><span className="tabular-nums">{gal(l.grossGallons)} gross · {gal(l.netGallons)} net</span></div>
                <div className="flex justify-between text-muted-foreground"><span>Supplier cost</span><span className="tabular-nums">{ppg(l.supplierCostPerGallon)} · taxes {ppg(l.taxesPerGallon)} · fees {ppg(l.feesPerGallon)}</span></div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">No BOL received. Pull the supplier feed or enter it from the driver&apos;s copy.</div>
        )}
      </DrawerSection>
      <DrawerSection title="Delivery" action={!deliveryRec && ["dispatched", "loading", "in_transit"].includes(load.status) ? <Button size="sm" variant="outline" onClick={() => setDelivery(true)}>Record delivery</Button> : null}>
        {deliveryRec ? (
          <div className="space-y-1.5">
            <KV label="Delivered">{fmtDateTime(deliveryRec.deliveredAt)}</KV>
            <KV label="Gallons">{gal(deliveryRec.deliveredGallons)}</KV>
            <KV label="Receiver">{deliveryRec.receiverName} · ticket {deliveryRec.ticketNumber}</KV>
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">Not delivered yet.</div>
        )}
      </DrawerSection>
      <DrawerSection title="Billing">
        <div className="space-y-1.5">
          {invoice ? (
            <>
              <KV label="Invoice">{invoice.invoiceNumber} <StatusBadge label={titleCase(invoice.status)} className={INVOICE_STATUS_STYLE[invoice.status]} /></KV>
              <KV label="Total">{money(invoice.total)}</KV>
            </>
          ) : (
            <div className="text-xs text-muted-foreground">{load.bolId ? "No invoice yet." : "Billing starts when a BOL is received."}</div>
          )}
          {load.bolId && !invoice ? (
            <div className="flex flex-wrap gap-2 pt-1">
              {load.billingStatus === "bol_received" ? <Button size="sm" variant="outline" disabled={!!busy} onClick={() => canBill("pricing_verified")}>Mark pricing verified</Button> : null}
              {load.billingStatus === "pricing_verified" ? <Button size="sm" variant="outline" disabled={!!busy} onClick={() => canBill("ready_to_invoice")}>Ready to invoice</Button> : null}
              <Button size="sm" disabled={!!busy} onClick={() => act("invoices/prepare", { loadIds: [load.id] }).catch(() => undefined)}>Prepare invoice</Button>
            </div>
          ) : null}
        </div>
      </DrawerSection>
      <DrawerSection title="Margin">
        {margin ? (
          <div className="space-y-1.5">
            <KV label="Expected gross profit">{money(margin.expectedGrossProfit)}</KV>
            <KV label="Actual gross profit">{margin.actualGrossProfit === null ? "pending BOL" : money(margin.actualGrossProfit)}</KV>
            <KV label="Profit / gal">{margin.profitPerGallon === null ? "—" : ppg(margin.profitPerGallon)}</KV>
            <KV label="Variance">{margin.variance === null ? "—" : <span className={margin.variance < 0 ? "text-[color:var(--risk-high)]" : "text-[color:var(--risk-low)]"}>{signed(margin.variance, 2)}</span>}</KV>
            <KV label="Revenue / cost / freight">{money(margin.revenue)} / {money(margin.supplierCost)} / {money(margin.freightCost)}</KV>
          </div>
        ) : <div className="text-xs text-muted-foreground">Not computed.</div>}
      </DrawerSection>
      <DrawerSection title="Timeline">
        <Timeline items={events.map((e) => ({ label: loadStatusLabel(e.to), at: fmtDateTime(e.occurredAt), by: staffName(state, e.actorId), note: e.note }))} />
      </DrawerSection>
      {next && next !== "delivered" ? (
        <DrawerSection title="Actions">
          <Button size="sm" disabled={!!busy} onClick={() => act(`loads/${load.id}/status`, { status: next }).catch(() => undefined)}>Mark {loadStatusLabel(next)}</Button>
        </DrawerSection>
      ) : null}
      {delivery ? <DeliverySheet loadId={load.id} open={delivery} onOpenChange={setDelivery} /> : null}
      {bolEntry ? <BolSheet open={bolEntry} onOpenChange={setBolEntry} loadId={load.id} /> : null}
    </Drawer>
  );
}
