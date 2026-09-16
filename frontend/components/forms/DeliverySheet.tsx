"use client";
import { useState } from "react";
import { useOpsContext } from "@/components/ops-context";
import { Field, FormSheet, Input } from "@/components/ops/primitives";

export function DeliverySheet({ loadId, open, onOpenChange }: { loadId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { state, act, busy } = useOpsContext();
  const load = state.loads.find((l) => l.id === loadId);
  const bol = load?.bolId ? state.bols.find((b) => b.id === load.bolId) : undefined;
  const [gallons, setGallons] = useState(String(bol?.lines.reduce((s, l) => s + l.netGallons, 0) ?? load?.plannedGallons ?? 0));
  const [receiver, setReceiver] = useState("");
  const [ticket, setTicket] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setError(null);
    try {
      await act(`loads/${loadId}/delivery`, { deliveredGallons: Number(gallons), receiverName: receiver, ticketNumber: ticket });
      onOpenChange(false);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <FormSheet open={open} onOpenChange={onOpenChange} title={`Record delivery · ${load?.loadNumber ?? ""}`} description="Proof of delivery from the driver's ticket. Marks the load and its order delivered." onSubmit={submit} submitLabel="Record delivery" busy={busy === `loads/${loadId}/delivery`} error={error}>
      <Field label="Delivered gallons"><Input type="number" min={1} value={gallons} onChange={(e) => setGallons(e.target.value)} required /></Field>
      <Field label="Receiver name"><Input value={receiver} onChange={(e) => setReceiver(e.target.value)} required /></Field>
      <Field label="Ticket number"><Input value={ticket} onChange={(e) => setTicket(e.target.value)} required /></Field>
    </FormSheet>
  );
}
