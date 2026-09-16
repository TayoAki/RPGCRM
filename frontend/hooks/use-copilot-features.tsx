"use client";
import { z } from "zod";
import { useRenderTool, useHumanInTheLoop, useFrontendTool, useConfigureSuggestions, useAgent } from "@copilotkit/react-core/v2";
import { useRouter } from "next/navigation";
import { pageToRoute, PAGE_KEYS } from "@/lib/navigation";
import { parseResult, money, ppg, gal, titleCase } from "@/components/cards/shared";
import {
  PriceQuoteCard, DailyBriefCard, MarketCard, ExceptionsCard, MarginCard, CustomerCard, IntakeQueueCard, BolFeedCard, InvoicesCard, SyncCard, ListCard, ResultCard,
} from "@/components/cards/OpsCards";
import type { QuoteResult, BriefResult, MarketResult, TriageResult, MarginResult, CustomerResult, IntakeResult, BolFeedResult, InvoicesResult, SyncResult } from "@/components/cards/OpsCards";
import { ConfirmOrderCard, ConfirmIntakeCard, ConfirmInvoiceCard } from "@/components/cards/ApprovalCards";

const AGENT_ID = "strands_agent";
// Loose schemas: the agent owns the real input schemas; these only type the render args.
const any = z.object({}).passthrough();

type Rec = Record<string, unknown>;
const str = (v: unknown, fallback = "—") => (v === null || v === undefined ? fallback : String(v));
const num = (v: unknown) => (typeof v === "number" ? v : undefined);
const errorOf = (r: unknown): string | undefined => {
  const o = r as Rec | undefined;
  if (!o) return undefined;
  if (typeof o.error === "string") return o.error;
  if (o.ok === false && typeof o.message === "string") return o.message;
  return undefined;
};

/**
 * Wires the copilot to the workspace: generative-UI cards for read tools,
 * confirmation cards (human-in-the-loop) before anything that creates orders or
 * approves money, frontend tools for navigation, and the suggestion pills.
 */
export function useCopilotFeatures({ setSelectedOrderId, setSelectedLoadId }: { setSelectedOrderId: (id: string | null) => void; setSelectedLoadId: (id: string | null) => void }) {
  const router = useRouter();
  const { agent } = useAgent({ agentId: AGENT_ID });

  const go = (page: string) => router.push(pageToRoute(page));
  const openOrder = (id: string) => {
    router.push("/orders");
    setSelectedOrderId(id);
  };
  const openLoad = (id: string) => {
    router.push("/loads");
    setSelectedLoadId(id);
  };
  // Card CTAs send a templated user message and run the agent (approvals still go through HITL cards).
  const ask = (message: string) => {
    agent.addMessage({ id: crypto.randomUUID(), role: "user", content: message });
    void agent.runAgent();
  };

  // Deps are JSON-serialized by CopilotKit for change detection, so they must stay
  // primitive — never include the agent/router objects. Callbacks close over stable refs.

  // ---- Pricing (Module C) ---------------------------------------------------------
  useRenderTool({ name: "quote_price", parameters: any, render: ({ result, status }) => <PriceQuoteCard r={parseResult<QuoteResult>(result)} status={status} onOpenPricing={() => go("pricing")} /> }, []);
  useRenderTool({
    name: "explain_price",
    parameters: any,
    render: ({ result, status }) => {
      const r = parseResult<Rec & { explanation?: string[] }>(result);
      return <ResultCard title="Price explanation" status={status} error={errorOf(r)} lines={r?.explanation ?? []} onOpen={() => go("pricing")} openLabel="Open pricing" />;
    },
  }, []);
  useRenderTool({
    name: "price_board",
    parameters: any,
    render: ({ result, status }) => {
      const r = parseResult<{ date?: string; rows?: { customerName: string; productName: string; terminalName?: string; sellPricePerGallon: number | null; ruleName?: string }[] }>(result);
      return <ListCard title={`Price board${r?.date ? ` · ${r.date}` : ""}`} status={status} headers={["Customer", "Product", "Terminal", "$/gal"]} rows={(r?.rows ?? []).map((x) => [x.customerName, x.productName.replace(/ \(.*\)$/, ""), x.terminalName ?? "—", ppg(x.sellPricePerGallon)])} onOpen={() => go("pricing")} openLabel="Open pricing" />;
    },
  }, []);
  useRenderTool({
    name: "import_rack_prices",
    parameters: any,
    render: ({ result, status }) => {
      const r = parseResult<{ summary?: string; imported?: Rec[]; skipped?: Rec[] }>(result);
      const rows = (r?.imported ?? []).slice(0, 8).map((x) => `${str(x.supplier)} · ${str(x.terminal)} · ${str(x.product)}: ${ppg(num(x.pricePerGallon))}${typeof x.change === "number" ? ` (${x.change >= 0 ? "+" : ""}${x.change.toFixed(4)})` : ""}`);
      const more = (r?.imported?.length ?? 0) - rows.length;
      return <ResultCard title="Rack feed imported" status={status} error={errorOf(r)} lines={r ? [str(r.summary), ...rows, ...(more > 0 ? [`+${more} more postings`] : [])] : []} onOpen={() => go("pricing")} openLabel="Open pricing" />;
    },
  }, []);
  useRenderTool({
    name: "enter_rack_price",
    parameters: any,
    render: ({ result, status }) => {
      const r = parseResult<Rec>(result);
      return <ResultCard title="Rack price entered" status={status} error={errorOf(r)} lines={r ? [`${str(r.supplierName ?? r.supplierId)} · ${str(r.terminalName ?? r.terminalId)} · ${str(r.productName ?? r.productId)}: ${ppg(num(r.pricePerGallon))} (${str(r.priceDate)})`] : []} onOpen={() => go("pricing")} openLabel="Open pricing" />;
    },
  }, []);

  // ---- Insights (Modules I, J) ---------------------------------------------------------
  useRenderTool({ name: "daily_brief", parameters: any, render: ({ result, status }) => <DailyBriefCard r={parseResult<BriefResult>(result)} status={status} onOpen={go} /> }, []);
  useRenderTool({ name: "market_update", parameters: any, render: ({ result, status }) => <MarketCard r={parseResult<MarketResult>(result)} status={status} onOpen={() => go("market")} /> }, []);
  useRenderTool({ name: "refresh_market_feed", parameters: any, render: ({ result, status }) => <MarketCard r={parseResult<MarketResult>(result)} status={status} onOpen={() => go("market")} /> }, []);
  useRenderTool({ name: "triage_exceptions", parameters: any, render: ({ result, status }) => <ExceptionsCard r={parseResult<TriageResult>(result)} status={status} onOpen={() => go("exceptions")} onAsk={ask} /> }, []);
  useRenderTool({
    name: "resolve_exception",
    parameters: any,
    render: ({ result, status }) => {
      const r = parseResult<Rec>(result);
      return <ResultCard title="Exception resolved" status={status} error={errorOf(r)} lines={r ? [`${str(r.id)} · ${str(r.message)}`, r.resolutionNote ? `Note: ${str(r.resolutionNote)}` : ""].filter(Boolean) : []} onOpen={() => go("exceptions")} openLabel="Open exceptions" />;
    },
  }, []);
  useRenderTool({ name: "margin_report", parameters: any, render: ({ result, status }) => <MarginCard r={parseResult<MarginResult>(result)} status={status} onOpen={() => go("reports")} onOpenLoad={openLoad} /> }, []);
  useRenderTool({
    name: "profit_rollups",
    parameters: any,
    render: ({ result, status }) => {
      const r = parseResult<{ period?: string; rollups?: Rec[] }>(result);
      const rows = [...(r?.rollups ?? [])].reverse();
      return <ListCard title={`Totals by ${str(r?.period, "period")}`} status={status} headers={["Period", "Loads", "Gallons", "Revenue", "Actual GP", "GP/gal"]} rows={rows.map((x) => [str(x.label), str(x.loads), gal(num(x.gallons)), money(num(x.revenue)), money(num(x.actualGrossProfit)), ppg(x.profitPerGallon as number | null)])} onOpen={() => go("reports")} openLabel="Open reports" />;
    },
  }, []);
  useRenderTool({
    name: "customer_summary",
    parameters: any,
    render: ({ result, status }) => {
      const r = parseResult<CustomerResult>(result);
      const err = errorOf(r);
      if (err) return <ResultCard title="Customer" status={status} error={err} lines={[]} />;
      return <CustomerCard r={r && r.customer ? r : undefined} status={status} onOpen={() => go("customers")} onOpenOrder={openOrder} />;
    },
  }, []);

  // ---- Orders and intake (Modules G, H) ------------------------------------------------
  useRenderTool({ name: "run_email_intake", parameters: any, render: ({ result, status }) => <IntakeQueueCard r={parseResult<IntakeResult>(result)} status={status} onOpen={() => go("orders")} onAsk={ask} /> }, []);
  useRenderTool({ name: "list_intake_queue", parameters: any, render: ({ result, status }) => <IntakeQueueCard r={parseResult<IntakeResult>(result)} status={status} onOpen={() => go("orders")} onAsk={ask} /> }, []);
  useRenderTool({
    name: "review_intake",
    parameters: any,
    render: ({ result, status }) => {
      const r = parseResult<Rec & { order?: Rec | null }>(result);
      const o = r?.order;
      return <ResultCard title={r?.reviewStatus === "rejected" ? "Email rejected" : "Email approved"} status={status} error={errorOf(r)} lines={r ? [o ? `Created ${str(o.orderNumber)} · ${str(o.customerName)} · ${gal(num(o.requestedGallons))} ${str(o.productName)} on ${str(o.requestedDate)}` : `${str(r.id)} marked ${str(r.reviewStatus)}`] : []} onOpen={() => (o ? openOrder(String(o.id)) : go("orders"))} openLabel={o ? "Open order" : "Open orders"} />;
    },
  }, []);
  useRenderTool({
    name: "list_orders",
    parameters: any,
    render: ({ result, status }) => {
      const r = parseResult<{ orders?: Rec[] }>(result);
      return <ListCard title="Orders" status={status} headers={["Order", "Customer", "Gallons", "Date", "Status"]} rows={(r?.orders ?? []).map((o) => [<button key="b" type="button" className="text-primary hover:underline" onClick={() => openOrder(String(o.id))}>{str(o.orderNumber)}</button>, str(o.customerName), gal(num(o.requestedGallons)), str(o.requestedDate), titleCase(str(o.status))])} onOpen={() => go("orders")} openLabel="Open orders" />;
    },
  }, []);
  useRenderTool({
    name: "create_order",
    parameters: any,
    render: ({ result, status }) => {
      const r = parseResult<Rec>(result);
      return <ResultCard title="Order created" status={status} error={errorOf(r)} lines={r ? [`${str(r.orderNumber)} · ${str(r.customerName)} · ${gal(num(r.requestedGallons))} ${str(r.productName)} → ${str(r.locationName)} on ${str(r.requestedDate)}`, `Status: ${titleCase(str(r.status))}`] : []} onOpen={() => (r?.id ? openOrder(String(r.id)) : go("orders"))} openLabel="Open order" />;
    },
  }, []);
  useRenderTool({
    name: "update_order_status",
    parameters: any,
    render: ({ result, status }) => {
      const r = parseResult<Rec>(result);
      return <ResultCard title="Order updated" status={status} error={errorOf(r)} lines={r ? [`${str(r.orderNumber)} is now ${titleCase(str(r.status))}`] : []} onOpen={() => (r?.id ? openOrder(String(r.id)) : go("orders"))} openLabel="Open order" />;
    },
  }, []);
  useRenderTool({
    name: "release_credit_hold",
    parameters: any,
    render: ({ result, status }) => {
      const r = parseResult<Rec>(result);
      return <ResultCard title="Credit hold released" status={status} error={errorOf(r)} lines={r ? [`${str(r.orderNumber)} · ${str(r.customerName)} can be confirmed and dispatched.`] : []} onOpen={() => (r?.id ? openOrder(String(r.id)) : go("orders"))} openLabel="Open order" />;
    },
  }, []);

  // ---- Loads and BOLs (Modules E, F) -----------------------------------------------------
  useRenderTool({
    name: "list_loads",
    parameters: any,
    render: ({ result, status }) => {
      const r = parseResult<{ loads?: Rec[] }>(result);
      return <ListCard title="Loads" status={status} headers={["Load", "Customer", "Carrier", "Status", "Billing"]} rows={(r?.loads ?? []).map((l) => [<button key="b" type="button" className="text-primary hover:underline" onClick={() => openLoad(String(l.id))}>{str(l.loadNumber)}</button>, str(l.customerName), str(l.carrierName), titleCase(str(l.status)), l.billingStatus ? titleCase(str(l.billingStatus)) : "—"])} onOpen={() => go("loads")} openLabel="Open loads" />;
    },
  }, []);
  useRenderTool({
    name: "create_load",
    parameters: any,
    render: ({ result, status }) => {
      const r = parseResult<Rec>(result);
      return <ResultCard title="Load created" status={status} error={errorOf(r)} lines={r ? [`${str(r.loadNumber)} · ${str(r.customerName)} · ${gal(num(r.plannedGallons))} ${str(r.productName)}`, `${str(r.carrierName)} from ${str(r.terminalName)} · pickup ${str(r.scheduledPickupAt).slice(0, 16).replace("T", " ")}`] : []} onOpen={() => (r?.id ? openLoad(String(r.id)) : go("loads"))} openLabel="Open load" />;
    },
  }, []);
  useRenderTool({
    name: "update_load_status",
    parameters: any,
    render: ({ result, status }) => {
      const r = parseResult<Rec>(result);
      return <ResultCard title="Load updated" status={status} error={errorOf(r)} lines={r ? [`${str(r.loadNumber)} is now ${titleCase(str(r.status))}`] : []} onOpen={() => (r?.id ? openLoad(String(r.id)) : go("loads"))} openLabel="Open load" />;
    },
  }, []);
  useRenderTool({
    name: "record_delivery",
    parameters: any,
    render: ({ result, status }) => {
      const r = parseResult<Rec & { delivery?: Rec; load?: Rec }>(result);
      const d = r?.delivery ?? r;
      const l = r?.load ?? r;
      return <ResultCard title="Delivery recorded" status={status} error={errorOf(r)} lines={r ? [`${str(l?.loadNumber)} · ${gal(num(d?.deliveredGallons))} received by ${str(d?.receiverName)} (ticket ${str(d?.ticketNumber)})`] : []} onOpen={() => (l?.id ? openLoad(String(l.id)) : go("loads"))} openLabel="Open load" />;
    },
  }, []);
  useRenderTool({
    name: "set_billing_status",
    parameters: any,
    render: ({ result, status }) => {
      const r = parseResult<Rec>(result);
      return <ResultCard title="Billing status updated" status={status} error={errorOf(r)} lines={r ? [`${str(r.loadNumber)} billing: ${titleCase(str(r.billingStatus))}`] : []} onOpen={() => (r?.id ? openLoad(String(r.id)) : go("loads"))} openLabel="Open load" />;
    },
  }, []);
  useRenderTool({ name: "pull_bol_feed", parameters: any, render: ({ result, status }) => <BolFeedCard r={parseResult<BolFeedResult>(result)} status={status} onOpen={() => go("bols")} /> }, []);
  useRenderTool({
    name: "list_bols",
    parameters: any,
    render: ({ result, status }) => {
      const r = parseResult<{ bols?: Rec[] }>(result);
      return <ListCard title="Bills of lading" status={status} headers={["BOL", "Supplier", "Net gal", "Load"]} rows={(r?.bols ?? []).map((b) => [str(b.bolNumber), str(b.supplierName), gal(num(b.netGallons)), b.loadNumber ? str(b.loadNumber) : <span key="u" className="text-[color:var(--risk-high)]">unmatched</span>])} onOpen={() => go("bols")} openLabel="Open BOLs" />;
    },
  }, []);
  useRenderTool({
    name: "match_bol",
    parameters: any,
    render: ({ result, status }) => {
      const r = parseResult<Rec & { bol?: Rec; load?: Rec }>(result);
      return <ResultCard title="BOL matched" status={status} error={errorOf(r)} lines={r ? [`${str(r.bol?.bolNumber ?? r.bolNumber)} → ${str(r.load?.loadNumber ?? r.loadNumber)}`] : []} onOpen={() => go("bols")} openLabel="Open BOLs" />;
    },
  }, []);

  // ---- Billing (Module D) -----------------------------------------------------------------
  useRenderTool({ name: "list_invoices", parameters: any, render: ({ result, status }) => <InvoicesCard r={parseResult<InvoicesResult>(result)} status={status} onOpen={() => go("billing")} onAsk={ask} /> }, []);
  useRenderTool({ name: "prepare_invoices", parameters: any, render: ({ result, status }) => <InvoicesCard r={parseResult<InvoicesResult>(result)} status={status} onOpen={() => go("billing")} onAsk={ask} /> }, []);
  useRenderTool({
    name: "approve_invoice",
    parameters: any,
    render: ({ result, status }) => {
      const r = parseResult<Rec>(result);
      return <ResultCard title="Invoice approved" status={status} error={errorOf(r)} lines={r ? [`${str(r.invoiceNumber)} · ${str(r.customerName)} · ${money(num(r.total))} · ${titleCase(str(r.status))}`] : []} onOpen={() => go("billing")} openLabel="Open billing" />;
    },
  }, []);
  useRenderTool({
    name: "reject_invoice",
    parameters: any,
    render: ({ result, status }) => {
      const r = parseResult<Rec>(result);
      return <ResultCard title="Invoice sent back" status={status} error={errorOf(r)} lines={r ? [`${str(r.invoiceNumber)} → ${titleCase(str(r.status))}`] : []} onOpen={() => go("billing")} openLabel="Open billing" />;
    },
  }, []);
  useRenderTool({ name: "sync_quickbooks", parameters: any, render: ({ result, status }) => <SyncCard r={parseResult<SyncResult>(result)} status={status} onOpen={() => go("billing")} /> }, []);

  // ---- Human-in-the-loop approvals -----------------------------------------------------------
  useHumanInTheLoop({
    agentId: AGENT_ID,
    name: "confirm_order",
    description: "Show the drafted order to the user for confirmation before create_order. Returns approved plus any edited values.",
    parameters: z.object({
      customer: z.string(),
      location: z.string().optional(),
      product: z.string(),
      gallons: z.number(),
      requestedDate: z.string(),
      customerPo: z.string().optional(),
      specialInstructions: z.string().optional(),
    }),
    render: ({ args, status, respond }) => <ConfirmOrderCard args={args as Parameters<typeof ConfirmOrderCard>[0]["args"]} status={status} respond={respond ? (v) => respond(v) : undefined} />,
  });

  useHumanInTheLoop({
    agentId: AGENT_ID,
    name: "confirm_intake",
    description: "Show a parsed order email to the reviewer for approval before review_intake. Returns approved plus edits (customerId, deliveryLocationId, productId, gallons, requestedDate, customerPo).",
    parameters: z.object({
      intakeId: z.string(),
      customerName: z.string().optional(),
      customerId: z.string().optional(),
      deliveryLocationId: z.string().optional(),
      deliveryLocationName: z.string().optional(),
      productId: z.string().optional(),
      productName: z.string().optional(),
      gallons: z.number().optional(),
      requestedDate: z.string().optional(),
      customerPo: z.string().optional(),
      issues: z.array(z.string()).optional(),
    }),
    render: ({ args, status, respond }) => <ConfirmIntakeCard args={args as Parameters<typeof ConfirmIntakeCard>[0]["args"]} status={status} respond={respond ? (v) => respond(v) : undefined} />,
  });

  useHumanInTheLoop({
    agentId: AGENT_ID,
    name: "confirm_invoice",
    description: "Show an invoice summary to the approver before approve_invoice. Returns approved.",
    parameters: z.object({
      invoiceId: z.string(),
      invoiceNumber: z.string().optional(),
      customerName: z.string().optional(),
      loadNumber: z.string().optional(),
      gallons: z.number().optional(),
      pricePerGallon: z.number().optional(),
      subtotal: z.number().optional(),
      taxTotal: z.number().optional(),
      total: z.number().optional(),
      dueDate: z.string().optional(),
    }),
    render: ({ args, status, respond }) => <ConfirmInvoiceCard args={args as Parameters<typeof ConfirmInvoiceCard>[0]["args"]} status={status} respond={respond ? (v) => respond(v) : undefined} />,
  });

  // ---- Frontend tools (pure UI) -----------------------------------------------------------------
  useFrontendTool({
    name: "navigate_to",
    description: 'Navigate the workspace to a top-level page. Use when the user asks to see/open/go to a page (e.g. "show me the loads board", "open billing"). Pure UI action.',
    parameters: z.object({ page: z.enum(PAGE_KEYS) }),
    handler: async ({ page }) => {
      go(page);
      return { status: "success", page };
    },
  });
  useFrontendTool({
    name: "focus_order",
    description: "Open an order's detail drawer in the workspace by its id (e.g. o-1008). Pure UI action.",
    parameters: z.object({ orderId: z.string() }),
    handler: async ({ orderId }) => {
      openOrder(orderId);
      return { status: "success" };
    },
  });
  useFrontendTool({
    name: "focus_load",
    description: "Open a load's detail drawer in the workspace by its id (e.g. l-506). Pure UI action.",
    parameters: z.object({ loadId: z.string() }),
    handler: async ({ loadId }) => {
      openLoad(loadId);
      return { status: "success" };
    },
  });

  // ---- Suggestions ---------------------------------------------------------------------------------
  useConfigureSuggestions({
    suggestions: [
      { title: "Morning brief", message: "Give me the daily brief." },
      { title: "What needs attention", message: "What needs attention right now?" },
      { title: "Check the inbox", message: "Run email intake and show me what came in." },
      { title: "Quote a price", message: "What's today's price for Lone Star Aggregates on ULSD, 7,500 gallons?" },
      { title: "Pull BOLs", message: "Pull the BOL feed and match them to loads." },
      { title: "Prepare invoices", message: "Prepare invoices for the loads that are ready to bill." },
    ],
    available: "always",
  });
}
