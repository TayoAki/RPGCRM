import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { AGENT_URL, PORTAL_COOKIE } from "@/lib/portal-session";

export async function POST(req: NextRequest) {
  const token = req.cookies.get(PORTAL_COOKIE)?.value;
  if (token) {
    try {
      await fetch(`${AGENT_URL}/portal/logout`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    } catch {
      /* the cookie is cleared regardless; the agent purges expired sessions */
    }
  }
  const out = NextResponse.json({ ok: true });
  out.cookies.delete(PORTAL_COOKIE);
  return out;
}
