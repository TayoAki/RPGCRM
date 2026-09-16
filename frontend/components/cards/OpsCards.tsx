"use client";
import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";
import { CardShell, Row, MiniTable, Action, money, ppg, gal, titleCase } from "./shared";
import { cn } from "@/lib/utils";

const SEV: Record<string, string> = { critical: "bg-rose-100 text-rose-800", warning: "bg-amber-100 text-amber-800", info: "bg-sky-100 text-sky-800" };
const Badge = ({ label, className }: { label: string; className?: string }) => <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", className ?? "bg-secondary")}>{label}</span>;

// ---- quote_price -------------------------------------------------------------------
export interface QuoteResult { ok: boolean; message?: string; customerName: string; productName: string; terminalName?: string; locationName?: string | null; priceDate?: string; ruleName?: string; basisType?: string; basisValue?: number; differential?: number; freight?: number; fees?: number; taxesPerGallon?: number; sellPricePerGallon?: number; gallons?: number | null; estimatedTotal?: number | null; explanation?: string[] }
export function PriceQuoteCard({ r, status, onOpenPricing }: { r?: QuoteResult; status: string; onOpenPricing: () => void }) {
  if (status === "complete" && r && !r.ok) return <CardShell title="Could not price" status={status} tone="error"><div>{r.message}</div></CardShell>;
  return (
    <CardShell title="Price quote" status={status} pendingLabel="Pricing…" actions={<Action onClick={onOpenPricing}>Open pricing</Action>}>
      {r ? (
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between"><span className="font-medium">{r.customerName} · {r.productName}</span><span className="text-2xl font-semibold tabular-nums">{ppg(r.sellPricePerGallon)}</span></div>
          <div className="text-xs text-muted-foreground">{r.terminalName}{r.locationName ? ` → ${r.locationName}` : ""} · {r.priceDate} · {r.ruleName}</div>
          {r.gallons ? <Row label={`${r.gallons.toLocaleString()} gal`} value={<span className="font-medium">{money(r.estimatedTotal)}</span>} /> : null}
          <MiniTable headers={["Component", "$/gal"]} rows={[["Basis (" + titleCase(r.basisType ?? "") + ")", ppg(r.basisValue)], ["Differential", ppg(r.differential)], ["Freight", ppg(r.freight)], ["Fees", ppg(r.fees)], ["Taxes", ppg(r.taxesPerGallon)]]} />
        </div>
      ) : null}
    </CardShell>
  );
}

// ---- daily_brief --------------------------------------------------------------------
export interface BriefResult { metrics: { gallonsDeliveredToday: number; gallonsDelivered7d: number; revenue7d: number; expectedGrossProfit7d: number; actualGrossProfit7d: number; profitPerGallon7d: number | null; ordersInProgress: number; ordersAwaitingReview: number; loadsAwaitingBilling: number; invoicesPendingApproval: number; openExceptions: { critical: number; warning: number; info: number }; marketMovement: { code: string; value: number; change: number }[] }; topExceptions: { id: string; severity: string; message: string; nextStep: string }[]; totalOpenExceptions: number }
export function DailyBriefCard({ r, status, onOpen }: { r?: BriefResult; status: string; onOpen: (page: string) => void }) {
  return (
    <CardShell title="Daily brief" status={status} pendingLabel="Pulling the numbers…" actions={<><Action onClick={() => onOpen("dashboard")}>Dashboard</Action><Action onClick={() => onOpen("exceptions")}>Exceptions</Action></>}>
      {r ? (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            <Row label="Gallons today" value={gal(r.metrics.gallonsDeliveredToday)} />
            <Row label="Gallons 7d" value={gal(r.metrics.gallonsDelivered7d)} />
            <Row label="Revenue 7d" value={money(r.metrics.revenue7d)} />
            <Row label="GP 7d (exp.)" value={`${money(r.metrics.actualGrossProfit7d)} (${money(r.metrics.expectedGrossProfit7d)})`} />
            <Row label="GP / gal" value={ppg(r.metrics.profitPerGallon7d)} />
            <Row label="Orders open" value={String(r.metrics.ordersInProgress)} />
            <Row label="Emails to review" value={String(r.metrics.ordersAwaitingReview)} />
            <Row label="Loads to bill" value={String(r.metrics.loadsAwaitingBilling)} />
            <Row label="Invoices to approve" value={String(r.metrics.invoicesPendingApproval)} />
            <Row label="Exceptions" value={`${r.totalOpenExceptions} (${r.metrics.openExceptions.critical} critical)`} />
          </div>
          <div className="text-xs text-muted-foreground">Market: {r.metrics.marketMovement.map((m) => `${m.code} ${ppg(m.value)} (${m.change >= 0 ? "+" : ""}${m.change.toFixed(4)})`).join(" · ")}</div>
          {r.topExceptions.length ? <ul className="space-y-1">{r.topExceptions.map((e) => <li key={e.id} className="text-xs"><Badge label={e.severity} className={SEV[e.severity]} /> {e.message}</li>)}</ul> : null}
        </div>
      ) : null}
    </CardShell>
  );
}

// ---- market_update / refresh_market_feed ---------------------------------------------
export interface MarketResult { indexes: { code: string; name: string; latest: number | null; change: number | null; sevenDayChange: number | null; forecast: { direction: string; confidence: number; targetDate: string } | null; hitRate: number | null }[]; feed?: string; forecast?: string }
const Dir = ({ d }: { d: string }) => d === "up" ? <ArrowUpRight className="inline h-3.5 w-3.5 text-[color:var(--risk-high)]" /> : d === "down" ? <ArrowDownRight className="inline h-3.5 w-3.5 text-[color:var(--risk-low)]" /> : <ArrowRight className="inline h-3.5 w-3.5 text-muted-foreground" />;
export function MarketCard({ r, status, onOpen }: { r?: MarketResult; status: string; onOpen: () => void }) {
  return (
    <CardShell title="Market update" status={status} pendingLabel="Reading the tape…" actions={<Action onClick={onOpen}>Open market</Action>}>
      {r ? (
        <div className="space-y-1">
          {r.feed ? <div className="text-xs text-muted-foreground">{r.feed} · {r.forecast}</div> : null}
          <MiniTable headers={["Index", "Latest", "Day", "7d", "Tomorrow"]} rows={r.indexes.map((i) => [i.code, ppg(i.latest), i.change === null ? "—" : `${i.change >= 0 ? "+" : ""}${i.change.toFixed(4)}`, i.sevenDayChange === null ? "—" : `${i.sevenDayChange >= 0 ? "+" : ""}${i.sevenDayChange.toFixed(4)}`, i.forecast ? <span key="f"><Dir d={i.forecast.direction} /> {Math.round(i.forecast.confidence * 100)}%{i.hitRate !== null ? ` (hit ${Math.round(i.hitRate * 100)}%)` : ""}</span> : "—"])} />
        </div>
      ) : null}
    </CardShell>
  );
}

// ---- triage_exceptions ----------------------------------------------------------------
export interface TriageResult { priorities: { id: string; rank: number; severity: string; type: string; message: string; nextStep: string; moneyAtRisk: number; entityType: string; entityId: string }[]; totalOpen: number }
export function ExceptionsCard({ r, status, onOpen, onAsk }: { r?: TriageResult; status: string; onOpen: () => void; onAsk: (m: string) => void }) {
  return (
    <CardShell title={`Needs attention${r ? ` · ${r.totalOpen} open` : ""}`} status={status} pendingLabel="Checking the checkpoints…" actions={<Action onClick={onOpen}>Open exceptions</Action>}>
      {r ? (
        <ol className="space-y-2">
          {r.priorities.map((p) => (
            <li key={p.id} className="rounded-lg border border-border p-2">
              <div className="flex items-center gap-2 text-xs"><span className="text-muted-foreground">#{p.rank}</span><Badge label={p.severity} className={SEV[p.severity]} /><span className="text-muted-foreground">{titleCase(p.type)}</span>{p.moneyAtRisk ? <span className="ml-auto tabular-nums text-muted-foreground">{money(p.moneyAtRisk, 0)}</span> : null}</div>
              <div className="mt-1 text-sm">{p.message}</div>
              <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground"><span>Next: {p.nextStep}</span><button type="button" className="shrink-0 text-primary hover:underline" onClick={() => onAsk(`Resolve exception ${p.id}: what was done is that I handled it. Ask me for the note if needed.`)}>Resolve…</button></div>
            </li>
          ))}
          {r.priorities.length === 0 ? <li className="text-muted-foreground">Nothing open.</li> : null}
        </ol>
      ) : null}
    </CardShell>
  );
}

// ---- margin_report ---------------------------------------------------------------------
export interface MarginResult { days: number; customerName: string | null; totals: { gallons: number; expected: number; actual: number; profitPerGallon: number | null }; loads: { loadId: string; loadNumber: string; customerName: string; productName: string; gallons: number; expectedGrossProfit: number; actualGrossProfit: number | null; profitPerGallon: number | null; variance: number | null; status: string }[]; customers: { customerId: string; name: string; loads: number; gallons: number; grossProfit: number; profitPerGallon: number | null }[] }
export function MarginCard({ r, status, onOpen, onOpenLoad }: { r?: MarginResult; status: string; onOpen: () => void; onOpenLoad: (id: string) => void }) {
  return (
    <CardShell title={`Margin, last ${r?.days ?? 30} days${r?.customerName ? ` · ${r.customerName}` : ""}`} status={status} pendingLabel="Computing margins…" actions={<Action onClick={onOpen}>Open reports</Action>}>
      {r ? (
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div><div className="text-xs text-muted-foreground">Actual GP</div><div className="text-lg font-semibold tabular-nums">{money(r.totals.actual)}</div></div>
            <div><div className="text-xs text-muted-foreground">Expected</div><div className="text-lg font-semibold tabular-nums">{money(r.totals.expected)}</div></div>
            <div><div className="text-xs text-muted-foreground">GP / gal</div><div className="text-lg font-semibold tabular-nums">{ppg(r.totals.profitPerGallon)}</div></div>
          </div>
          <MiniTable headers={["Load", "Gallons", "Actual GP", "GP/gal", "Var."]} rows={r.loads.slice(0, 8).map((l) => [<button key="b" type="button" className="text-primary hover:underline" onClick={() => onOpenLoad(l.loadId)}>{l.loadNumber} · {l.customerName}</button>, gal(l.gallons), l.actualGrossProfit === null ? "pending" : money(l.actualGrossProfit), l.profitPerGallon === null ? "—" : <span key="p" className={l.profitPerGallon < 0 ? "text-[color:var(--risk-high)]" : l.profitPerGallon < 0.04 ? "text-[color:var(--risk-medium)]" : ""}>{ppg(l.profitPerGallon)}</span>, l.variance === null ? "—" : money(l.variance)])} />
        </div>
      ) : null}
    </CardShell>
  );
}

// ---- customer_summary --------------------------------------------------------------------
export interface CustomerResult { customer: { id: string; name: string; code: string; industry: string; paymentTermsDays: number; creditLimit: number; billingBasis: string; taxExempt: boolean; status: string; notes?: string }; locations: { id: string; name: string; city: string }[]; contacts: { id: string; name: string; title: string; email: string }[]; openOrders: { id: string; orderNumber: string; productName?: string; requestedGallons: number; requestedDate: string; status: string }[]; outstandingInvoices: { invoiceNumber: string; total: number; dueDate: string; status: string }[]; outstandingTotal: number; profitability: { gallons: number; grossProfit: number; profitPerGallon: number | null } | null; prices: { productName: string; sellPricePerGallon: number | null }[] }
export function CustomerCard({ r, status, onOpen, onOpenOrder }: { r?: CustomerResult; status: string; onOpen: () => void; onOpenOrder: (id: string) => void }) {
  return (
    <CardShell title={r ? `${r.customer.name} (${r.customer.code})` : "Customer"} status={status} pendingLabel="Looking up the account…" actions={<Action onClick={onOpen}>Open customers</Action>}>
      {r ? (
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground">{r.customer.industry} · net {r.customer.paymentTermsDays} · credit {money(r.customer.creditLimit, 0)} · {r.customer.billingBasis} gallons · {r.customer.taxExempt ? "tax exempt" : "taxable"} · <span className={r.customer.status === "on_hold" ? "text-[color:var(--risk-high)]" : ""}>{titleCase(r.customer.status)}</span></div>
          {r.customer.notes ? <div className="rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-900">{r.customer.notes}</div> : null}
          <Row label="Outstanding" value={`${money(r.outstandingTotal)} (${r.outstandingInvoices.length})`} />
          {r.profitability ? <Row label="30-day GP" value={`${money(r.profitability.grossProfit)} · ${ppg(r.profitability.profitPerGallon)}`} /> : null}
          {r.prices.length ? <div className="text-xs text-muted-foreground">Today: {r.prices.map((p) => `${p.productName.replace(/ \(.*\)$/, "")} ${p.sellPricePerGallon === null ? "n/a" : ppg(p.sellPricePerGallon)}`).join(" · ")}</div> : null}
          {r.openOrders.length ? <MiniTable headers={["Open order", "Gallons", "Date", "Status"]} rows={r.openOrders.map((o) => [<button key="b" type="button" className="text-primary hover:underline" onClick={() => onOpenOrder(o.id)}>{o.orderNumber} · {o.productName}</button>, gal(o.requestedGallons), o.requestedDate, titleCase(o.status)])} /> : <div className="text-xs text-muted-foreground">No open orders.</div>}
          <div className="text-xs text-muted-foreground">Contacts: {r.contacts.map((c) => `${c.name} (${c.title})`).join(", ")}</div>
        </div>
      ) : null}
    </CardShell>
  );
}

// ---- run_email_intake / list_intake_queue ------------------------------------------------
export interface IntakeResult { summary?: string; queued?: IntakeItem[]; pending?: IntakeItem[] }
interface IntakeItem { id: string; from: string; subject: string; confidence: number; issues: string[]; reviewStatus: string; attachments?: { filename: string; status: string; drafts: number }[]; parsed: { customerName?: string; deliveryLocationName?: string; productName?: string; gallons?: number; requestedDate?: string; customerPo?: string; source?: { attachment: string; row?: number } } }
export function IntakeQueueCard({ r, status, onOpen, onAsk }: { r?: IntakeResult; status: string; onOpen: () => void; onAsk: (m: string) => void }) {
  const items = r?.queued ?? r?.pending ?? [];
  return (
    <CardShell title={r?.summary ? "Email intake" : "Intake queue"} status={status} pendingLabel="Reading the inbox…" actions={<Action onClick={onOpen}>Review in workspace</Action>}>
      {r ? (
        <div className="space-y-2">
          {r.summary ? <div className="text-xs text-muted-foreground">{r.summary}</div> : null}
          {items.length === 0 ? <div className="text-muted-foreground">Nothing waiting for review.</div> : items.map((i) => (
            <div key={i.id} className="rounded-lg border border-border p-2">
              <div className="flex items-center justify-between gap-2 text-xs"><span className="font-medium">{i.id} · {i.parsed.customerName ?? "unknown customer"}</span><span className="tabular-nums text-muted-foreground">{Math.round(i.confidence * 100)}%</span></div>
              <div className="text-xs text-muted-foreground">{i.parsed.gallons?.toLocaleString() ?? "?"} gal {i.parsed.productName ?? "?"} → {i.parsed.deliveryLocationName ?? "?"} on {i.parsed.requestedDate ?? "?"}{i.parsed.customerPo ? ` · PO ${i.parsed.customerPo}` : ""}</div>
              {i.parsed.source ? <div className="text-xs text-brand-blue">📎 from {i.parsed.source.attachment}{i.parsed.source.row ? ` row ${i.parsed.source.row}` : ""}</div> : i.attachments?.length ? <div className="text-xs text-muted-foreground">📎 {i.attachments.map((a) => `${a.filename} (${a.status === "parsed" ? `${a.drafts} order${a.drafts === 1 ? "" : "s"}` : "not parsed"})`).join(", ")}</div> : null}
              {i.issues.length ? <div className="text-xs text-[color:var(--risk-medium)]">⚠ {i.issues.join("; ")}</div> : null}
              {i.reviewStatus === "pending" ? <div className="mt-1 flex gap-3 text-xs"><button type="button" className="text-primary hover:underline" onClick={() => onAsk(`Approve intake ${i.id}`)}>Approve…</button><button type="button" className="text-muted-foreground hover:underline" onClick={() => onAsk(`Reject intake ${i.id}`)}>Reject</button></div> : null}
            </div>
          ))}
        </div>
      ) : null}
    </CardShell>
  );
}

// ---- pull_bol_feed ----------------------------------------------------------------------------
export interface BolFeedResult { summary: string; results: { bolId: string; bolNumber: string; outcome: string; loadNumber: string | null; customerRef: string; destinationText: string; gallons: number; product: string }[] }
export function BolFeedCard({ r, status, onOpen }: { r?: BolFeedResult; status: string; onOpen: () => void }) {
  const style: Record<string, string> = { matched: "bg-emerald-100 text-emerald-800", unmatched: "bg-rose-100 text-rose-800", duplicate: "bg-zinc-200 text-zinc-600" };
  return (
    <CardShell title="BOL feed" status={status} pendingLabel="Pulling BOLs from suppliers…" actions={<Action onClick={onOpen}>Open BOLs</Action>}>
      {r ? (
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">{r.summary}</div>
          <MiniTable headers={["BOL", "Gallons", "Outcome"]} rows={r.results.map((x) => [<span key="a">{x.bolNumber} <span className="text-muted-foreground">· {x.customerRef} · {x.product.replace(/ \(.*\)$/, "")}</span></span>, gal(x.gallons), <span key="b"><Badge label={x.outcome} className={style[x.outcome]} />{x.loadNumber ? ` ${x.loadNumber}` : ""}</span>])} />
        </div>
      ) : null}
    </CardShell>
  );
}

// ---- prepare_invoices / list_invoices ----------------------------------------------------------
export interface InvoicesResult { invoices: { id: string; invoiceNumber: string; customerName: string; loadNumber: string; gallons: number; total: number; taxTotal: number; status: string; dueDate: string }[] }
export function InvoicesCard({ r, status, onOpen, onAsk }: { r?: InvoicesResult; status: string; onOpen: () => void; onAsk: (m: string) => void }) {
  return (
    <CardShell title="Invoices" status={status} pendingLabel="Building invoices…" actions={<Action onClick={onOpen}>Open billing</Action>}>
      {r ? r.invoices.length === 0 ? <div className="text-muted-foreground">Nothing to invoice: every load with a BOL is already invoiced.</div> : (
        <MiniTable headers={["Invoice", "Gallons", "Total", "Status", ""]} rows={r.invoices.map((i) => [<span key="a">{i.invoiceNumber} <span className="text-muted-foreground">· {i.customerName} · {i.loadNumber}</span></span>, gal(i.gallons), money(i.total), titleCase(i.status), i.status === "pending_approval" ? <button key="b" type="button" className="text-primary hover:underline" onClick={() => onAsk(`Approve invoice ${i.invoiceNumber}`)}>Approve…</button> : ""])} />
      ) : null}
    </CardShell>
  );
}

// ---- sync_quickbooks --------------------------------------------------------------------------------
export interface SyncResult { invoices: { summary: string; synced: { invoiceNumber: string; total: number }[] }; payments: { summary: string; applied: { invoiceNumber: string; amount: number; method: string }[] } }
export function SyncCard({ r, status, onOpen }: { r?: SyncResult; status: string; onOpen: () => void }) {
  return (
    <CardShell title="QuickBooks sync" status={status} pendingLabel="Talking to QuickBooks…" actions={<Action onClick={onOpen}>Open billing</Action>}>
      {r ? (
        <div className="space-y-1 text-sm">
          <div>{r.invoices.summary}</div>
          <div>{r.payments.summary}{r.payments.applied.length ? `: ${r.payments.applied.map((p) => `${p.invoiceNumber} ${money(p.amount)} (${p.method})`).join(", ")}` : ""}</div>
        </div>
      ) : null}
    </CardShell>
  );
}

// ---- generic list / result cards -------------------------------------------------------------------
export function ListCard({ title, status, headers, rows, onOpen, openLabel }: { title: string; status: string; headers: string[]; rows: React.ReactNode[][]; onOpen?: () => void; openLabel?: string }) {
  return (
    <CardShell title={title} status={status} actions={onOpen ? <Action onClick={onOpen}>{openLabel ?? "Open"}</Action> : undefined}>
      {rows.length === 0 ? <div className="text-muted-foreground">None.</div> : <MiniTable headers={headers} rows={rows.slice(0, 12)} />}
      {rows.length > 12 ? <div className="mt-1 text-xs text-muted-foreground">+{rows.length - 12} more in the workspace</div> : null}
    </CardShell>
  );
}

export function ResultCard({ title, status, lines, onOpen, openLabel, error }: { title: string; status: string; lines: string[]; onOpen?: () => void; openLabel?: string; error?: string }) {
  return (
    <CardShell title={title} status={status} tone={error ? "error" : undefined} actions={onOpen ? <Action onClick={onOpen}>{openLabel ?? "Open"}</Action> : undefined}>
      {error ? <div>{error}</div> : <ul className="space-y-0.5 text-sm">{lines.map((l, i) => <li key={i}>{l}</li>)}</ul>}
    </CardShell>
  );
}
