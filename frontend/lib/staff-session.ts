import type { StaffRole } from "@/lib/domain";

/** Name of the httpOnly cookie that carries the staff session token. */
export const STAFF_COOKIE = "rpg_staff_session";
export const AGENT_URL = process.env.AGENT_URL ?? "http://localhost:8000";

/** The signed-in staff user as the agent describes it (never credentials). */
export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: StaffRole;
}

export type SessionCheck =
  | { status: "ok"; user: SessionUser; expiresAt: string }
  | { status: "unauthenticated" }
  | { status: "unreachable"; message: string };

/** Ask the agent who a session token belongs to. Server-side only. */
export async function verifyStaffSession(token: string | undefined): Promise<SessionCheck> {
  if (!token) return { status: "unauthenticated" };
  try {
    const res = await fetch(`${AGENT_URL}/auth/me`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    if (res.status === 401) return { status: "unauthenticated" };
    if (!res.ok) return { status: "unreachable", message: `agent returned ${res.status}` };
    const data = (await res.json()) as { user: SessionUser; session: { expiresAt: string } };
    return { status: "ok", user: data.user, expiresAt: data.session.expiresAt };
  } catch (e) {
    return { status: "unreachable", message: (e as Error).message };
  }
}

/** Only same-site relative paths are accepted as a post-sign-in destination. */
export function safeNextPath(next: string | null | undefined): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/login") ? next : "/";
}

export function staffCookieOptions(expiresAt?: string) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt ? new Date(expiresAt) : undefined,
  };
}
