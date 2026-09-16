"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface PortalData {
  user: { id: string; name: string; email: string };
  customer: { name: string; code: string; paymentTermsDays: number };
  locations: { id: string; name: string; city: string; state: string }[];
  orders: { id: string; orderNumber: string; product: string; gallons: number; requestedDate: string; customerPo?: string; location: string; status: string; milestones: { status: string; at: string }[]; carrier?: string; scheduledDeliveryAt?: string; deliveredAt?: string; deliveredGallons?: number; ticketNumber?: string }[];
  invoices: { invoiceNumber: string; issueDate: string; dueDate: string; total: number; status: string }[];
}

const STEPS = ["received", "confirmed", "carrier_confirmed", "in_transit", "delivered"];
const LABEL: Record<string, string> = { received: "Order received", confirmed: "Order confirmed", carrier_confirmed: "Carrier confirmed", in_transit: "Loading / in transit", delivered: "Delivered", cancelled: "Cancelled" };
const fmt = (iso?: string) => (iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—");
const fmtDay = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export default function PortalPage() {
  const router = useRouter();
  const [data, setData] = useState<PortalData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/portal/me", { cache: "no-store" }).then(async (r) => {
      if (r.status === 401) {
        router.replace("/portal/login");
        return;
      }
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Something went wrong");
      setData(j);
    }).catch((e) => setError((e as Error).message));
  }, [router]);
  const signOut = async () => {
    await fetch("/api/portal/logout", { method: "POST" });
    router.replace("/portal/login");
  };
  if (error) return <Card className="p-6 text-sm">{error}</Card>;
  if (!data) return <div className="text-sm text-muted-foreground">Loading…</div>;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{data.customer.name}</h1>
          <p className="text-sm text-muted-foreground">Your orders and deliveries. Terms: net {data.customer.paymentTermsDays}. This page only shows your account.</p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-muted-foreground">Signed in as <span className="font-medium text-foreground">{data.user.name}</span></span>
          <Button size="sm" variant="outline" onClick={signOut}>Sign out</Button>
        </div>
      </div>
      <div className="space-y-3">
        {data.orders.map((o) => {
          const idx = o.status === "cancelled" ? -1 : STEPS.indexOf(o.status);
          return (
            <Card key={o.id} className="gap-3 p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div><span className="font-semibold">{o.orderNumber}</span> <span className="text-sm text-muted-foreground">· {o.product} · {o.gallons.toLocaleString()} gal · {o.location}</span></div>
                <div className="text-sm text-muted-foreground">Requested {fmtDay(o.requestedDate)}{o.customerPo ? ` · PO ${o.customerPo}` : ""}</div>
              </div>
              {o.status === "cancelled" ? <div className="text-sm text-muted-foreground">Cancelled.</div> : (
                <ol className="grid grid-cols-5 gap-1">
                  {STEPS.map((s, i) => {
                    const at = o.milestones.find((m) => m.status === s)?.at;
                    const done = i <= idx;
                    return (
                      <li key={s} className="text-center">
                        <div className={cn("mx-auto mb-1 h-2 rounded-full", done ? "bg-primary" : "bg-secondary")} />
                        <div className={cn("text-xs", done ? "font-medium" : "text-muted-foreground")}>{LABEL[s]}</div>
                        <div className="text-[11px] text-muted-foreground">{at ? fmt(at) : ""}</div>
                      </li>
                    );
                  })}
                </ol>
              )}
              <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                {o.carrier ? <span>Carrier: {o.carrier}</span> : null}
                {o.scheduledDeliveryAt ? <span>Scheduled: {fmt(o.scheduledDeliveryAt)}</span> : null}
                {o.deliveredAt ? <span>Delivered: {fmt(o.deliveredAt)} · {o.deliveredGallons?.toLocaleString()} gal · ticket {o.ticketNumber}</span> : null}
              </div>
            </Card>
          );
        })}
        {data.orders.length === 0 ? <Card className="p-6 text-sm text-muted-foreground">No orders yet.</Card> : null}
      </div>
      {data.invoices.length ? (
        <Card className="gap-2 p-4">
          <h2 className="text-sm font-semibold">Invoices</h2>
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground"><tr><th className="text-left font-medium">Invoice</th><th className="text-left font-medium">Issued</th><th className="text-left font-medium">Due</th><th className="text-right font-medium">Total</th><th className="text-right font-medium">Status</th></tr></thead>
            <tbody>{data.invoices.map((i) => <tr key={i.invoiceNumber} className="border-t border-border"><td className="py-1.5">{i.invoiceNumber}</td><td>{fmtDay(i.issueDate)}</td><td>{fmtDay(i.dueDate)}</td><td className="text-right tabular-nums">${i.total.toLocaleString("en-US", { minimumFractionDigits: 2 })}</td><td className="text-right capitalize">{i.status === "synced" ? "open" : i.status}</td></tr>)}</tbody>
          </table>
        </Card>
      ) : null}
    </div>
  );
}
