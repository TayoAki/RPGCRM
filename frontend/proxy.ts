import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { STAFF_COOKIE } from "@/lib/staff-session";

/**
 * Staff sign-in gate (AUTH_PLAN Phase 1). Every page and API route needs the
 * staff session cookie except the sign-in page and route, the customer
 * portal (which has its own accounts), and the health check. This is a
 * presence check: the agent verifies the token on every call, and the
 * workspace layout re-verifies it server-side on each page load.
 */
const PUBLIC = [/^\/login$/, /^\/api\/auth\/login$/, /^\/api\/health$/, /^\/portal(\/.*)?$/, /^\/api\/portal(\/.*)?$/];

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (PUBLIC.some((re) => re.test(pathname))) return NextResponse.next();
  if (req.cookies.get(STAFF_COOKIE)?.value) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except Next internals and static files (anything with an extension).
  matcher: ["/((?!_next/|.*\\..*).*)"],
};
