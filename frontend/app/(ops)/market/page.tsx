"use client";
import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";
import { useOpsContext } from "@/components/ops-context";
import { Page, PageHeader, SectionCard, DataTable, StatusBadge } from "@/components/ops/primitives";
import { AreaChart } from "@/components/charts";
import { Button } from "@/components/ui/button";
import { fmtDate, ppg, signed } from "@/lib/ops";

function Dir({ d, className = "h-5 w-5" }: { d: string; className?: string }) {
  if (d === "up") return <ArrowUpRight className={`${className} text-[color:var(--risk-high)]`} />;
  if (d === "down") return <ArrowDownRight className={`${className} text-[color:var(--risk-low)]`} />;
  return <ArrowRight className={`${className} text-muted-foreground`} />;
}

export default function MarketPage() {
  const { state, act, busy } = useOpsContext();
  return (
    <Page>
      <PageHeader title="Fuel market tracker" description="Benchmarks and rack averages with a next-day direction estimate. The forecast is a simple momentum model; its backtested hit rate is shown so you can weigh it." actions={<Button size="sm" disabled={!!busy} onClick={() => act("market/refresh").catch(() => undefined)}>Refresh market feed</Button>} />
      <div className="grid gap-4 xl:grid-cols-2">
        {state.priceIndexes.map((idx) => {
          const hist = state.indexPrices.filter((p) => p.indexId === idx.id).sort((a, b) => a.date.localeCompare(b.date));
          const latest = hist[hist.length - 1];
          const weekAgo = hist[hist.length - 8];
          const forecasts = state.forecasts.filter((f) => f.indexId === idx.id).sort((a, b) => b.targetDate.localeCompare(a.targetDate));
          const next = forecasts[0];
          const scored = forecasts.filter((f) => f.realizedDirection);
          const hits = scored.filter((f) => f.realizedDirection === f.direction).length;
          return (
            <SectionCard key={idx.id} title={`${idx.code} · ${idx.name}`} action={latest ? <span className="text-xs text-muted-foreground">{idx.source} · {fmtDate(latest.date)}</span> : null}>
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <div className="text-3xl font-semibold tabular-nums">{latest ? ppg(latest.value) : "—"}</div>
                  <div className="text-xs text-muted-foreground">day {latest ? <span className={latest.change > 0 ? "text-[color:var(--risk-high)]" : latest.change < 0 ? "text-[color:var(--risk-low)]" : ""}>{signed(latest.change)}</span> : "—"} · 7d {latest && weekAgo ? signed(latest.value - weekAgo.value) : "—"}</div>
                </div>
                {next ? (
                  <div className="rounded-lg border border-border px-3 py-2 text-sm">
                    <div className="flex items-center gap-2"><Dir d={next.direction} /><span className="font-medium capitalize">{next.direction}</span><span className="text-xs text-muted-foreground">for {fmtDate(next.targetDate)} · {Math.round(next.confidence * 100)}% confidence</span></div>
                    <div className="mt-1 max-w-xs text-xs text-muted-foreground">{next.rationale}</div>
                    <div className="mt-1 text-[11px] text-muted-foreground">Hit rate {scored.length ? `${Math.round((hits / scored.length) * 100)}% over ${scored.length} scored days` : "not yet scored"}</div>
                  </div>
                ) : null}
              </div>
              <AreaChart data={hist.slice(-30).map((p) => ({ label: fmtDate(p.date), value: p.value }))} height={160} />
            </SectionCard>
          );
        })}
      </div>
      <SectionCard title="Forecast history">
        <DataTable dense rows={[...state.forecasts].filter((f) => f.realizedDirection).sort((a, b) => b.targetDate.localeCompare(a.targetDate)).slice(0, 24)} rowKey={(f) => f.id} columns={[
          { key: "d", header: "Target", render: (f) => fmtDate(f.targetDate) },
          { key: "i", header: "Index", render: (f) => state.priceIndexes.find((i) => i.id === f.indexId)?.code },
          { key: "f", header: "Forecast", render: (f) => <span className="flex items-center gap-1 capitalize"><Dir d={f.direction} className="h-4 w-4" />{f.direction} ({Math.round(f.confidence * 100)}%)</span> },
          { key: "r", header: "Realized", render: (f) => <span className="flex items-center gap-1 capitalize"><Dir d={f.realizedDirection ?? "flat"} className="h-4 w-4" />{f.realizedDirection}</span> },
          { key: "h", header: "Hit", render: (f) => <StatusBadge label={f.realizedDirection === f.direction ? "hit" : "miss"} className={f.realizedDirection === f.direction ? "bg-emerald-100 text-emerald-800" : "bg-zinc-200 text-zinc-600"} /> },
        ]} />
      </SectionCard>
    </Page>
  );
}
