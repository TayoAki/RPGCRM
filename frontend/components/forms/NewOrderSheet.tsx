"use client";
import { useMemo, useState } from "react";
import { useOpsContext } from "@/components/ops-context";
import { Field, FormSheet, Input, NativeSelect } from "@/components/ops/primitives";
import type { Order } from "@/lib/domain";

export function NewOrderSheet({ open, onOpenChange, defaultCustomerId }: { open: boolean; onOpenChange: (o: boolean) => void; defaultCustomerId?: string }) {
  const { state, act, busy, setSelectedOrderId } = useOpsContext();
  const [customerId, setCustomerId] = useState(defaultCustomerId ?? "");
  const [locationId, setLocationId] = useState("");
  const [productId, setProductId] = useState("");
  const [gallons, setGallons] = useState("7500");
  const [date, setDate] = useState(() => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10));
  const [po, setPo] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const locations = useMemo(() => state.deliveryLocations.filter((l) => l.customerId === customerId), [state.deliveryLocations, customerId]);
  const submit = async () => {
    setError(null);
    try {
      const o = await act<Order>("orders", {
        customerId,
        deliveryLocationId: locationId || locations[0]?.id,
        productId,
        requestedGallons: Number(gallons),
        requestedDate: date,
        customerPo: po || undefined,
        specialInstructions: notes || undefined,
        source: "manual",
      });
      onOpenChange(false);
      setSelectedOrderId(o.id);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <FormSheet open={open} onOpenChange={onOpenChange} title="New order" description="Manual order entry. Orders on credit hold cannot be dispatched until billing releases them." onSubmit={submit} submitLabel="Create order" busy={busy === "orders"} error={error}>
      <Field label="Customer">
        <NativeSelect value={customerId} onChange={(e) => { setCustomerId(e.target.value); setLocationId(""); }} required>
          <option value="">Select…</option>
          {state.customers.map((c) => <option key={c.id} value={c.id}>{c.name}{c.status === "on_hold" ? " (on hold)" : ""}</option>)}
        </NativeSelect>
      </Field>
      <Field label="Delivery location">
        <NativeSelect value={locationId || locations[0]?.id || ""} onChange={(e) => setLocationId(e.target.value)} disabled={!customerId} required>
          {locations.map((l) => <option key={l.id} value={l.id}>{l.name} · {l.city}</option>)}
        </NativeSelect>
      </Field>
      <Field label="Product">
        <NativeSelect value={productId} onChange={(e) => setProductId(e.target.value)} required>
          <option value="">Select…</option>
          {state.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </NativeSelect>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Gallons"><Input type="number" min={1} step={1} value={gallons} onChange={(e) => setGallons(e.target.value)} required /></Field>
        <Field label="Requested date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></Field>
      </div>
      <Field label="Customer PO (optional)"><Input value={po} onChange={(e) => setPo(e.target.value)} placeholder="LSA-4490" /></Field>
      <Field label="Special instructions (optional)"><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Gate code, hours, contact…" /></Field>
    </FormSheet>
  );
}
