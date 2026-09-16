"use client";
import { useState } from "react";
import { ChevronDown, KeyRound, LogOut, UserCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Field, FormSheet, Input } from "@/components/ops/primitives";
import { useSessionUser } from "@/components/Providers";

/** The signed-in user, with password change and sign-out. Replaces the pre-auth "acting as" switcher. */
export function UserMenu() {
  const user = useSessionUser();
  const [changing, setChanging] = useState(false);
  const signOut = async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    // A full navigation so nothing from this session stays in the client router cache.
    window.location.assign("/login");
  };
  return (
    <>
      {/* Non-modal: the modal scroll lock double-counts the copilot sidebar's body margin and squeezes the workspace while open. */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" className="gap-1.5" aria-label="Account menu">
            <UserCircle2 className="h-4 w-4" />
            <span className="max-w-[160px] truncate">{user.name}</span>
            <ChevronDown className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="font-normal">
            <div className="truncate font-medium text-foreground">{user.name}</div>
            <div className="truncate text-xs text-muted-foreground">{user.email}</div>
            <div className="text-xs capitalize text-muted-foreground">{user.role}</div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setChanging(true)}>
            <KeyRound className="h-4 w-4" /> Change password
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => void signOut()}>
            <LogOut className="h-4 w-4" /> Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ChangePasswordSheet open={changing} onOpenChange={setChanging} />
    </>
  );
}

function ChangePasswordSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const submit = async () => {
    setError(null);
    setDone(false);
    if (next !== confirm) {
      setError("The new passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const r = await fetch("/api/auth/password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword: current, newPassword: next }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Could not change the password");
      setDone(true);
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <FormSheet
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) {
          setDone(false);
          setError(null);
        }
      }}
      title="Change password"
      description="At least 10 characters. Other devices signed in as you will be signed out."
      onSubmit={submit}
      submitLabel="Update password"
      busy={busy}
      error={error}
    >
      {done ? <div className="rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-800">Password updated.</div> : null}
      <Field label="Current password">
        <Input type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
      </Field>
      <Field label="New password">
        <Input type="password" autoComplete="new-password" required minLength={10} value={next} onChange={(e) => setNext(e.target.value)} />
      </Field>
      <Field label="Confirm new password">
        <Input type="password" autoComplete="new-password" required minLength={10} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </Field>
    </FormSheet>
  );
}
