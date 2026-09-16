import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { AGENT_URL, PORTAL_COOKIE } from "@/lib/portal-session";

// The signed-in customer's portal data. The agent scopes everything by the session.
export async function GET(req: NextRequest) {
  const token = req.cookies.get(PORTAL_COOKIE)?.value;
  if (!token) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  try {
    const res = await fetch(`${AGENT_URL}/portal/me`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    const text = await res.text();
    const out = new NextResponse(text, { status: res.status, headers: { "Content-Type": "application/json" } });
    if (res.status === 401) out.cookies.delete(PORTAL_COOKIE);
    return out;
  } catch (e) {
    return NextResponse.json({ error: `agent unreachable: ${(e as Error).message}` }, { status: 502 });
  }
}
