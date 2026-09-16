// Single source of truth for chat-driven workspace navigation: the copilot's
// `navigate_to` frontend tool uses PAGE_KEYS as its enum and pageToRoute() to
// resolve the target, so the pages the agent may open and their routes never drift.

export const PAGE_ROUTES = {
  dashboard: "/",
  orders: "/orders",
  loads: "/loads",
  pricing: "/pricing",
  market: "/market",
  bols: "/bols",
  billing: "/billing",
  exceptions: "/exceptions",
  customers: "/customers",
  network: "/network",
  reports: "/reports",
} as const;

export type PageKey = keyof typeof PAGE_ROUTES;

export const PAGE_KEYS = Object.keys(PAGE_ROUTES) as [PageKey, ...PageKey[]];

export const PAGE_TITLES: Record<string, string> = {
  "/": "Dashboard",
  "/orders": "Orders & Intake",
  "/loads": "Loads",
  "/pricing": "Pricing",
  "/market": "Market",
  "/bols": "Bills of Lading",
  "/billing": "Billing",
  "/exceptions": "Exceptions",
  "/customers": "Customers",
  "/network": "Suppliers, Terminals & Carriers",
  "/reports": "Reports",
};

export function pageToRoute(page: string): string {
  return (PAGE_ROUTES as Record<string, string>)[page] ?? "/";
}
