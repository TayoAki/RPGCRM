import { NextResponse } from "next/server";

// Public liveness check for the Railway health check (the workspace itself redirects to sign-in).
export function GET() {
  return NextResponse.json({ ok: true });
}
