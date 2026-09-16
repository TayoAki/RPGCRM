"use client";
import { useState } from "react";
import { useOpsContext } from "@/components/ops-context";
import { Field, FormSheet, Input } from "@/components/ops/primitives";
import type { OpsException } from "@/lib/domain";

export function ResolveExceptionSheet({ exception, open, onOpenChange }: { exception: OpsException | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { act, busy } = useOpsContext();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (!exception) return;
    setError(null);
    try {
      await act(`exceptions/${exception.id}/resolve`, { note });
      onOpenChange(false);
      setNote("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <FormSheet open={open} onOpenChange={onOpenChange} title="Resolve exception" description={exception?.message} onSubmit={submit} submitLabel="Mark resolved" busy={!!busy} error={error}>
      <Field label="What was done?"><Input value={note} onChange={(e) => setNote(e.target.value)} required placeholder="Supplier resent the BOL; matched to LD-505." /></Field>
    </FormSheet>
  );
}
