import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const AGENT_URL = process.env.AGENT_URL ?? "http://localhost:8000";

// Generic proxy for the agent's /ops/* REST routes. Forwards the JSON body and
// the acting user's id; every mutation goes through the same service layer the
// copilot's tools use.
async function forward(req: NextRequest, params: Promise<{ path: string[] }>) {
  const { path } = await params;
  const target = `${AGENT_URL}/ops/${path.join("/")}${req.nextUrl.search}`;
  const init: RequestInit = {
    method: req.method,
    headers: { "Content-Type": "application/json", "x-actor-id": req.headers.get("x-actor-id") ?? "" },
    cache: "no-store",
  };
  if (req.method !== "GET") init.body = await req.text();
  try {
    const res = await fetch(target, init);
    const text = await res.text();
    return new NextResponse(text, { status: res.status, headers: { "Content-Type": "application/json" } });
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
