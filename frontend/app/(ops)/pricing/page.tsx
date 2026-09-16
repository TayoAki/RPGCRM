"use client";
import { useEffect, useMemo, useState } from "react";
import { useOpsContext } from "@/components/ops-context";
import { Page, PageHeader, DataTable, StatusBadge, SectionCard, NativeSelect, Field, Input } from "@/components/ops/primitives";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { RackPriceSheet } from "@/components/forms/RackPriceSheet";
import { PricingRuleSheet } from "@/components/forms/PricingRuleSheet";
import type { CustomerPrice, PricingRule, RackPrice } from "@/lib/domain";
import { customerName, fmtDate, fmtDateTime, locationName, ppg, productName, signed, supplierName, terminalName, titleCase, money } from "@/lib/ops";

interface BoardRow { customerId: string; customerName: string; productId: string; productName: string; terminalName: string | null; sellPricePerGallon: number | null; basisType: string | null; ruleName: string | null; error: string | null }

export default function PricingPage() {
  const { state, act, busy, version } = useOpsContext();
  const [board, setBoard] = useState<BoardRow[] | null>(null);
  const [boardCustomer, setBoardCustomer] = useState("");
  const [rackOpen, setRackOpen] = useState(false);
  const [ruleOpen, setRuleOpen] = useState(false);
  const [editRule, setEditRule] = useState<PricingRule | null>(null);
  const [q, setQ] = useState({ customerId: "", productId: "", terminalId: "", deliveryLocationId: "", gallons: "" });
  const [quote, setQuote] = useState<{ ok: boolean; price?: CustomerPrice; rule?: PricingRule; message?: string } | null>(null);
  // The price board is computed server-side (rules × customers × products); reload it whenever the snapshot changes.
  useEffect(() => {
    act<BoardRow[]>("price-board", undefined, "GET").then(setBoard).catch(() => undefined);
  }, [act, version]);
  const latestRacks = useMemo(() => {
    const m = new Map<string, RackPrice>();
    for (const rp of state.rackPrices) {
      const k = `${rp.terminalId}|${rp.supplierId}|${rp.productId}`;
      const cur = m.get(k);
      if (!cur || rp.effectiveAt > cur.effectiveAt) m.set(k, rp);
    }
    return [...m.values()].sort((a, b) => a.terminalId.localeCompare(b.terminalId) || a.productId.localeCompare(b.productId));
  }, [state.rackPrices]);
  const quoteLocations = state.deliveryLocations.filter((l) => l.customerId === q.customerId);
  const runQuote = async () => {
    try {
      const r = await act<{ ok: boolean; price?: CustomerPrice; rule?: PricingRule; message?: string }>("price/quote", { customerId: q.customerId, productId: q.productId, terminalId: q.terminalId || undefined, deliveryLocationId: q.deliveryLocationId || undefined });
      setQuote(r);
    } catch { /* toast shows it */ }
  };
  return (
    <Page>
      <PageHeader title="Pricing" description="Rack prices in, customer prices out. Rules: most specific wins (location › terminal › customer), then priority." actions={<><Button size="sm" variant="outline" onClick={() => setRackOpen(true)}>Enter rack price</Button><Button size="sm" onClick={() => { setEditRule(null); setRuleOpen(true); }}>New rule</Button></>} />
      <Tabs defaultValue="board">
        <TabsList>
          <TabsTrigger value="board">Price board</TabsTrigger>
          <TabsTrigger value="rules">Rules ({state.pricingRules.length})</TabsTrigger>
          <TabsTrigger value="rack">Rack prices</TabsTrigger>
          <TabsTrigger value="quote">Quote</TabsTrigger>
        </TabsList>
        <TabsContent value="board" className="space-y-3 pt-3">
          <div className="flex items-center gap-2">
            <NativeSelect className="w-64" value={boardCustomer} onChange={(e) => setBoardCustomer(e.target.value)}>
              <option value="">All customers</option>
              {state.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </NativeSelect>
            <span className="text-xs text-muted-foreground">Auto-calculated for today from the active rules and latest rack/index values.</span>
          </div>
          <DataTable dense rows={(board ?? []).filter((r) => !boardCustomer || r.customerId === boardCustomer)} rowKey={(r) => `${r.customerId}-${r.productId}`} empty={board ? "No rules cover any customer/product pair." : "Loading…"} columns={[
            { key: "c", header: "Customer", render: (r) => r.customerName },
            { key: "p", header: "Product", render: (r) => r.productName },
            { key: "t", header: "Lift terminal", render: (r) => r.terminalName ?? "—" },
            { key: "b", header: "Basis", render: (r) => r.basisType ? titleCase(r.basisType) : "—" },
            { key: "r", header: "Rule", render: (r) => <span className="text-xs text-muted-foreground">{r.ruleName ?? r.error}</span> },
            { key: "s", header: "Sell $/gal", align: "right", render: (r) => r.sellPricePerGallon === null ? <StatusBadge label="missing" className="bg-rose-100 text-rose-800" /> : <span className="font-medium">{ppg(r.sellPricePerGallon)}</span> },
          ]} />
        </TabsContent>
        <TabsContent value="rules" className="pt-3">
          <DataTable rows={[...state.pricingRules].sort((a, b) => (a.customerId ? 0 : 1) - (b.customerId ? 0 : 1) || b.priority - a.priority)} rowKey={(r) => r.id} onRowClick={(r) => { setEditRule(r); setRuleOpen(true); }} columns={[
            { key: "n", header: "Rule", render: (r) => <span className="font-medium">{r.name}</span> },
            { key: "c", header: "Customer", render: (r) => r.customerId ? customerName(state, r.customerId) : <span className="text-muted-foreground">all</span> },
            { key: "p", header: "Product", render: (r) => productName(state, r.productId) },
            { key: "scope", header: "Scope", render: (r) => [r.terminalId ? terminalName(state, r.terminalId) : null, r.deliveryLocationId ? locationName(state, r.deliveryLocationId) : null].filter(Boolean).join(" · ") || "any" },
            { key: "b", header: "Basis", render: (r) => r.basisType === "fixed" ? `Fixed ${ppg(r.fixedPrice ?? 0)}` : r.basisType === "index" ? state.priceIndexes.find((i) => i.id === r.basisRef)?.code : `Rack${r.basisRef ? ` ${terminalName(state, r.basisRef)}` : ""}` },
            { key: "d", header: "Diff / freight / fees", align: "right", render: (r) => `${signed(r.differential)} / ${ppg(r.freightPerGallon)} / ${ppg(r.feesPerGallon)}` },
            { key: "tax", header: "Tax", render: (r) => r.taxTreatment },
            { key: "eff", header: "Effective", render: (r) => `${fmtDate(r.effectiveStart)}${r.effectiveEnd ? ` → ${fmtDate(r.effectiveEnd)}` : ""}` },
            { key: "pr", header: "Prio", align: "right", render: (r) => r.priority },
            { key: "s", header: "Status", render: (r) => <StatusBadge label={r.status} className={r.status === "active" ? "bg-emerald-100 text-emerald-800" : r.status === "draft" ? "bg-amber-100 text-amber-800" : "bg-zinc-200 text-zinc-600"} /> },
          ]} />
        </TabsContent>
        <TabsContent value="rack" className="pt-3">
          <DataTable dense rows={latestRacks} rowKey={(r) => r.id} columns={[
            { key: "t", header: "Terminal", render: (r) => terminalName(state, r.terminalId) },
            { key: "s", header: "Supplier", render: (r) => supplierName(state, r.supplierId) },
            { key: "p", header: "Product", render: (r) => productName(state, r.productId) },
            { key: "pr", header: "Rack $/gal", align: "right", render: (r) => <span className="font-medium">{ppg(r.pricePerGallon)}</span> },
            { key: "e", header: "Posted", render: (r) => fmtDateTime(r.effectiveAt) },
            { key: "src", header: "Source", render: (r) => r.source },
          ]} />
        </TabsContent>
        <TabsContent value="quote" className="pt-3">
          <div className="grid gap-4 lg:grid-cols-2">
            <SectionCard title="Quote a price">
              <form className="grid gap-3 md:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void runQuote(); }}>
                <Field label="Customer"><NativeSelect value={q.customerId} onChange={(e) => setQ({ ...q, customerId: e.target.value, deliveryLocationId: "" })} required><option value="">Select…</option>{state.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</NativeSelect></Field>
                <Field label="Product"><NativeSelect value={q.productId} onChange={(e) => setQ({ ...q, productId: e.target.value })} required><option value="">Select…</option>{state.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</NativeSelect></Field>
                <Field label="Terminal (optional)"><NativeSelect value={q.terminalId} onChange={(e) => setQ({ ...q, terminalId: e.target.value })}><option value="">Cheapest rack</option>{state.terminals.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</NativeSelect></Field>
                <Field label="Delivery location (optional)"><NativeSelect value={q.deliveryLocationId} onChange={(e) => setQ({ ...q, deliveryLocationId: e.target.value })} disabled={!q.customerId}><option value="">Any</option>{quoteLocations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</NativeSelect></Field>
                <Field label="Gallons (optional)"><Input type="number" value={q.gallons} onChange={(e) => setQ({ ...q, gallons: e.target.value })} /></Field>
                <div className="flex items-end"><Button type="submit" size="sm" disabled={!!busy}>Get price</Button></div>
              </form>
            </SectionCard>
            <SectionCard title="Result">
              {!quote ? <div className="text-sm text-muted-foreground">Pick a customer and product.</div> : quote.ok && quote.price ? (
                <div className="space-y-2 text-sm">
                  <div className="text-3xl font-semibold tabular-nums">{ppg(quote.price.sellPricePerGallon)}</div>
                  {q.gallons ? <div className="text-muted-foreground">≈ {money(Number(q.gallons) * quote.price.sellPricePerGallon)} for {Number(q.gallons).toLocaleString()} gal</div> : null}
                  <ul className="space-y-1 text-xs text-muted-foreground">{quote.price.explanation.map((l, i) => <li key={i}>• {l}</li>)}</ul>
                  <div className="text-[11px] text-muted-foreground">Snapshot {quote.price.id} saved for audit.</div>
                </div>
              ) : (
                <div className="text-sm text-[color:var(--risk-high)]">{quote.message}</div>
              )}
            </SectionCard>
          </div>
        </TabsContent>
      </Tabs>
      {rackOpen ? <RackPriceSheet open={rackOpen} onOpenChange={setRackOpen} /> : null}
      {ruleOpen ? <PricingRuleSheet open={ruleOpen} onOpenChange={setRuleOpen} rule={editRule} /> : null}
    </Page>
  );
}
