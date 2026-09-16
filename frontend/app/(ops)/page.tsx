"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";
import { useOpsContext } from "@/components/ops-context";
import { Page, PageHeader, SectionCard, Stat, StatusBadge, DataTable, Empty } from "@/components/ops/primitives";
import { AreaChart, BarList } from "@/components/charts";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtDate, fmtDateTime, gal, money, ppg, relativeTime, SEVERITY_STYLE, signed, titleCase } from "@/lib/ops";

interface Dashboard {
  metrics: {
    gallonsDeliveredToday: number; gallonsDelivered7d: number; revenue7d: number; revenueMtd: number; expectedGrossProfit7d: number; actualGrossProfit7d: number; profitPerGallon7d: number | null;
    ordersInProgress: number; ordersAwaitingReview: number; loadsDeliveredToday: number; loadsAwaitingBilling: number; invoicesPendingApproval: number;
    openExceptions: { critical: number; warning: number; info: number };
    marketMovement: { indexId: string; code: string; name: string; value: number; change: number; date: string }[];
    forecasts: { indexId: string; code: string; direction: string; confidence: number; targetDate: string }[];
  };
  profitability: { customerId: string; name: string; loads: number; gallons: number; revenue: number; grossProfit: number; profitPerGallon: number | null }[];
  daily: { date: string; gallons: number; grossProfit: number; loads: number }[];
  priceBoard: { customerId: string; customerName: string; productId: string; productName: string; terminalName: string | null; sellPricePerGallon: number | null; error: string | null }[];
  triage: { priorities: { id: string; rank: number; severity: "critical" | "warning" | "info"; type: string; message: string; nextStep: string; moneyAtRisk: number }[]; totalOpen: number };
}

function Dir({ d }: { d: string }) {
  if (d === "up") return <ArrowUpRight className="h-4 w-4 text-[color:var(--risk-high)]" aria-label="up" />;
  if (d === "down") return <ArrowDownRight className="h-4 w-4 text-[color:var(--risk-low)]" aria-label="down" />;
  return <ArrowRight className="h-4 w-4 text-muted-foreground" aria-label="flat" />;
}

export default function DashboardPage() {
  const { state, version, act, busy, loading } = useOpsContext();
  const [data, setData] = useState<Dashboard | null>(null);
  useEffect(() => {
    let alive = true;
    act<Dashboard>("dashboard", undefined, "GET").then((d) => { if (alive) setData(d); }).catch(() => undefined);
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);
  const runs = ["email_intake", "bol_feed", "index_feed", "quickbooks_invoices", "quickbooks_payments", "forecast"].map((kind) => ({
    kind,
    last: [...state.integrationRuns].reverse().find((r) => r.kind === kind),
  }));
  if (loading || !data) {
    return <Page><div className="grid gap-4 md:grid-cols-5">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div></Page>;
  }
  const m = data.metrics;
  const exc = m.openExceptions.critical + m.openExceptions.warning + m.openExceptions.info;
  return (
    <Page>
      <PageHeader title="Management dashboard" description={`As of ${fmtDateTime(new Date().toISOString())} · ${state.customers.length} customers · ${state.orders.length} orders`} />
      <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-5">
        <Stat label="Gallons delivered today" value={gal(m.gallonsDeliveredToday)} sub={`${m.loadsDeliveredToday} load(s)`} />
        <Stat label="Gallons, trailing 7 days" value={gal(m.gallonsDelivered7d)} />
        <Stat label="Revenue, 7 days" value={money(m.revenue7d)} sub={`MTD ${money(m.revenueMtd)} (excl. taxes)`} />
        <Stat label="Actual gross profit, 7 days" value={money(m.actualGrossProfit7d)} sub={`expected ${money(m.expectedGrossProfit7d)}`} tone={m.actualGrossProfit7d >= m.expectedGrossProfit7d ? "good" : "warn"} />
        <Stat label="Profit per gallon, 7 days" value={m.profitPerGallon7d === null ? "—" : ppg(m.profitPerGallon7d)} />
      </div>
      <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-5">
        <Stat label="Orders in progress" value={String(m.ordersInProgress)} />
        <Stat label="Emails awaiting review" value={String(m.ordersAwaitingReview)} tone={m.ordersAwaitingReview ? "warn" : undefined} />
        <Stat label="Loads awaiting billing" value={String(m.loadsAwaitingBilling)} />
        <Stat label="Invoices pending approval" value={String(m.invoicesPendingApproval)} tone={m.invoicesPendingApproval ? "warn" : undefined} />
        <Stat label="Open exceptions" value={String(exc)} sub={`${m.openExceptions.critical} critical · ${m.openExceptions.warning} warning`} tone={m.openExceptions.critical ? "bad" : exc ? "warn" : "good"} />
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <SectionCard title="Gallons delivered, last 14 days" className="xl:col-span-2">
          <AreaChart data={data.daily.map((d) => ({ label: fmtDate(d.date), value: d.gallons }))} height={200} />
        </SectionCard>
        <SectionCard title="Market" action={<Link href="/market" className="text-xs text-primary hover:underline">Open</Link>}>
          <div className="space-y-2 text-sm">
            {m.marketMovement.map((x) => {
              const f = m.forecasts.find((y) => y.indexId === x.indexId);
              return (
                <div key={x.indexId} className="flex items-center justify-between gap-2">
                  <div className="min-w-0"><div className="truncate font-medium">{x.code}</div><div className="truncate text-xs text-muted-foreground">{x.name}</div></div>
                  <div className="text-right tabular-nums"><div>{ppg(x.value)}</div><div className={`text-xs ${x.change > 0 ? "text-[color:var(--risk-high)]" : x.change < 0 ? "text-[color:var(--risk-low)]" : "text-muted-foreground"}`}>{signed(x.change)}</div></div>
                  <div className="flex w-16 items-center justify-end gap-1 text-xs text-muted-foreground" title={f ? `Forecast for ${f.targetDate}` : ""}>{f ? <><Dir d={f.direction} />{Math.round(f.confidence * 100)}%</> : null}</div>
                </div>
              );
            })}
          </div>
        </SectionCard>
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <SectionCard title={`Needs attention (${data.triage.totalOpen})`} action={<Link href="/exceptions" className="text-xs text-primary hover:underline">All exceptions</Link>}>
          {data.triage.priorities.length === 0 ? <Empty>No open exceptions.</Empty> : (
            <ol className="space-y-2">
              {data.triage.priorities.map((p) => (
                <li key={p.id} className="rounded-lg border border-border p-2 text-sm">
                  <div className="flex items-center gap-2"><StatusBadge label={p.severity} className={SEVERITY_STYLE[p.severity]} /><span className="text-xs text-muted-foreground">{titleCase(p.type)}</span>{p.moneyAtRisk ? <span className="ml-auto text-xs tabular-nums text-muted-foreground">{money(p.moneyAtRisk, 0)}</span> : null}</div>
                  <div className="mt-1">{p.message}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">Next: {p.nextStep}</div>
                </li>
              ))}
            </ol>
          )}
        </SectionCard>
        <SectionCard title="Customer profitability, 30 days" action={<Link href="/reports" className="text-xs text-primary hover:underline">Reports</Link>}>
          {data.profitability.length === 0 ? <Empty>No delivered loads yet.</Empty> : (
            <BarList data={data.profitability.slice(0, 6).map((r) => ({ label: r.name, value: r.grossProfit, secondary: r.profitPerGallon === null ? undefined : `${ppg(r.profitPerGallon)} · ${gal(r.gallons)}` }))} format={(v) => money(v, 0)} />
          )}
        </SectionCard>
        <SectionCard title="Today's prices" action={<Link href="/pricing" className="text-xs text-primary hover:underline">Price board</Link>}>
          <DataTable
            dense
            columns={[
              { key: "c", header: "Customer", render: (r) => <span className="truncate">{r.customerName}</span> },
              { key: "p", header: "Product", render: (r) => r.productName.replace(/ \(.*\)$/, "") },
              { key: "s", header: "$/gal", align: "right", render: (r) => r.sellPricePerGallon === null ? <span className="text-[color:var(--risk-high)]" title={r.error ?? ""}>missing</span> : ppg(r.sellPricePerGallon) },
            ]}
            rows={data.priceBoard.filter((r) => r.sellPricePerGallon !== null).slice(0, 8)}
            rowKey={(r) => `${r.customerId}-${r.productId}`}
          />
        </SectionCard>
      </div>
      <SectionCard title="Integrations (sample feeds)" action={<span className="text-xs text-muted-foreground">Each button runs the integration against its sample file</span>}>
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          {runs.map(({ kind, last }) => (
            <div key={kind} className="rounded-lg border border-border p-3 text-sm">
              <div className="font-medium">{titleCase(kind)}</div>
              <div className="mt-1 text-xs text-muted-foreground">{last ? `${relativeTime(last.finishedAt)} · ${last.summary}` : "Never run"}</div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={!!busy} onClick={() => act("intake/run").catch(() => undefined)}>Run email intake</Button>
          <Button size="sm" variant="outline" disabled={!!busy} onClick={() => act("bols/pull").catch(() => undefined)}>Pull BOL feed</Button>
          <Button size="sm" variant="outline" disabled={!!busy} onClick={() => act("market/refresh").catch(() => undefined)}>Refresh market feed</Button>
          <Button size="sm" variant="outline" disabled={!!busy} onClick={() => act("quickbooks/sync-invoices").then(() => act("quickbooks/sync-payments")).catch(() => undefined)}>Sync QuickBooks</Button>
        </div>
      </SectionCard>
    </Page>
  );
}
