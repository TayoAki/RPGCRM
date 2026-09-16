import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { AGENT_URL, STAFF_COOKIE } from "@/lib/staff-session";

// Change the signed-in user's password (current password required; other sessions are revoked by the agent).
export async function POST(req: NextRequest) {
  const token = req.cookies.get(STAFF_COOKIE)?.value;
  if (!token) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const body = await req.text();
  try {
    const res = await fetch(`${AGENT_URL}/auth/password`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body, cache: "no-store" });
    const text = await res.text();
    const out = new NextResponse(text, { status: res.status, headers: { "Content-Type": "application/json" } });
    if (res.status === 401) out.cookies.delete(STAFF_COOKIE);
    return out;
  } catch (e) {
    return NextResponse.json({ error: `agent unreachable: ${(e as Error).message}` }, { status: 502 });
  }
}
