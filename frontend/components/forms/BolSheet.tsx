"use client";
import { useMemo, useState } from "react";
import { useOpsContext } from "@/components/ops-context";
import { Field, FormSheet, Input, NativeSelect } from "@/components/ops/primitives";

function localNow(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export function BolSheet({ open, onOpenChange, loadId }: { open: boolean; onOpenChange: (o: boolean) => void; loadId?: string }) {
  const { state, act, busy } = useOpsContext();
  const load = loadId ? state.loads.find((l) => l.id === loadId) : undefined;
  const [bolNumber, setBolNumber] = useState("");
  const [supplierId, setSupplierId] = useState(load?.supplierId ?? "");
  const [terminalId, setTerminalId] = useState(load?.terminalId ?? state.terminals[0]?.id ?? "");
  const [carrierId, setCarrierId] = useState(load?.carrierId ?? state.carriers[0]?.id ?? "");
  const [liftedAt, setLiftedAt] = useState(localNow());
  const [productId, setProductId] = useState(load?.productId ?? state.products[0]?.id ?? "");
  const [gross, setGross] = useState(String(load?.plannedGallons ?? ""));
  const [net, setNet] = useState(String(load ? Math.round(load.plannedGallons * 0.985) : ""));
  const [cost, setCost] = useState("");
  const [customerRef, setCustomerRef] = useState(load ? (state.customers.find((c) => c.id === load.customerId)?.code ?? "") : "");
  const [destination, setDestination] = useState(load ? `${state.customers.find((c) => c.id === load.customerId)?.name ?? ""} / ${state.deliveryLocations.find((l) => l.id === load.deliveryLocationId)?.city ?? ""}` : "");
  const [error, setError] = useState<string | null>(null);
  const terminal = state.terminals.find((t) => t.id === terminalId);
  const suppliers = useMemo(() => state.suppliers.filter((s) => terminal?.supplierIds.includes(s.id)), [state.suppliers, terminal]);
  const submit = async () => {
    setError(null);
    try {
      await act("bols", {
        bolNumber,
        supplierId: supplierId || suppliers[0]?.id,
        terminalId,
        carrierId,
        liftedAt: new Date(liftedAt).toISOString(),
        destinationText: destination,
        customerRef,
        source: "manual",
        lines: [{ productId, grossGallons: Number(gross), netGallons: Number(net), supplierCostPerGallon: cost ? Number(cost) : undefined }],
      });
      onOpenChange(false);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <FormSheet open={open} onOpenChange={onOpenChange} title="Enter BOL manually" description="From the driver's copy. The BOL is matched to a load by terminal, carrier, product, time, and customer reference." onSubmit={submit} submitLabel="Save BOL" busy={busy === "bols"} error={error} wide>
      <div className="grid grid-cols-2 gap-3">
        <Field label="BOL number"><Input value={bolNumber} onChange={(e) => setBolNumber(e.target.value)} required placeholder="MOT-DAL-441950" /></Field>
        <Field label="Lifted at"><Input type="datetime-local" value={liftedAt} onChange={(e) => setLiftedAt(e.target.value)} required /></Field>
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
        <Field label="Carrier">
          <NativeSelect value={carrierId} onChange={(e) => setCarrierId(e.target.value)}>
            {state.carriers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </NativeSelect>
        </Field>
        <Field label="Product">
          <NativeSelect value={productId} onChange={(e) => setProductId(e.target.value)}>
            {state.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </NativeSelect>
        </Field>
        <Field label="Gross gallons"><Input type="number" value={gross} onChange={(e) => setGross(e.target.value)} required /></Field>
        <Field label="Net gallons"><Input type="number" value={net} onChange={(e) => setNet(e.target.value)} required /></Field>
        <Field label="Supplier cost $/gal (blank = rack)"><Input type="number" step="0.0001" value={cost} onChange={(e) => setCost(e.target.value)} /></Field>
        <Field label="Customer reference on BOL"><Input value={customerRef} onChange={(e) => setCustomerRef(e.target.value)} placeholder="LSA" /></Field>
      </div>
      <Field label="Destination text"><Input value={destination} onChange={(e) => setDestination(e.target.value)} /></Field>
    </FormSheet>
  );
}
