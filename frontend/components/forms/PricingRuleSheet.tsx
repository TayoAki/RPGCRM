"use client";
import { useMemo, useState } from "react";
import { useOpsContext } from "@/components/ops-context";
import { Field, FormSheet, Input, NativeSelect } from "@/components/ops/primitives";
import type { PricingRule } from "@/lib/domain";

const today = () => new Date().toISOString().slice(0, 10);

export function PricingRuleSheet({ open, onOpenChange, rule }: { open: boolean; onOpenChange: (o: boolean) => void; rule?: PricingRule | null }) {
  const { state, act, busy } = useOpsContext();
  const [form, setForm] = useState<PricingRule>(() => rule ?? {
    id: "",
    name: "",
    customerId: null,
    productId: state.products[0]?.id ?? "",
    terminalId: null,
    deliveryLocationId: null,
    basisType: "rack",
    basisRef: null,
    fixedPrice: null,
    differential: 0.1,
    freightPerGallon: 0.05,
    feesPerGallon: 0.005,
    taxTreatment: "taxable",
    effectiveStart: today(),
    effectiveEnd: null,
    priority: 10,
    status: "active",
  });
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof PricingRule>(k: K, v: PricingRule[K]) => setForm((f) => ({ ...f, [k]: v }));
  const locations = useMemo(() => state.deliveryLocations.filter((l) => l.customerId === form.customerId), [state.deliveryLocations, form.customerId]);
  const submit = async () => {
    setError(null);
    try {
      const payload = { ...form, id: form.id || undefined, name: form.name || `${form.customerId ? state.customers.find((c) => c.id === form.customerId)?.name : "Default"} ${state.products.find((p) => p.id === form.productId)?.code}` };
      await act("pricing-rules", payload);
      onOpenChange(false);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const num = (v: string) => (v === "" ? 0 : Number(v));
  return (
    <FormSheet open={open} onOpenChange={onOpenChange} title={rule ? "Edit pricing rule" : "New pricing rule"} description="Most specific rule wins (location › terminal › customer), then priority. Sell = basis + differential + freight + fees + taxes." onSubmit={submit} submitLabel={rule ? "Save rule" : "Create rule"} busy={busy === "pricing-rules"} error={error} wide>
      <Field label="Name"><Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="QuickStop 87 ex Dallas: rack + $0.06" /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Customer (blank = all)">
          <NativeSelect value={form.customerId ?? ""} onChange={(e) => { set("customerId", e.target.value || null); set("deliveryLocationId", null); }}>
            <option value="">All customers (default rule)</option>
            {state.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </NativeSelect>
        </Field>
        <Field label="Product">
          <NativeSelect value={form.productId} onChange={(e) => set("productId", e.target.value)}>
            {state.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </NativeSelect>
        </Field>
        <Field label="Terminal (blank = any)">
          <NativeSelect value={form.terminalId ?? ""} onChange={(e) => set("terminalId", e.target.value || null)}>
            <option value="">Any terminal</option>
            {state.terminals.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </NativeSelect>
        </Field>
        <Field label="Delivery location (blank = any)">
          <NativeSelect value={form.deliveryLocationId ?? ""} onChange={(e) => set("deliveryLocationId", e.target.value || null)} disabled={!form.customerId}>
            <option value="">Any location</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </NativeSelect>
        </Field>
        <Field label="Basis">
          <NativeSelect value={form.basisType} onChange={(e) => { const b = e.target.value as PricingRule["basisType"]; set("basisType", b); set("basisRef", null); }}>
            <option value="rack">Rack (supplier posting)</option>
            <option value="index">Index (OPIS / NYMEX)</option>
            <option value="fixed">Fixed contract price</option>
          </NativeSelect>
        </Field>
        {form.basisType === "rack" ? (
          <Field label="Rack terminal (blank = request/cheapest)">
            <NativeSelect value={form.basisRef ?? ""} onChange={(e) => set("basisRef", e.target.value || null)}>
              <option value="">Use lift terminal</option>
              {state.terminals.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </NativeSelect>
          </Field>
        ) : form.basisType === "index" ? (
          <Field label="Index">
            <NativeSelect value={form.basisRef ?? ""} onChange={(e) => set("basisRef", e.target.value || null)} required>
              <option value="">Select…</option>
              {state.priceIndexes.map((i) => <option key={i.id} value={i.id}>{i.code}</option>)}
            </NativeSelect>
          </Field>
        ) : (
          <Field label="Fixed price ($/gal)"><Input type="number" step="0.0001" value={form.fixedPrice ?? ""} onChange={(e) => set("fixedPrice", e.target.value === "" ? null : Number(e.target.value))} required /></Field>
        )}
        <Field label="Differential ($/gal)"><Input type="number" step="0.0001" value={form.differential} onChange={(e) => set("differential", num(e.target.value))} /></Field>
        <Field label="Freight ($/gal)"><Input type="number" step="0.0001" value={form.freightPerGallon} onChange={(e) => set("freightPerGallon", num(e.target.value))} /></Field>
        <Field label="Fees ($/gal)"><Input type="number" step="0.0001" value={form.feesPerGallon} onChange={(e) => set("feesPerGallon", num(e.target.value))} /></Field>
        <Field label="Tax treatment">
          <NativeSelect value={form.taxTreatment} onChange={(e) => set("taxTreatment", e.target.value as PricingRule["taxTreatment"])}>
            <option value="taxable">Taxable</option>
            <option value="exempt">Exempt</option>
          </NativeSelect>
        </Field>
        <Field label="Effective start"><Input type="date" value={form.effectiveStart.slice(0, 10)} onChange={(e) => set("effectiveStart", e.target.value)} required /></Field>
        <Field label="Effective end (optional)"><Input type="date" value={form.effectiveEnd?.slice(0, 10) ?? ""} onChange={(e) => set("effectiveEnd", e.target.value || null)} /></Field>
        <Field label="Priority"><Input type="number" value={form.priority} onChange={(e) => set("priority", num(e.target.value))} /></Field>
        <Field label="Status">
          <NativeSelect value={form.status} onChange={(e) => set("status", e.target.value as PricingRule["status"])}>
            <option value="active">Active</option>
            <option value="draft">Draft</option>
            <option value="expired">Expired</option>
          </NativeSelect>
        </Field>
      </div>
    </FormSheet>
  );
}
