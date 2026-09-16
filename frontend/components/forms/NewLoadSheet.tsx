"use client";
import { useMemo, useState } from "react";
import { useOpsContext } from "@/components/ops-context";
import { Field, FormSheet, Input, NativeSelect } from "@/components/ops/primitives";
import type { Load } from "@/lib/domain";

function localInput(d: Date): string {
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
}

export function NewLoadSheet({ orderId, open, onOpenChange }: { orderId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { state, act, busy, setSelectedLoadId } = useOpsContext();
  const [carrierId, setCarrierId] = useState(state.carriers[0]?.id ?? "");
  const [terminalId, setTerminalId] = useState(state.terminals[0]?.id ?? "");
  const [supplierId, setSupplierId] = useState("");
  const [pickup, setPickup] = useState(() => localInput(new Date(Date.now() + 18 * 3600e3)));
  const [delivery, setDelivery] = useState(() => localInput(new Date(Date.now() + 22 * 3600e3)));
  const [driver, setDriver] = useState("");
  const [error, setError] = useState<string | null>(null);
  const terminal = state.terminals.find((t) => t.id === terminalId);
  const suppliers = useMemo(() => state.suppliers.filter((s) => terminal?.supplierIds.includes(s.id)), [state.suppliers, terminal]);
  const submit = async () => {
    setError(null);
    try {
      const l = await act<Load>("loads", {
        orderId,
        carrierId,
        terminalId,
        supplierId: supplierId || suppliers[0]?.id,
        scheduledPickupAt: new Date(pickup).toISOString(),
        scheduledDeliveryAt: new Date(delivery).toISOString(),
        driverName: driver || undefined,
      });
      onOpenChange(false);
      setSelectedLoadId(l.id);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <FormSheet open={open} onOpenChange={onOpenChange} title="Dispatch: create load" description="Assign a carrier and lift terminal. The order moves to Confirmed; Carrier Confirmed follows when the load is dispatched." onSubmit={submit} submitLabel="Create load" busy={busy === "loads"} error={error}>
      <Field label="Carrier">
        <NativeSelect value={carrierId} onChange={(e) => setCarrierId(e.target.value)}>
          {state.carriers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </NativeSelect>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Terminal">
          <NativeSelect value={terminalId} onChange={(e) => { setTerminalId(e.target.value); setSupplierId(""); }}>
            {state.terminals.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </NativeSelect>
        </Field>
        <Field label="Supplier">
          <NativeSelect value={supplierId || suppliers[0]?.id || ""} onChange={(e) => setSupplierId(e.target.value)}>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </NativeSelect>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Scheduled pickup"><Input type="datetime-local" value={pickup} onChange={(e) => setPickup(e.target.value)} required /></Field>
        <Field label="Scheduled delivery"><Input type="datetime-local" value={delivery} onChange={(e) => setDelivery(e.target.value)} required /></Field>
      </div>
      <Field label="Driver (optional)"><Input value={driver} onChange={(e) => setDriver(e.target.value)} /></Field>
    </FormSheet>
  );
}
