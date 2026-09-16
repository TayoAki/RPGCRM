"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useOpsContext } from "@/components/ops-context";
import { Page, PageHeader, SectionCard } from "@/components/ops/primitives";
import { DATA_CHECKLIST, DEMO_PORTAL_PASSWORD, DEMO_STAFF_PASSWORD, KNOWN_GAPS, REPORTING, SAMPLE_SHEETS, SAMPLE_VS_LIVE, STAFF_ACCOUNTS, TRY_TO_BREAK, WALKTHROUGH } from "@/lib/guide";

interface SourceStatus {
  kind: string;
  name: string;
  configured: boolean;
  detail?: string;
  lastRun: { finishedAt: string; summary: string } | null;
}

export default function GuidePage() {
  const { act } = useOpsContext();
  const [bol, setBol] = useState<SourceStatus | null>(null);
  const [index, setIndex] = useState<SourceStatus | null>(null);
  useEffect(() => {
    act<SourceStatus>("integrations/bol-source", undefined, "GET").then(setBol).catch(() => undefined);
    act<SourceStatus>("integrations/index-source", undefined, "GET").then(setIndex).catch(() => undefined);
  }, [act]);
  const live = (s: SourceStatus | null) => (s ? `${s.name}${s.configured ? "" : " (not configured)"}` : "…");
  return (
    <Page>
      <PageHeader title="Start here: tester guide" description="What to try, what is sample and what is live, how to break things on purpose, how to report what you find, and what real data to bring so the feeds can go live." />
      <div className="grid gap-4 @4xl:grid-cols-2">
        <SectionCard title="1. Sign in">
          <p className="text-sm text-muted-foreground">Every staff account uses the demo password <code className="rounded bg-secondary px-1">{DEMO_STAFF_PASSWORD}</code> until its owner changes it from the account menu (top right). Roles decide what you can approve.</p>
          <table className="mt-3 w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-1 pr-2">Account</th><th className="py-1 pr-2">Role</th><th className="py-1">Try it for</th></tr></thead>
            <tbody>
              {STAFF_ACCOUNTS.map((a) => (
                <tr key={a.email} className="border-t border-border align-top">
                  <td className="py-1.5 pr-2"><div className="font-medium">{a.name}</div><div className="text-xs text-muted-foreground">{a.email}</div></td>
                  <td className="py-1.5 pr-2 capitalize">{a.role}</td>
                  <td className="py-1.5 text-muted-foreground">{a.tryIt}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-muted-foreground">Customers sign in separately at <Link className="text-link hover:underline" href="/portal/login">/portal/login</Link> (every customer has one account for its ordering contact; demo password <code className="rounded bg-secondary px-1">{DEMO_PORTAL_PASSWORD}</code>).</p>
        </SectionCard>
        <SectionCard title="2. What is sample and what is live right now">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-1 pr-2">Feed</th><th className="py-1 pr-2">Today</th><th className="py-1">Next</th></tr></thead>
            <tbody>
              {SAMPLE_VS_LIVE.map((r) => (
                <tr key={r.feed} className="border-t border-border align-top">
                  <td className="py-1.5 pr-2 font-medium">{r.feed}</td>
                  <td className="py-1.5 pr-2 text-muted-foreground">{r.today}</td>
                  <td className="py-1.5 text-muted-foreground">{r.next}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-3 rounded-md bg-secondary px-3 py-2 text-xs text-muted-foreground">
            <div>BOL source on this deployment: <span className="font-medium text-foreground">{live(bol)}</span>{bol?.lastRun ? ` · last pull: ${bol.lastRun.summary}` : ""}</div>
            <div>Market index source: <span className="font-medium text-foreground">{live(index)}</span>{index?.lastRun ? ` · last refresh: ${index.lastRun.summary}` : ""}</div>
          </div>
        </SectionCard>
      </div>
      <SectionCard title="3. Ten-minute walkthrough">
        <ol className="grid gap-3 @2xl:grid-cols-2 @5xl:grid-cols-3">
          {WALKTHROUGH.map((s, i) => (
            <li key={s.href} className="rounded-lg border border-border p-3 text-sm">
              <div className="flex items-baseline gap-2">
                <span className="font-heading text-xs font-semibold text-brand-blue">{i + 1}</span>
                <Link href={s.href} className="font-medium hover:underline">{s.title}</Link>
              </div>
              <p className="mt-1 text-muted-foreground">{s.body}</p>
              {s.copilot ? <p className="mt-2 text-xs text-muted-foreground">Copilot: <span className="italic">“{s.copilot}”</span></p> : null}
            </li>
          ))}
        </ol>
        <p className="mt-3 text-xs text-muted-foreground">
          Sample rack sheets for step 3:{" "}
          {SAMPLE_SHEETS.map((s, i) => (
            <span key={s.href}>
              {i > 0 ? " · " : ""}
              <a className="text-link hover:underline" href={s.href} download title={s.note}>{s.name}</a>
            </span>
          ))}
          .
        </p>
      </SectionCard>
      <div className="grid gap-4 @4xl:grid-cols-2">
        <SectionCard title="4. Things to try to break">
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">{TRY_TO_BREAK.map((t) => <li key={t}>{t}</li>)}</ul>
        </SectionCard>
        <SectionCard title="5. Known gaps (do not report these)">
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">{KNOWN_GAPS.map((t) => <li key={t}>{t}</li>)}</ul>
        </SectionCard>
        <SectionCard title="6. How to report what you find">
          <p className="text-sm text-muted-foreground">Send a short note to the project owner with:</p>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">{REPORTING.map((t) => <li key={t}>{t}</li>)}</ul>
        </SectionCard>
        <SectionCard title="7. Bring your real data">
          <p className="text-sm text-muted-foreground">These turn the sample feeds into your feeds. None of it needs to be perfect; a week of real files is enough to start.</p>
          <table className="mt-3 w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-1 pr-2">What</th><th className="py-1 pr-2">Why</th><th className="py-1">Format</th></tr></thead>
            <tbody>
              {DATA_CHECKLIST.map((r) => (
                <tr key={r.item} className="border-t border-border align-top">
                  <td className="py-1.5 pr-2 font-medium">{r.item}</td>
                  <td className="py-1.5 pr-2 text-muted-foreground">{r.why}</td>
                  <td className="py-1.5 text-muted-foreground">{r.format}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </SectionCard>
      </div>
    </Page>
  );
}
