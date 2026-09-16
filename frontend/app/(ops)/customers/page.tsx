"use client";
import { useState } from "react";
import { useOpsContext } from "@/components/ops-context";
import { Page, PageHeader, DataTable, StatusBadge, SectionCard, KV } from "@/components/ops/primitives";
import { Button } from "@/components/ui/button";
import { NewOrderSheet } from "@/components/forms/NewOrderSheet";
import { CUSTOMER_STATUS_STYLE, fmtDate, gal, INVOICE_STATUS_STYLE, isOpenOrder, money, orderStatusLabel, ORDER_STATUS_STYLE, ppg, productName, titleCase } from "@/lib/ops";

export default function CustomersPage() {
  const { state, setSelectedOrderId } = useOpsContext();
  const [selected, setSelected] = useState<string | null>(null);
  const [newOrder, setNewOrder] = useState(false);
  const c = state.customers.find((x) => x.id === selected);
  const margins = c ? state.loadMargins.filter((m) => m.customerId === c.id && m.actualGrossProfit !== null) : [];
  const gp = margins.reduce((s, m) => s + (m.actualGrossProfit ?? 0), 0);
  const gallons = margins.reduce((s, m) => s + m.gallons, 0);
  const outstanding = c ? state.invoices.filter((i) => i.customerId === c.id && ["synced", "approved", "pending_approval"].includes(i.status)) : [];
  return (
    <Page>
      <PageHeader title="Customers" description="Accounts, delivery locations, contacts, terms, and each customer's portal link." />
      <div className="grid gap-4 @3xl:grid-cols-3">
        <div className="@3xl:col-span-2">
          <DataTable rows={state.customers} rowKey={(x) => x.id} selectedKey={selected} onRowClick={(x) => setSelected(x.id)} columns={[
            { key: "n", header: "Customer", render: (x) => <div><div className="font-medium">{x.name}</div><div className="text-xs text-muted-foreground">{x.code} · {x.industry}</div></div> },
            { key: "t", header: "Terms", render: (x) => `Net ${x.paymentTermsDays}` },
            { key: "cl", header: "Credit limit", align: "right", render: (x) => money(x.creditLimit, 0) },
            { key: "b", header: "Billing basis", render: (x) => x.billingBasis },
            { key: "tx", header: "Tax", render: (x) => x.taxExempt ? "exempt" : "taxable" },
            { key: "o", header: "Open orders", align: "right", render: (x) => state.orders.filter((o) => o.customerId === x.id && isOpenOrder(o)).length },
            { key: "s", header: "Status", render: (x) => <StatusBadge label={titleCase(x.status)} className={CUSTOMER_STATUS_STYLE[x.status]} /> },
          ]} />
        </div>
        <div className="space-y-4">
          {c ? (
            <>
              <SectionCard title={c.name} action={<Button size="sm" onClick={() => setNewOrder(true)} disabled={c.status === "on_hold"}>New order</Button>}>
                <div className="space-y-1.5 text-sm">
                  <KV label="Terms / credit">Net {c.paymentTermsDays} · {money(c.creditLimit, 0)}</KV>
                  <KV label="Billing basis">{c.billingBasis} gallons</KV>
                  <KV label="Tax">{c.taxExempt ? "Exempt (certificate on file)" : "Taxable"}</KV>
                  <KV label="QuickBooks">{c.quickbooksCustomerId ?? "not linked"}</KV>
                  <KV label="Outstanding">{money(outstanding.reduce((s, i) => s + i.total, 0))} ({outstanding.length})</KV>
                  <KV label="30-day profit">{money(gp)} · {gallons ? ppg(gp / gallons) : "—"}</KV>
                  {c.notes ? <div className="rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-900">{c.notes}</div> : null}
                  <div className="pt-1 text-xs">
                    <span className="text-muted-foreground">Portal link: </span>
                    <a className="text-primary hover:underline" href={`/portal/${c.portalToken}`} target="_blank" rel="noreferrer">/portal/{c.portalToken}</a>
                  </div>
                </div>
              </SectionCard>
              <SectionCard title="Delivery locations">
                <ul className="space-y-1 text-sm">{state.deliveryLocations.filter((l) => l.customerId === c.id).map((l) => <li key={l.id}><span className="font-medium">{l.name}</span> <span className="text-muted-foreground">· {l.address}, {l.city}, {l.state} {l.zip}</span>{l.deliveryInstructions ? <div className="text-xs text-muted-foreground">{l.deliveryInstructions}</div> : null}</li>)}</ul>
              </SectionCard>
              <SectionCard title="Contacts">
                <ul className="space-y-1 text-sm">{state.contacts.filter((x) => x.customerId === c.id).map((x) => <li key={x.id}><span className="font-medium">{x.name}</span> <span className="text-muted-foreground">· {x.title} · <a className="hover:underline" href={`mailto:${x.email}`}>{x.email}</a> · {x.role}</span></li>)}</ul>
              </SectionCard>
              <SectionCard title="Orders">
                <ul className="space-y-1 text-sm">{state.orders.filter((o) => o.customerId === c.id).sort((a, b) => b.requestedDate.localeCompare(a.requestedDate)).slice(0, 8).map((o) => <li key={o.id} className="flex items-center justify-between gap-2"><button type="button" className="text-primary hover:underline" onClick={() => setSelectedOrderId(o.id)}>{o.orderNumber}</button><span className="text-xs text-muted-foreground">{productName(state, o.productId)} · {gal(o.requestedGallons)} · {fmtDate(o.requestedDate)}</span><StatusBadge label={orderStatusLabel(o.status)} className={ORDER_STATUS_STYLE[o.status]} /></li>)}</ul>
              </SectionCard>
              <SectionCard title="Invoices">
                <ul className="space-y-1 text-sm">{state.invoices.filter((i) => i.customerId === c.id).map((i) => <li key={i.id} className="flex items-center justify-between gap-2"><span>{i.invoiceNumber}</span><span className="text-xs text-muted-foreground">due {fmtDate(i.dueDate)}</span><span className="tabular-nums">{money(i.total)}</span><StatusBadge label={titleCase(i.status)} className={INVOICE_STATUS_STYLE[i.status]} /></li>)}</ul>
              </SectionCard>
            </>
          ) : <SectionCard title="Select a customer"><div className="text-sm text-muted-foreground">Click a row to see locations, contacts, orders, invoices, and the portal link.</div></SectionCard>}
        </div>
      </div>
      {newOrder && c ? <NewOrderSheet open={newOrder} onOpenChange={setNewOrder} defaultCustomerId={c.id} /> : null}
    </Page>
  );
}
