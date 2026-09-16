"use client";
import { useMemo, useState } from "react";
import { useOpsContext } from "@/components/ops-context";
import { Field, FormSheet, Input, NativeSelect } from "@/components/ops/primitives";

export function RackPriceSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { state, act, busy } = useOpsContext();
  const [terminalId, setTerminalId] = useState(state.terminals[0]?.id ?? "");
  const [supplierId, setSupplierId] = useState("");
  const [productId, setProductId] = useState(state.products[0]?.id ?? "");
  const [price, setPrice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const terminal = state.terminals.find((t) => t.id === terminalId);
  const suppliers = useMemo(() => state.suppliers.filter((s) => terminal?.supplierIds.includes(s.id)), [state.suppliers, terminal]);
  const submit = async () => {
    setError(null);
    try {
      await act("rack-prices", { terminalId, supplierId: supplierId || suppliers[0]?.id, productId, pricePerGallon: Number(price) });
      onOpenChange(false);
      setPrice("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <FormSheet open={open} onOpenChange={onOpenChange} title="Enter rack price" description="Supplier base price at a terminal, effective now. Customer prices recalculate from it." onSubmit={submit} submitLabel="Save price" busy={busy === "rack-prices"} error={error}>
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
      <Field label="Product">
        <NativeSelect value={productId} onChange={(e) => setProductId(e.target.value)}>
          {state.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </NativeSelect>
      </Field>
      <Field label="Price per gallon ($)"><Input type="number" step="0.0001" min="0.0001" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="2.4875" required /></Field>
    </FormSheet>
  );
}
