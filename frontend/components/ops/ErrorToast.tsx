"use client";
import { useOpsContext } from "@/components/ops-context";
import { X } from "lucide-react";

/** Surfaces the last failed action (credit hold, approval gate, validation). */
export function ErrorToast() {
  const { lastError, clearError } = useOpsContext();
  if (!lastError) return null;
  return (
    <div className="absolute bottom-4 left-1/2 z-40 flex max-w-lg -translate-x-1/2 items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900 shadow-lg">
      <div className="min-w-0"><span className="font-medium">Action failed: </span>{lastError}</div>
      <button type="button" onClick={clearError} className="rounded p-0.5 hover:bg-rose-100" aria-label="Dismiss"><X className="h-4 w-4" /></button>
    </div>
  );
}
