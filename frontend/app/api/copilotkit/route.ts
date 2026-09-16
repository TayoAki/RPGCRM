import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { HttpAgent } from "@ag-ui/client";
import { NextRequest, NextResponse } from "next/server";
import { AGENT_URL, STAFF_COOKIE } from "@/lib/staff-session";

const serviceAdapter = new ExperimentalEmptyAdapter();

// Module scope on purpose: per-request runtimes have raced in other CopilotKit apps.
const runtime = new CopilotRuntime({
  agents: {
    strands_agent: new HttpAgent({ url: AGENT_URL }),
  },
});

/**
 * Copilot requests reach the agent with the staff session as a bearer token.
 * The runtime clones the HttpAgent per request and forwards the request's
 * Authorization header, so the token travels server-side: the browser only
 * holds the httpOnly cookie, and any Authorization or identity header it
 * sends is replaced here by the verified session.
 */
export const POST = async (req: NextRequest) => {
  const token = req.cookies.get(STAFF_COOKIE)?.value;
  if (!token) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const headers = new Headers(req.headers);
  headers.set("authorization", `Bearer ${token}`);
  headers.delete("x-actor-id");
  const authed = new NextRequest(req.url, { method: req.method, headers, body: await req.text() });
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    serviceAdapter,
    endpoint: "/api/copilotkit",
  });
  return handleRequest(authed);
};
