# RPG Fuel Platform: tester guide

This is the same content as the **Start here** panel on the dashboard and the
`/guide` page in the app, for people who prefer a document. It covers signing
in, what is sample and what is live, a ten-minute walkthrough, things to try to
break, how to report what you find, and what real data to bring so the feeds
can go live.

Site: the frontend's public URL (ask the project owner), sign-in page `/login`.

## 1. Sign in

Every staff account uses the demo password `RPGstaff!2026` until its owner
changes it from the account menu (top right). Roles decide what you can
approve.

| Account | Email | Role | Try it for |
| --- | --- | --- | --- |
| Dana Whitfield | dana@rpgfuel.example | management | Approves invoices; the full walkthrough works from here |
| Marcus Lee | marcus@rpgfuel.example | dispatch | Loads, deliveries, BOL matching |
| Priya Natarajan | priya@rpgfuel.example | pricing | Rack sheets, rules, quotes, the market feed |
| Elena Ortiz | elena@rpgfuel.example | billing | Prepares invoices, cannot approve them |
| Sam Carter | sam@rpgfuel.example | admin | The only account that can reset the demo data |

Customers sign in separately at `/portal/login`. Every customer has one account
for its ordering contact (for example `orders@lonestaraggregates.com`) with the
demo password `RPGportal!2026`.

## 2. What is sample and what is live

| Feed | Today | Next |
| --- | --- | --- |
| Staff and customer sign-in | Live: built-in accounts, sessions, roles | Password reset and invitations by email |
| Order emails and attachments | Sample inbox | Mailbox connector for Microsoft 365 or Google Workspace |
| Rack prices | Sample feed, or your supplier's sheet uploaded on the Pricing page | A DTN or OPIS rack feed, if you subscribe |
| Market indexes | Sample feed, or EIA daily spot prices once the agent has a free EIA key | A licensed source (OPIS, Argus, CME) if needed |
| Bills of lading | Sample feed | DTN electronic BOLs once DTN credentials and an export arrive |
| QuickBooks | Mock ledger that behaves like the real thing | QuickBooks Online app and sandbox company |
| Carriers | Manual status changes and delivery entry | Carrier APIs where they exist |

The Bills of Lading and Market pages say which source is active on this
deployment and when it last ran; so does section 2 of the in-app guide.

## 3. Ten-minute walkthrough

1. **Dashboard** (`/`): today's numbers, 14-day gallons, market movement, and
   what needs attention. Copilot: *"Give me the daily brief."*
2. **Run email intake** (`/orders`): nine sample emails become twelve drafts,
   six from email bodies and the rest from an attached CSV schedule, an Excel
   sheet, and a PDF purchase order. Open the queue, fix the one with no
   matching customer, approve the rest. Each approval becomes an order.
   Copilot: *"Run email intake and show me what came in."*
3. **Bring in rack prices** (`/pricing`): press **Import rack feed** for today's
   sample postings, then **Upload rack sheet** with one of the sample sheets
   (or your supplier's real one). The price board recalculates. Upload the
   same sheet twice: the second time nothing new is imported. Copilot: *"What's
   today's price for Lone Star Aggregates on ULSD, 7,500 gallons?"*
4. **Dispatch a load** (`/loads`): create a load for a confirmed order, then
   drag it Planned → Dispatched → Loading → In Transit. Record the delivery
   ticket from the load drawer.
5. **Pull BOLs** (`/bols`): three bills of lading match loads automatically,
   one is a duplicate, one needs a manual match. Pull again and the duplicates
   are reported, not re-added. Copilot: *"Pull the BOL feed and match them to
   loads."*
6. **Bill and approve** (`/billing`): press **Prepare invoices**. Only
   management or admin can approve; billing is refused. Then **Sync
   QuickBooks**: invoices get ids and the sample payments are applied.
   Copilot: *"Prepare invoices for the loads that are ready to bill."*
7. **Work the exceptions** (`/exceptions`): the low-margin load, the missing
   BOL, and the unpriced order show up here and in the daily brief. Resolve
   one with a note. Copilot: *"What needs attention right now?"*
8. **Market and reports** (`/market`, `/reports`): refresh the market feed and
   look at the forecast hit rate. Reports has profitability by customer and by
   load, and totals by day, week, and month.
9. **See what a customer sees** (`/portal/login`): sign in as
   `orders@lonestaraggregates.com` in another tab: orders, deliveries, and
   invoices for that customer only, and no prices.

Sample rack sheets for step 3 (also downloadable from the upload form):

| File | What it shows |
| --- | --- |
| `marathon-rack-sheet.csv` | Supplier, terminal, product, and price columns |
| `valero-rack-notice.pdf` | Terminal headings with product and price lines |
| `motiva-rack-sheet.xlsx` | No supplier column, so choose Motiva when uploading |

## 4. Things to try to break

- Sign in as Elena (billing) and try to approve an invoice, on the Billing page
  and through the copilot. Both should refuse.
- Upload the same rack sheet twice. The second import should say every posting
  was already imported.
- Pull the BOL feed twice. The second pull should report duplicates and add
  nothing.
- Approve the intake draft whose customer did not match. The card should make
  you pick a customer first.
- Type a wrong password five times. The sixth attempt should be refused for 15
  minutes even with the right password.
- Ask the copilot to create an order or approve an invoice. It must show a
  confirmation card and wait for you; it should never just do it.
- Try to dispatch an order that is on credit hold. It should be blocked until
  the hold is released.
- Enter a rack price of 0, or a new password shorter than 10 characters.
- Sign in to the customer portal and look for any price, rack, or margin. None
  should appear.
- Refresh a page mid-task and sign out from another tab. The workspace should
  send you back to sign-in, not show stale data.

## 5. Known gaps (do not report these)

- No password reset yet. If you change your password and forget it, an
  administrator has to reset it in the database.
- The demo data can be reset between rounds by the admin account. Anything you
  entered may disappear; your login and password stay.
- Feeds are samples unless the page says otherwise. Rack sheet uploads always
  import what you give them; the market feed is live only when the agent has
  an EIA key.
- Tax rates, freight lanes, and customer terms are sample values. Do not rely
  on invoice totals.
- The forecast is a simple momentum model. Its backtested hit rate is shown so
  you can weigh it.
- One instance, no backups yet. Keep real customer data out until backups are
  in place.
- The copilot needs the model key on the server. If it answers with an error
  instead of a card, tell us the time and the prompt.

## 6. How to report what you find

Send a short note to the project owner with:

- The page you were on and roughly when. Every action is stamped with your
  name and time in the audit trail on the Reports page, so the time lets us
  find it.
- The account you were signed in as.
- What you did, what you expected, and what happened instead. A screenshot
  helps.
- For copilot problems, the exact prompt you typed.

## 7. Bring your real data

These turn the sample feeds into your feeds. None of it needs to be perfect; a
week of real files is enough to start.

| What | Why | Format |
| --- | --- | --- |
| One week of BOL exports from DTN or your supplier portals | Finishes the DTN crosswalk (column names, terminal control numbers, carrier codes, product codes) so the BOL feed can go live | CSV or JSON export, or the PDFs you receive |
| One daily rack sheet per supplier, as they send it | Tunes the rack sheet upload to your suppliers' layouts and product names | The email attachment, PDF, or portal download |
| Twenty real order emails with their attachments | Tunes the intake parser's customer, location, and product matching | Forwarded emails; anonymize customer names if needed |
| Your customer list with QuickBooks customer ids, payment terms, and tax status | Replaces the sample customers and prepares the QuickBooks link | QuickBooks customer export (CSV) |
| Terminals you lift from and the suppliers at each, plus carriers and lane rates | Replaces the sample network so prices and freight are yours | A short spreadsheet is enough |
| Your current pricing rules per customer (basis, differential, freight, fees, tax treatment) | The price board only helps once the rules are real | Whatever you use today, even a screenshot of the sheet |
| Who should have staff access, with roles | Replaces the demo accounts | Name, email, role (management, dispatch, pricing, billing, admin) |

What each vendor integration needs beyond this is in
[INTEGRATIONS.md](./INTEGRATIONS.md).
