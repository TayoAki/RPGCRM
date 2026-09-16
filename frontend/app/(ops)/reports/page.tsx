"use client";
import { useMemo, useState } from "react";
import { useOpsContext } from "@/components/ops-context";
import { Page, PageHeader, DataTable, SectionCard } from "@/components/ops/primitives";
import { AreaChart, BarList } from "@/components/charts";
import { customerName, fmtDate, fmtDateTime, gal, money, ppg, productCode, signed, staffName, titleCase } from "@/lib/ops";

export default function ReportsPage() {
  const { state, setSelectedLoadId } = useOpsContext();
  const [now] = useState(() => Date.now());
  const daily = useMemo(() => {
    const days = 14;
    const out = Array.from({ length: days }, (_, i) => { const date = new Date(now - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10); return { date, gallons: 0, gp: 0 }; });
    for (const l of state.loads) {
      if (!["delivered", "closed"].includes(l.status)) continue;
      const at = (state.deliveries.find((d) => d.loadId === l.id)?.deliveredAt ?? l.scheduledDeliveryAt).slice(0, 10);
      const p = out.find((x) => x.date === at);
      if (!p) continue;
      const m = state.loadMargins.find((x) => x.loadId === l.id);
      p.gallons += m?.gallons ?? l.plannedGallons;
      p.gp += m?.actualGrossProfit ?? 0;
    }
    return out;
  }, [now, state.loads, state.deliveries, state.loadMargins]);
  const byCustomer = useMemo(() => {
    const m = new Map<string, { name: string; loads: number; gallons: number; revenue: number; gp: number }>();
    for (const x of state.loadMargins) {
      if (x.actualGrossProfit === null) continue;
      const r = m.get(x.customerId) ?? { name: customerName(state, x.customerId), loads: 0, gallons: 0, revenue: 0, gp: 0 };
      r.loads++; r.gallons += x.gallons; r.revenue += x.revenue; r.gp += x.actualGrossProfit;
      m.set(x.customerId, r);
    }
    return [...m.entries()].map(([id, r]) => ({ id, ...r })).sort((a, b) => b.gp - a.gp);
  }, [state]);
  const margins = [...state.loadMargins].map((m) => ({ ...m, load: state.loads.find((l) => l.id === m.loadId) })).filter((m) => m.load).sort((a, b) => (a.profitPerGallon ?? 99) - (b.profitPerGallon ?? 99));
  return (
    <Page>
      <PageHeader title="Reports" description="Profitability by load and customer, delivered volume, integration runs, and the audit trail." />
      <div className="grid gap-4 @2xl:grid-cols-2">
        <SectionCard title="Delivered gallons, 14 days"><AreaChart data={daily.map((d) => ({ label: fmtDate(d.date), value: d.gallons }))} height={180} /></SectionCard>
        <SectionCard title="Gross profit by customer (delivered loads)">
          {byCustomer.length ? <BarList data={byCustomer.map((r) => ({ label: r.name, value: r.gp, secondary: `${r.loads} loads · ${gal(r.gallons)} · ${r.gallons ? ppg(r.gp / r.gallons) : "—"}` }))} format={(v) => money(v, 0)} /> : <div className="text-sm text-muted-foreground">No delivered loads yet.</div>}
        </SectionCard>
      </div>
      <SectionCard title="Load margins: expected vs actual">
        <DataTable dense rows={margins} rowKey={(m) => m.loadId} onRowClick={(m) => setSelectedLoadId(m.loadId)} columns={[
          { key: "l", header: "Load", render: (m) => <span className="font-medium">{m.load!.loadNumber}</span> },
          { key: "c", header: "Customer", render: (m) => customerName(state, m.customerId) },
          { key: "p", header: "Product", render: (m) => productCode(state, m.productId) },
          { key: "s", header: "Status", render: (m) => titleCase(m.load!.status) },
          { key: "g", header: "Gallons", align: "right", render: (m) => gal(m.gallons) },
          { key: "rev", header: "Revenue", align: "right", render: (m) => money(m.revenue) },
          { key: "cost", header: "Supplier cost", align: "right", render: (m) => money(m.supplierCost) },
          { key: "fr", header: "Freight", align: "right", render: (m) => money(m.freightCost) },
          { key: "e", header: "Expected GP", align: "right", render: (m) => money(m.expectedGrossProfit) },
          { key: "a", header: "Actual GP", align: "right", render: (m) => m.actualGrossProfit === null ? <span className="text-muted-foreground">pending</span> : money(m.actualGrossProfit) },
          { key: "ppg", header: "GP / gal", align: "right", render: (m) => m.profitPerGallon === null ? "—" : <span className={m.profitPerGallon < 0 ? "text-[color:var(--risk-high)]" : m.profitPerGallon < 0.04 ? "text-[color:var(--risk-medium)]" : ""}>{ppg(m.profitPerGallon)}</span> },
          { key: "v", header: "Variance", align: "right", render: (m) => m.variance === null ? "—" : <span className={m.variance < 0 ? "text-[color:var(--risk-high)]" : "text-[color:var(--risk-low)]"}>{signed(m.variance, 2)}</span> },
        ]} />
      </SectionCard>
      <div className="grid gap-4 @2xl:grid-cols-2">
        <SectionCard title="Integration runs">
          <DataTable dense rows={[...state.integrationRuns].reverse().slice(0, 20)} rowKey={(r) => r.id} columns={[
            { key: "k", header: "Integration", render: (r) => titleCase(r.kind) },
            { key: "t", header: "When", render: (r) => fmtDateTime(r.finishedAt) },
            { key: "s", header: "Status", render: (r) => r.status },
            { key: "n", header: "In / out", align: "right", render: (r) => `${r.recordsIn} / ${r.recordsOut}` },
            { key: "sum", header: "Summary", render: (r) => <span className="text-muted-foreground">{r.summary}</span> },
          ]} />
        </SectionCard>
        <SectionCard title="Audit trail">
          <DataTable dense rows={[...state.auditLog].reverse().slice(0, 40)} rowKey={(a) => a.id} columns={[
            { key: "t", header: "When", render: (a) => fmtDateTime(a.occurredAt) },
            { key: "who", header: "Who", render: (a) => staffName(state, a.actorId) },
            { key: "act", header: "Action", render: (a) => a.action },
            { key: "d", header: "Detail", render: (a) => <span className="text-muted-foreground">{a.detail}</span> },
          ]} />
        </SectionCard>
      </div>
    </Page>
  );
}
