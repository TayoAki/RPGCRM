import { NextResponse } from "next/server";
import { EMPTY_STATE } from "@/lib/ops";

const AGENT_URL = process.env.AGENT_URL ?? "http://localhost:8000";

// Proxy the agent's ops snapshot. If the agent is unreachable, return an
// empty snapshot with 200 so the workspace renders and fills in later.
export async function GET() {
  try {
    const res = await fetch(`${AGENT_URL}/ops`, { cache: "no-store" });
    if (!res.ok) return NextResponse.json(EMPTY_STATE);
    const data = await res.json();
    return NextResponse.json(data && Array.isArray(data.customers) ? data : EMPTY_STATE);
  } catch {
    return NextResponse.json(EMPTY_STATE);
  }
}
