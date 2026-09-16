"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ops/primitives";

/** Demo accounts seeded with the sample data (one per customer, shared demo password). */
const DEMO = { password: "RPGportal!2026", emails: ["orders@lonestaraggregates.com", "fuel@quickstopmarkets.com", "dispatch@prairietrucking.com", "agrant@trinityriverco.example"] };

export default function PortalLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/portal/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Sign-in failed");
      router.replace("/portal");
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };
  return (
    <div className="mx-auto max-w-md space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Sign in to your account</h1>
        <p className="text-sm text-muted-foreground">Track your orders, deliveries, and invoices with Royalty Petroleums Group.</p>
      </div>
      <Card className="gap-0 p-6">
        <form onSubmit={submit} className="space-y-4">
          <Field label="Email"><Input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" /></Field>
          <Field label="Password"><Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          {error ? <div role="alert" className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</div> : null}
          <Button type="submit" className="w-full" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</Button>
        </form>
      </Card>
      <details className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
        <summary className="cursor-pointer font-medium">Demo accounts (sample data)</summary>
        <div className="mt-2 space-y-1">
          {DEMO.emails.map((e) => <div key={e}><button type="button" className="text-link hover:underline" onClick={() => { setEmail(e); setPassword(DEMO.password); }}>{e}</button></div>)}
          <div>Password for every demo account: <code className="rounded bg-secondary px-1">{DEMO.password}</code></div>
        </div>
      </details>
      <p className="text-xs text-muted-foreground">Need an account or a password reset? Email sales@royaltypetroleumsgroup.com or call (404) 424-9835.</p>
    </div>
  );
}
