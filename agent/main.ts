import express from "express";
import cors from "cors";
import { Agent } from "@strands-agents/sdk";
import { OpenAIModel } from "@strands-agents/sdk/models/openai";
import { StrandsAgent } from "@ag-ui/aws-strands";
import { addPing, addStrandsExpressEndpoint } from "@ag-ui/aws-strands/server";

import { ops } from "./src/domain/store.js";
import { registerOpsRoutes } from "./src/routes.js";
import { enterActor } from "./src/services/actor.js";
import { quotePriceTool, explainPriceTool, priceBoardTool, enterRackPriceTool } from "./src/tools/pricing.js";
import {
  runEmailIntakeTool, listIntakeQueueTool, reviewIntakeTool, listOrdersTool, createOrderTool, updateOrderStatusTool, releaseCreditHoldTool,
  listLoadsTool, createLoadTool, updateLoadStatusTool, recordDeliveryTool, setBillingStatusTool, pullBolFeedTool, matchBolTool, listBolsTool,
} from "./src/tools/ops.js";
import { listInvoicesTool, prepareInvoicesTool, approveInvoiceTool, rejectInvoiceTool, syncQuickBooksTool } from "./src/tools/billing.js";
import { dailyBriefTool, marketUpdateTool, refreshMarketFeedTool, triageExceptionsTool, resolveExceptionTool, marginReportTool, profitRollupsTool, customerSummaryTool } from "./src/tools/insights.js";

const model = new OpenAIModel({
  apiKey: process.env.OPENAI_API_KEY ?? "",
  // Model id; override with OPENAI_MODEL (e.g. "openai/gpt-5.4" on OpenRouter).
  modelId: process.env.OPENAI_MODEL ?? "gpt-5.4",
  // OPENAI_API_MODE=chat selects the Chat Completions API (OpenRouter, aimock);
  // the default is the Responses API.
  ...(process.env.OPENAI_API_MODE === "chat" ? { api: "chat" as const } : {}),
});

const SYSTEM_PROMPT = `You are the RPG Copilot, the assistant inside Royalty Petroleums Group's fuel operations platform (RPG Fuel Platform). Royalty Petroleums Group is an Atlanta-based wholesale fuel supplier: it delivers cost-effective wholesale fuel solutions with reliable supply, competitive pricing, and expert logistics management. RPG buys fuel at supplier terminals (racks) and delivers it to commercial customers by truck. You help staff work the order-to-cash lifecycle: order intake → pricing → dispatch/loads → supplier BOLs → delivery → billing → profitability. Be concise and action-oriented. Prefer the generative-UI cards your tools render over long prose; never dump raw tool JSON; never restate a card's numbers in prose.

## Vocabulary
Rack = supplier base price at a terminal. BOL = bill of lading issued at the terminal when the truck lifts product (gross and net gallons, supplier cost, taxes). Load = one truck trip for one or more orders. Billing workflow: BOL Received → Pricing Verified → Ready to Invoice → Invoiced → Paid. Order milestones: Order Received → Order Confirmed → Carrier Confirmed → Loading/In Transit → Delivered.

## Hard rules (money and approvals)
- You never set a price, activate a pricing rule, approve an invoice, or create an order on your own. Those need a human confirmation step:
  - New order from chat: gather customer, location, product, gallons, requested date (and PO/notes), then call confirm_order (frontend approval card). Only if it returns approved=true call create_order with the confirmed values.
  - Email intake: run_email_intake / list_intake_queue show the queue. To approve one, call confirm_intake with its intakeId and parsed fields; only if approved=true call review_intake with decision "approve" and any edits returned. Reject with review_intake decision "reject" when the user says so.
  - Invoices: prepare_invoices drafts them. To approve, call confirm_invoice with the invoiceId and summary; only if approved=true call approve_invoice. Then offer sync_quickbooks.
- Never invent rack prices or index values. enter_rack_price only with a number the user typed.
- Credit holds block dispatch. Explain the hold; release_credit_hold only when the user explicitly asks.

## Tool routing
- "What's the price for X" / quotes → quote_price (pass names as the user said them; include gallons when given). Explain a past price → explain_price.
- Price sheet / today's prices → price_board.
- "How are we doing", morning brief, status → daily_brief (once). End with ONE suggested next step as a question.
- Market, indexes, forecast → market_update; "refresh the feed" → refresh_market_feed.
- What needs attention / exceptions / problems → triage_exceptions (once). Resolve with resolve_exception after the user confirms what was done.
- Orders → list_orders / update_order_status. Loads → list_loads / create_load / update_load_status / record_delivery / set_billing_status.
- BOLs → pull_bol_feed (ingest from suppliers), list_bols, match_bol for unmatched ones.
- Billing → list_invoices / prepare_invoices / confirm_invoice → approve_invoice / reject_invoice / sync_quickbooks.
- Profit, margin, profitability → margin_report. Totals by day, week, or month ("how did we do last week", "gallons by month") → profit_rollups. "Tell me about <customer>" → customer_summary.
- Navigation ("show me the loads board", "open billing") → navigate_to with one of: dashboard, orders, loads, pricing, market, bols, billing, exceptions, customers, network, reports. Confirm in a short phrase. To open a specific order or load, focus_order / focus_load.

## Style
Use the deal ids/order ids/load ids from the tools when calling other tools; refer to things by their human numbers (ORD-1008, LD-506, INV-1004) when talking. After a mutation, confirm in one sentence what changed. If a tool errors (e.g. credit hold, missing rule), explain the reason and the fix in one or two sentences.`;

const agent = new Agent({
  model,
  systemPrompt: SYSTEM_PROMPT,
  tools: [
    quotePriceTool, explainPriceTool, priceBoardTool, enterRackPriceTool,
    runEmailIntakeTool, listIntakeQueueTool, reviewIntakeTool, listOrdersTool, createOrderTool, updateOrderStatusTool, releaseCreditHoldTool,
    listLoadsTool, createLoadTool, updateLoadStatusTool, recordDeliveryTool, setBillingStatusTool, pullBolFeedTool, matchBolTool, listBolsTool,
    listInvoicesTool, prepareInvoicesTool, approveInvoiceTool, rejectInvoiceTool, syncQuickBooksTool,
    dailyBriefTool, marketUpdateTool, refreshMarketFeedTool, triageExceptionsTool, resolveExceptionTool, marginReportTool, profitRollupsTool, customerSummaryTool,
  ],
});

await agent.initialize();

// After any state-mutating tool, push the trimmed ops snapshot to the UI as a STATE_SNAPSHOT.
const pushState = { stateFromResult: () => ops.uiSnapshot() as unknown as Record<string, unknown> };
const MUTATING = [
  "enter_rack_price", "run_email_intake", "review_intake", "create_order", "update_order_status", "release_credit_hold",
  "create_load", "update_load_status", "record_delivery", "set_billing_status", "pull_bol_feed", "match_bol",
  "prepare_invoices", "approve_invoice", "reject_invoice", "sync_quickbooks", "refresh_market_feed", "resolve_exception", "quote_price",
];

const aguiAgent = new StrandsAgent({
  agent,
  name: "strands_agent",
  config: {
    toolBehaviors: Object.fromEntries(MUTATING.map((n) => [n, pushState])),
    // A compact operational summary on every prompt, plus who is acting.
    stateContextBuilder: (input, prompt) => {
      const props = (input as { forwardedProps?: { actorId?: string } }).forwardedProps;
      enterActor(props?.actorId);
      const s = ops.snapshot();
      const actor = s.staff.find((u) => u.id === (props?.actorId ?? "u-dana"));
      const open = s.exceptions.filter((e) => e.status !== "resolved");
      const lines = [
        `Today: ${new Date().toISOString().slice(0, 10)}. Acting user: ${actor ? `${actor.name} (${actor.role}, id ${actor.id})` : "unknown"}.`,
        `Open orders: ${s.orders.filter((o) => !["delivered", "cancelled"].includes(o.status)).length}; intake queue: ${s.emailIntakes.filter((e) => e.reviewStatus === "pending").length}; loads awaiting billing: ${s.loads.filter((l) => l.billingStatus && !["invoiced", "paid"].includes(l.billingStatus)).length}; invoices pending approval: ${s.invoices.filter((i) => i.status === "pending_approval").length}; open exceptions: ${open.length} (${open.filter((e) => e.severity === "critical").length} critical).`,
        `Customers: ${s.customers.map((c) => `${c.name} [${c.code}]`).join(", ")}.`,
        `Products: ${s.products.map((p) => `${p.name} [${p.code}]`).join(", ")}. Terminals: ${s.terminals.map((t) => `${t.name} [${t.code}]`).join(", ")}. Carriers: ${s.carriers.map((c) => `${c.name} [${c.code}]`).join(", ")}.`,
      ];
      return `${prompt}\n\n[Operations context]\n${lines.join("\n")}`;
    },
  },
});

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "50mb" }));
addPing(app, "/ping");
addStrandsExpressEndpoint(app, aguiAgent, { path: "/" });
registerOpsRoutes(app);

const PORT = Number(process.env.PORT) || 8000;
app.listen(PORT, () => {
  console.log(`RPG Fuel agent listening on http://localhost:${PORT}`);
});
