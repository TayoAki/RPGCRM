/**
 * Content for the tester guide: the in-app Start here panel and the /guide
 * page read from here, and BETA_GUIDE.md at the repo root says the same
 * things for people who prefer a document.
 */

export const DEMO_STAFF_PASSWORD = "RPGstaff!2026";
export const DEMO_PORTAL_PASSWORD = "RPGportal!2026";

export const STAFF_ACCOUNTS = [
  { name: "Dana Whitfield", email: "dana@rpgfuel.example", role: "management", tryIt: "Approves invoices; the full walkthrough works from here." },
  { name: "Marcus Lee", email: "marcus@rpgfuel.example", role: "dispatch", tryIt: "Loads, deliveries, BOL matching." },
  { name: "Priya Natarajan", email: "priya@rpgfuel.example", role: "pricing", tryIt: "Rack sheets, rules, quotes, the market feed." },
  { name: "Elena Ortiz", email: "elena@rpgfuel.example", role: "billing", tryIt: "Prepares invoices, cannot approve them." },
  { name: "Sam Carter", email: "sam@rpgfuel.example", role: "admin", tryIt: "The only account that can reset the demo data." },
] as const;

export interface GuideStep {
  title: string;
  href: string;
  body: string;
  /** Something to type into the copilot at this step. */
  copilot?: string;
}

export const WALKTHROUGH: GuideStep[] = [
  { title: "Dashboard", href: "/", body: "Today's numbers, 14-day gallons, market movement, and what needs attention. The pills in the copilot run the same flows from chat.", copilot: "Give me the daily brief." },
  { title: "Run email intake", href: "/orders", body: "Nine sample emails become twelve drafts: six from email bodies, and the rest from an attached CSV schedule, an Excel sheet, and a PDF purchase order. Open the queue, fix the one with no matching customer, approve the rest. Each approval becomes an order.", copilot: "Run email intake and show me what came in." },
  { title: "Bring in rack prices", href: "/pricing", body: "Press Import rack feed for today's sample postings, then Upload rack sheet with one of the sample sheets (or your supplier's real one). The price board recalculates. Upload the same sheet twice: the second time nothing new is imported.", copilot: "What's today's price for Lone Star Aggregates on ULSD, 7,500 gallons?" },
  { title: "Dispatch a load", href: "/loads", body: "Create a load for a confirmed order, then drag it Planned → Dispatched → Loading → In Transit. Record the delivery ticket from the load drawer." },
  { title: "Pull BOLs", href: "/bols", body: "Three bills of lading match loads automatically, one is a duplicate, one needs a manual match. Pull again and the duplicates are reported, not re-added.", copilot: "Pull the BOL feed and match them to loads." },
  { title: "Bill and approve", href: "/billing", body: "Press Prepare invoices. Only management or admin can approve; billing is refused. Then Sync QuickBooks: invoices get ids and the sample payments are applied.", copilot: "Prepare invoices for the loads that are ready to bill." },
  { title: "Work the exceptions", href: "/exceptions", body: "The low-margin load, the missing BOL, and the unpriced order show up here and in the daily brief. Resolve one with a note.", copilot: "What needs attention right now?" },
  { title: "Market and reports", href: "/market", body: "Refresh the market feed and look at the forecast hit rate. Reports has profitability by customer and by load, and totals by day, week, and month." },
  { title: "See what a customer sees", href: "/portal/login", body: "Open the customer portal in another tab and sign in as orders@lonestaraggregates.com: orders, deliveries, and invoices for that customer only, and no prices." },
];

export const SAMPLE_SHEETS = [
  { name: "Marathon CSV export", href: "/samples/marathon-rack-sheet.csv", note: "Supplier, terminal, product, and price columns" },
  { name: "Valero PDF price notice", href: "/samples/valero-rack-notice.pdf", note: "Terminal headings with product and price lines" },
  { name: "Motiva Excel sheet", href: "/samples/motiva-rack-sheet.xlsx", note: "No supplier column, so choose Motiva when uploading" },
];

export const SAMPLE_VS_LIVE = [
  { feed: "Staff and customer sign-in", today: "Live: built-in accounts, sessions, roles", next: "Password reset and invitations by email" },
  { feed: "Order emails and attachments", today: "Sample inbox (agent/samples/emails.json)", next: "Mailbox connector for Microsoft 365 or Google Workspace" },
  { feed: "Rack prices", today: "Sample feed, or your supplier's sheet uploaded on the Pricing page", next: "A DTN or OPIS rack feed, if you subscribe" },
  { feed: "Market indexes", today: "Sample feed, or EIA daily spot prices once the agent has a free EIA key", next: "A licensed source (OPIS, Argus, CME) if needed" },
  { feed: "Bills of lading", today: "Sample feed", next: "DTN electronic BOLs once DTN credentials and an export arrive" },
  { feed: "QuickBooks", today: "Mock ledger that behaves like the real thing", next: "QuickBooks Online app and sandbox company" },
  { feed: "Carriers", today: "Manual status changes and delivery entry", next: "Carrier APIs where they exist" },
];

export const TRY_TO_BREAK = [
  "Sign in as Elena (billing) and try to approve an invoice, on the Billing page and through the copilot. Both should refuse.",
  "Upload the same rack sheet twice. The second import should say every posting was already imported.",
  "Pull the BOL feed twice. The second pull should report duplicates and add nothing.",
  "Approve the intake draft whose customer did not match. The card should make you pick a customer first.",
  "Type a wrong password five times. The sixth attempt should be refused for 15 minutes even with the right password.",
  "Ask the copilot to create an order or approve an invoice. It must show a confirmation card and wait for you; it should never just do it.",
  "Try to dispatch an order that is on credit hold. It should be blocked until the hold is released.",
  "Enter a rack price of 0, or a new password shorter than 10 characters.",
  "Sign in to the customer portal and look for any price, rack, or margin. None should appear.",
  "Refresh a page mid-task and sign out from another tab. The workspace should send you back to sign-in, not show stale data.",
];

export const KNOWN_GAPS = [
  "No password reset yet. If you change your password and forget it, an administrator has to reset it in the database.",
  "The demo data can be reset between rounds by the admin account. Anything you entered may disappear; your login and password stay.",
  "Feeds are samples unless the page says otherwise. Rack sheet uploads always import what you give them; the market feed is live only when the agent has an EIA key.",
  "Tax rates, freight lanes, and customer terms are sample values. Do not rely on invoice totals.",
  "The forecast is a simple momentum model. Its backtested hit rate is shown so you can weigh it.",
  "One instance, no backups yet. Keep real customer data out until backups are in place.",
  "The copilot needs the model key on the server. If it answers with an error instead of a card, tell us the time and the prompt.",
];

export const REPORTING = [
  "The page you were on and roughly when (every action is stamped with your name and time in the audit trail on the Reports page, so the time lets us find it).",
  "The account you were signed in as.",
  "What you did, what you expected, and what happened instead. A screenshot helps.",
  "For copilot problems, the exact prompt you typed.",
];

export const DATA_CHECKLIST = [
  { item: "One week of BOL exports from DTN or your supplier portals", why: "Finishes the DTN crosswalk (column names, terminal control numbers, carrier codes, product codes) so the BOL feed can go live", format: "CSV or JSON export, or the PDFs you receive" },
  { item: "One daily rack sheet per supplier, as they send it", why: "Tunes the rack sheet upload to your suppliers' layouts and product names", format: "The email attachment, PDF, or portal download" },
  { item: "Twenty real order emails with their attachments", why: "Tunes the intake parser's customer, location, and product matching", format: "Forwarded emails; anonymize customer names if needed" },
  { item: "Your customer list with QuickBooks customer ids, payment terms, and tax status", why: "Replaces the sample customers and prepares the QuickBooks link", format: "QuickBooks customer export (CSV)" },
  { item: "Terminals you lift from and the suppliers at each, plus carriers and lane rates", why: "Replaces the sample network so prices and freight are yours", format: "A short spreadsheet is enough" },
  { item: "Your current pricing rules per customer (basis, differential, freight, fees, tax treatment)", why: "The price board only helps once the rules are real", format: "Whatever you use today, even a screenshot of the sheet" },
  { item: "Who should have staff access, with roles", why: "Replaces the demo accounts", format: "Name, email, role (management, dispatch, pricing, billing, admin)" },
];
