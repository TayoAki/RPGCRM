import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { AGENT_URL, PORTAL_COOKIE } from "@/lib/portal-session";

// Customer sign-in: the agent checks the password and issues a session token,
// which lives only in an httpOnly cookie. The browser never sees the token.
export async function POST(req: NextRequest) {
  const body = await req.text();
  try {
    const res = await fetch(`${AGENT_URL}/portal/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body, cache: "no-store" });
    const data = (await res.json()) as { token?: string; expiresAt?: string; error?: string; user?: unknown; customer?: unknown };
    if (!res.ok || !data.token) return NextResponse.json({ error: data.error ?? "Sign-in failed" }, { status: res.ok ? 502 : res.status });
    const out = NextResponse.json({ user: data.user, customer: data.customer });
    out.cookies.set(PORTAL_COOKIE, data.token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      expires: data.expiresAt ? new Date(data.expiresAt) : undefined,
    });
    return out;
  } catch (e) {
    return NextResponse.json({ error: `agent unreachable: ${(e as Error).message}` }, { status: 502 });
  }
}
