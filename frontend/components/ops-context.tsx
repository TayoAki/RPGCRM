"use client";
import { createContext, useContext } from "react";
import { useOps } from "@/hooks/use-ops";
import type { OpsApi } from "@/hooks/use-ops";

const OpsContext = createContext<OpsApi | null>(null);

export function OpsProvider({ children }: { children: React.ReactNode }) {
  const value = useOps();
  return <OpsContext.Provider value={value}>{children}</OpsContext.Provider>;
}

export function useOpsContext(): OpsApi {
  const ctx = useContext(OpsContext);
  if (!ctx) throw new Error("useOpsContext must be used within OpsProvider");
  return ctx;
}
