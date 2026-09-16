"use client";
import { createContext, useContext } from "react";
import { CopilotKit } from "@copilotkit/react-core/v2";
import type { SessionUser } from "@/lib/staff-session";

const SessionContext = createContext<SessionUser | null>(null);

/** The signed-in staff user, verified server-side by the workspace layout. */
export function useSessionUser(): SessionUser {
  const user = useContext(SessionContext);
  if (!user) throw new Error("useSessionUser must be used inside the signed-in workspace");
  return user;
}

export function Providers({ user, children }: { user: SessionUser; children: React.ReactNode }) {
  // No identity is passed to the copilot from the browser: /api/copilotkit
  // attaches the session server-side and the agent resolves the user from it.
  return (
    <SessionContext.Provider value={user}>
      <CopilotKit runtimeUrl="/api/copilotkit" agent="strands_agent" enableInspector={false}>
        {children}
      </CopilotKit>
    </SessionContext.Provider>
  );
}
