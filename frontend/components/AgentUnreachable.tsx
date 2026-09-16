import Link from "next/link";
import { BrandLogo } from "@/components/Logo";

/** Shown instead of the workspace when the agent cannot confirm the session (usually while it is starting). */
export function AgentUnreachable({ message }: { message: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
      <div className="w-full max-w-md space-y-4 rounded-lg border border-border bg-card p-6 text-sm">
        <BrandLogo height={44} />
        <h1 className="font-heading text-lg font-semibold text-brand-navy">The agent is not reachable</h1>
        <p className="text-muted-foreground">
          The workspace could not verify your session because the agent service did not answer ({message}). It may still be starting.
        </p>
        <Link className="inline-block text-link hover:underline" href="/">
          Try again
        </Link>
      </div>
    </main>
  );
}
