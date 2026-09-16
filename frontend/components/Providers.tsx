"use client";
import { useSyncExternalStore } from "react";
import { CopilotKit } from "@copilotkit/react-core/v2";
import { DEFAULT_ACTOR_ID, getActorId } from "@/lib/ops";

function subscribe(cb: () => void) {
  window.addEventListener("rpg-actor-change", cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener("rpg-actor-change", cb);
    window.removeEventListener("storage", cb);
  };
}

/** Reads the acting user (MVP stand-in for a session) and reacts to changes. */
export function useActorId(): string {
  return useSyncExternalStore(subscribe, getActorId, () => DEFAULT_ACTOR_ID);
}

export function Providers({ children }: { children: React.ReactNode }) {
  const actorId = useActorId();
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="strands_agent" enableInspector={false} properties={{ actorId }}>
      {children}
    </CopilotKit>
  );
}
