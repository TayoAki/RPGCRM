import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { AGENT_URL, STAFF_COOKIE } from "@/lib/staff-session";

// Who is signed in. A stale cookie is cleared so the next page load goes to sign-in.
export async function GET(req: NextRequest) {
  const token = req.cookies.get(STAFF_COOKIE)?.value;
  if (!token) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  try {
    const res = await fetch(`${AGENT_URL}/auth/me`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    const text = await res.text();
    const out = new NextResponse(text, { status: res.status, headers: { "Content-Type": "application/json" } });
    if (res.status === 401) out.cookies.delete(STAFF_COOKIE);
    return out;
  } catch (e) {
    return NextResponse.json({ error: `agent unreachable: ${(e as Error).message}` }, { status: 502 });
  }
}
