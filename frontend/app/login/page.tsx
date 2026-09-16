"use client";
import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ops/primitives";
import { BRAND, BrandLogo } from "@/components/Logo";
import { safeNextPath } from "@/lib/staff-session";

/** Demo staff accounts (sample data, shared demo password) are listed only when NEXT_PUBLIC_DEMO_ACCOUNTS=1 at build time. */
const SHOW_DEMO = process.env.NEXT_PUBLIC_DEMO_ACCOUNTS === "1";
const DEMO = {
  password: "RPGstaff!2026",
  accounts: [
    { email: "dana@rpgfuel.example", name: "Dana Whitfield", role: "management" },
    { email: "marcus@rpgfuel.example", name: "Marcus Lee", role: "dispatch" },
    { email: "priya@rpgfuel.example", name: "Priya Natarajan", role: "pricing" },
    { email: "elena@rpgfuel.example", name: "Elena Ortiz", role: "billing" },
    { email: "sam@rpgfuel.example", name: "Sam Carter", role: "admin" },
  ],
};

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Sign-in failed");
      // A full navigation so the workspace layout renders with the new session cookie.
      window.location.assign(safeNextPath(new URLSearchParams(window.location.search).get("next")));
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-10 text-foreground">
      <div className="w-full max-w-md space-y-5">
        <div className="flex flex-col items-center gap-3 text-center">
          <BrandLogo height={56} />
          <div>
            <h1 className="font-heading text-xl font-semibold text-brand-navy">Staff sign-in</h1>
            <p className="text-sm text-muted-foreground">{BRAND.product}: orders, pricing, loads, BOLs, billing, and profitability.</p>
          </div>
        </div>
        <Card className="gap-0 p-6">
          <form onSubmit={submit} className="space-y-4">
            <Field label="Email">
              <Input type="email" autoComplete="username" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@royaltypetroleumsgroup.com" />
            </Field>
            <Field label="Password">
              <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            {error ? (
              <div role="alert" className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">
                {error}
              </div>
            ) : null}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </Card>
        {SHOW_DEMO ? (
          <details className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
            <summary className="cursor-pointer font-medium">Demo accounts (sample data)</summary>
            <div className="mt-2 space-y-1">
              {DEMO.accounts.map((a) => (
                <div key={a.email}>
                  <button
                    type="button"
                    className="text-link hover:underline"
                    onClick={() => {
                      setEmail(a.email);
                      setPassword(DEMO.password);
                    }}
                  >
                    {a.name}
                  </button>{" "}
                  <span className="capitalize">({a.role})</span> · {a.email}
                </div>
              ))}
              <div>
                Password for every demo account: <code className="rounded bg-secondary px-1">{DEMO.password}</code>
              </div>
            </div>
          </details>
        ) : null}
        <p className="text-center text-xs text-muted-foreground">
          Customer?{" "}
          <Link className="text-link hover:underline" href="/portal/login">
            Sign in to the customer portal
          </Link>
          . Need staff access or a password reset? Ask your administrator.
        </p>
      </div>
    </main>
  );
}
