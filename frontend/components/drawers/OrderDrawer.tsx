"use client";
import { useState } from "react";
import { useOpsContext } from "@/components/ops-context";
import { Drawer, DrawerSection, KV, StatusBadge, Timeline } from "@/components/ops/primitives";
import { Button } from "@/components/ui/button";
import { NewLoadSheet } from "@/components/forms/NewLoadSheet";
import { customerName, fmtDate, fmtDateTime, gal, isOpenOrder, loadForOrder, locationName, NEXT_ORDER_STATUS, orderStatusLabel, ORDER_STATUS_STYLE, ppg, productName, staffName, titleCase, money } from "@/lib/ops";

export function OrderDrawer({ orderId, onClose }: { orderId: string | null; onClose: () => void }) {
  const { state, act, busy, setSelectedLoadId } = useOpsContext();
  const [dispatch, setDispatch] = useState(false);
  const order = state.orders.find((o) => o.id === orderId);
  if (!order) return null;
  const customer = state.customers.find((c) => c.id === order.customerId);
  const location = state.deliveryLocations.find((l) => l.id === order.deliveryLocationId);
  const load = loadForOrder(state, order.id);
  const events = state.orderEvents.filter((e) => e.orderId === order.id).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  const price = [...state.customerPrices].reverse().find((p) => p.customerId === order.customerId && p.productId === order.productId);
  const intake = order.emailIntakeId ? state.emailIntakes.find((e) => e.id === order.emailIntakeId) : undefined;
  const next = NEXT_ORDER_STATUS[order.status];
  const onHold = order.creditHold || customer?.status === "on_hold";
  const doStatus = (status: string) => act(`orders/${order.id}/status`, { status }).catch(() => undefined);
  return (
    <Drawer open onClose={onClose} title={`${order.orderNumber} · ${customerName(state, order.customerId)}`} subtitle={<span className="flex items-center gap-2"><StatusBadge label={orderStatusLabel(order.status)} className={ORDER_STATUS_STYLE[order.status]} />{onHold ? <StatusBadge label="Credit hold" className="bg-rose-100 text-rose-800" /> : null}<span>Source: {order.source}</span></span>}>
      <DrawerSection title="Order">
        <div className="space-y-1.5">
          <KV label="Product">{productName(state, order.productId)}</KV>
          <KV label="Gallons">{gal(order.requestedGallons)}</KV>
          <KV label="Requested">{fmtDate(order.requestedDate)}{order.requestedWindow ? ` (${order.requestedWindow})` : ""}</KV>
          <KV label="Deliver to">{locationName(state, order.deliveryLocationId)}{location ? ` · ${location.city}, ${location.state}` : ""}</KV>
          <KV label="Customer PO">{order.customerPo ?? "—"}</KV>
          <KV label="Created">{fmtDateTime(order.createdAt)}</KV>
          {order.specialInstructions ? <div className="rounded-md bg-secondary px-2 py-1.5 text-xs">{order.specialInstructions}</div> : null}
          {location?.deliveryInstructions ? <div className="text-xs text-muted-foreground">Site: {location.deliveryInstructions}</div> : null}
          {intake ? <div className="text-xs text-muted-foreground">From email: “{intake.subject}”</div> : null}
        </div>
      </DrawerSection>
      <DrawerSection title="Price at order">
        {price ? (
          <div className="space-y-1.5">
            <KV label="Sell price">{ppg(price.sellPricePerGallon)}</KV>
            <KV label="Basis">{titleCase(price.basisType)} {ppg(price.basisValue)}</KV>
            <KV label="Est. total">{money(price.sellPricePerGallon * order.requestedGallons)}</KV>
            <div className="text-[11px] text-muted-foreground">{price.explanation[0]}</div>
          </div>
        ) : (
          <div className="text-xs text-[color:var(--risk-high)]">No price could be computed. Add or activate a pricing rule.</div>
        )}
      </DrawerSection>
      <DrawerSection title="Load" action={load ? <Button size="sm" variant="ghost" onClick={() => setSelectedLoadId(load.id)}>Open {load.loadNumber}</Button> : null}>
        {load ? (
          <div className="space-y-1.5">
            <KV label="Status">{titleCase(load.status)}</KV>
            <KV label="Carrier">{state.carriers.find((c) => c.id === load.carrierId)?.name}</KV>
            <KV label="Pickup">{fmtDateTime(load.scheduledPickupAt)}</KV>
          </div>
        ) : isOpenOrder(order) ? (
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>Not dispatched yet.</span>
            <Button size="sm" onClick={() => setDispatch(true)} disabled={onHold || !!busy}>Dispatch</Button>
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">No load.</div>
        )}
      </DrawerSection>
      <DrawerSection title="Milestones">
        <Timeline items={events.map((e) => ({ label: orderStatusLabel(e.to), at: fmtDateTime(e.occurredAt), by: staffName(state, e.actorId), note: e.note }))} />
      </DrawerSection>
      {isOpenOrder(order) ? (
        <DrawerSection title="Actions">
          <div className="flex flex-wrap gap-2">
            {onHold && order.creditHold ? <Button size="sm" variant="outline" disabled={!!busy} onClick={() => act(`orders/${order.id}/release-hold`).catch(() => undefined)}>Release credit hold</Button> : null}
            {next ? <Button size="sm" disabled={!!busy || (next === "confirmed" && onHold)} onClick={() => doStatus(next)}>Mark {orderStatusLabel(next)}</Button> : null}
            {["received", "confirmed", "carrier_confirmed"].includes(order.status) ? <Button size="sm" variant="outline" disabled={!!busy} onClick={() => doStatus("cancelled")}>Cancel order</Button> : null}
          </div>
        </DrawerSection>
      ) : null}
      {dispatch ? <NewLoadSheet orderId={order.id} open={dispatch} onOpenChange={setDispatch} /> : null}
    </Drawer>
  );
}
