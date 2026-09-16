"use client";
import { useCallback, useEffect, useState } from "react";
import { useAgent, UseAgentUpdate } from "@copilotkit/react-core/v2";
import type { OpsState } from "@/lib/domain";
import { EMPTY_STATE, getActorId, isOpsState } from "@/lib/ops";

/**
 * Operational state for the workspace. Two feeds merge into one snapshot:
 * the agent's shared state (STATE_SNAPSHOT after copilot tool calls) and
 * GET /api/ops after UI-initiated actions. `act()` posts to the agent's REST
 * routes through the Next.js proxy with the acting user's id.
 */
export function useOps() {
  const { agent } = useAgent({ agentId: "strands_agent", updates: [UseAgentUpdate.OnStateChanged] });
  const [state, setState] = useState<OpsState | null>(null);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [selectedLoadId, setSelectedLoadId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/ops", { cache: "no-store" });
      const s = (await r.json()) as unknown;
      if (isOpsState(s)) {
        setState(s);
        setVersion((v) => v + 1);
      }
    } catch {
      /* agent may be starting; keep the last snapshot */
    }
  }, []);

  useEffect(() => {
    // Initial fetch on mount; refresh() only sets state after the response arrives.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const agentState = agent?.state as unknown;
  useEffect(() => {
    if (isOpsState(agentState)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState(agentState);
      setVersion((v) => v + 1);
    }
  }, [agentState]);

  const act = useCallback(
    async <T = unknown,>(path: string, body?: unknown, method: "POST" | "GET" = "POST"): Promise<T> => {
      setBusy(path);
      setLastError(null);
      try {
        const r = await fetch(`/api/ops/${path}`, {
          method,
          headers: { "Content-Type": "application/json", "x-actor-id": getActorId() },
          body: method === "GET" || body === undefined ? undefined : JSON.stringify(body),
          cache: "no-store",
        });
        const j = (await r.json()) as T & { error?: string };
        if (!r.ok) throw new Error(j?.error ?? r.statusText);
        if (method === "POST") await refresh();
        return j;
      } catch (e) {
        setLastError((e as Error).message);
        throw e;
      } finally {
        setBusy(null);
      }
    },
    [refresh],
  );

  return {
    state: state ?? EMPTY_STATE,
    loading: state === null,
    version,
    refresh,
    act,
    busy,
    lastError,
    clearError: () => setLastError(null),
    selectedOrderId,
    setSelectedOrderId,
    selectedLoadId,
    setSelectedLoadId,
  };
}

export type OpsApi = ReturnType<typeof useOps>;
