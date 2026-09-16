"use client";
import { useSyncExternalStore } from "react";
import Link from "next/link";
import { BookOpen, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WALKTHROUGH } from "@/lib/guide";

const KEY = "rpg.startHere.dismissed";
const EVENT = "rpg-start-here";

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}
function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

/** Dashboard panel for testers: the walkthrough in order, with a link to the full guide. Dismissed per browser. */
export function StartHere() {
  // Hidden during server rendering; the client shows it unless this browser dismissed it.
  const dismissed = useSyncExternalStore(subscribe, readDismissed, () => true);
  if (dismissed) return null;
  const dismiss = () => {
    try {
      window.localStorage.setItem(KEY, "1");
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new Event(EVENT));
  };
  return (
    <section className="rounded-xl border border-brand-blue/30 bg-brand-sky/20 p-4" aria-label="Start here">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-heading text-sm font-semibold text-brand-navy">
            <BookOpen className="h-4 w-4" /> Start here
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            You are signed in and the data is a sample. Try these in order; each one takes a minute. The copilot on the right can run most of them from a sentence.
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={dismiss} aria-label="Dismiss the start-here panel">
          <X className="h-4 w-4" />
        </Button>
      </div>
      <ol className="mt-3 grid gap-2 text-sm @2xl:grid-cols-2 @5xl:grid-cols-3">
        {WALKTHROUGH.slice(0, 6).map((s, i) => (
          <li key={s.href} className="flex gap-2 rounded-lg border border-border bg-card px-3 py-2">
            <span className="font-heading text-xs font-semibold text-brand-blue">{i + 1}</span>
            <div className="min-w-0">
              <Link href={s.href} className="font-medium text-foreground hover:underline">
                {s.title}
              </Link>
              <div className="text-xs text-muted-foreground">{s.body.split(". ")[0]}.</div>
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-3 text-xs text-muted-foreground">
        <Link href="/guide" className="text-link hover:underline">
          Full guide
        </Link>
        : accounts, what is sample and what is live, things to try to break, how to report, and what real data to bring.
      </div>
    </section>
  );
}
