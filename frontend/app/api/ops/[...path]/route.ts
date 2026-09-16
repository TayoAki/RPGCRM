import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { AGENT_URL, STAFF_COOKIE } from "@/lib/staff-session";

// Generic proxy for the agent's /ops/* REST routes. Forwards the JSON body with
// the staff session as a bearer token; the agent attributes every mutation to
// that session's user (nothing the browser sends about identity is trusted).
async function forward(req: NextRequest, params: Promise<{ path: string[] }>) {
  const token = req.cookies.get(STAFF_COOKIE)?.value;
  if (!token) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const { path } = await params;
  const target = `${AGENT_URL}/ops/${path.join("/")}${req.nextUrl.search}`;
  const init: RequestInit = {
    method: req.method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    cache: "no-store",
  };
  if (req.method !== "GET") init.body = await req.text();
  try {
    const res = await fetch(target, init);
    const text = await res.text();
    const out = new NextResponse(text, { status: res.status, headers: { "Content-Type": "application/json" } });
    if (res.status === 401) out.cookies.delete(STAFF_COOKIE);
    return out;
  } catch (e) {
    return NextResponse.json({ error: `agent unreachable: ${(e as Error).message}` }, { status: 502 });
  }
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return forward(req, ctx.params);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return forward(req, ctx.params);
}
