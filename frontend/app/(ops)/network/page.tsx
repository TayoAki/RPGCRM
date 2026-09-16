"use client";
import { useOpsContext } from "@/components/ops-context";
import { Page, PageHeader, DataTable, SectionCard } from "@/components/ops/primitives";
import { money, ppg, supplierName, terminalName } from "@/lib/ops";

export default function NetworkPage() {
  const { state } = useOpsContext();
  return (
    <Page>
      <PageHeader title="Suppliers, terminals & carriers" description="Reference data the pricing engine, BOL matching, and freight costs depend on. Config-driven so new partners are rows, not code." />
      <div className="grid gap-4 @2xl:grid-cols-2">
        <SectionCard title="Suppliers">
          <DataTable dense rows={state.suppliers} rowKey={(s) => s.id} columns={[
            { key: "n", header: "Supplier", render: (s) => <span className="font-medium">{s.name}</span> },
            { key: "c", header: "Code", render: (s) => s.code },
            { key: "b", header: "BOL source", render: (s) => s.bolSource },
            { key: "t", header: "Terminals", render: (s) => state.terminals.filter((t) => t.supplierIds.includes(s.id)).map((t) => t.code).join(", ") },
          ]} />
        </SectionCard>
        <SectionCard title="Terminals">
          <DataTable dense rows={state.terminals} rowKey={(t) => t.id} columns={[
            { key: "n", header: "Terminal", render: (t) => <span className="font-medium">{t.name}</span> },
            { key: "c", header: "Code", render: (t) => t.code },
            { key: "l", header: "Location", render: (t) => `${t.city}, ${t.state}` },
            { key: "s", header: "Suppliers", render: (t) => t.supplierIds.map((id) => supplierName(state, id)).join(", ") },
          ]} />
        </SectionCard>
        <SectionCard title="Carriers">
          <DataTable dense rows={state.carriers} rowKey={(c) => c.id} columns={[
            { key: "n", header: "Carrier", render: (c) => <span className="font-medium">{c.name}</span> },
            { key: "c", header: "Code", render: (c) => c.code },
            { key: "r", header: "Default rate", align: "right", render: (c) => ppg(c.defaultRatePerGallon) },
            { key: "l", header: "Loads (all time)", align: "right", render: (c) => state.loads.filter((l) => l.carrierId === c.id).length },
          ]} />
        </SectionCard>
        <SectionCard title="Carrier lane rates">
          <DataTable dense rows={state.carrierRates} rowKey={(r) => r.id} columns={[
            { key: "c", header: "Carrier", render: (r) => state.carriers.find((c) => c.id === r.carrierId)?.name },
            { key: "t", header: "From terminal", render: (r) => terminalName(state, r.terminalId) },
            { key: "d", header: "To", render: (r) => r.destinationState },
            { key: "r", header: "Rate", align: "right", render: (r) => ppg(r.ratePerGallon) },
            { key: "m", header: "Minimum", align: "right", render: (r) => money(r.minimumCharge, 0) },
          ]} />
        </SectionCard>
        <SectionCard title="Products & tax categories" className="@2xl:col-span-2">
          <DataTable dense rows={state.products} rowKey={(p) => p.id} columns={[
            { key: "n", header: "Product", render: (p) => <span className="font-medium">{p.name}</span> },
            { key: "c", header: "Code", render: (p) => p.code },
            { key: "cat", header: "Category", render: (p) => p.category },
            { key: "tax", header: "Tax category", render: (p) => p.taxCategory },
            { key: "rates", header: "TX taxes $/gal", align: "right", render: (p) => ppg(state.taxRates.filter((t) => t.state === "TX" && t.taxCategory === p.taxCategory).reduce((s, t) => s + t.ratePerGallon, 0)) },
          ]} />
        </SectionCard>
      </div>
    </Page>
  );
}
