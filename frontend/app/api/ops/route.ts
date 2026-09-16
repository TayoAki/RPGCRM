import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { EMPTY_STATE } from "@/lib/ops";
import { AGENT_URL, STAFF_COOKIE } from "@/lib/staff-session";

// Proxy the agent's ops snapshot for the signed-in user. 401 when the session
// is missing or stale (the workspace then goes to sign-in); an empty snapshot
// with 200 when the agent is unreachable so the workspace renders and fills in later.
export async function GET(req: NextRequest) {
  const token = req.cookies.get(STAFF_COOKIE)?.value;
  if (!token) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  try {
    const res = await fetch(`${AGENT_URL}/ops`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    if (res.status === 401) {
      const out = NextResponse.json({ error: "Please sign in." }, { status: 401 });
      out.cookies.delete(STAFF_COOKIE);
      return out;
    }
    if (!res.ok) return NextResponse.json(EMPTY_STATE);
    const data = await res.json();
    return NextResponse.json(data && Array.isArray(data.customers) ? data : EMPTY_STATE);
  } catch {
    return NextResponse.json(EMPTY_STATE);
  }
}
