import { BRAND, BrandLogo } from "@/components/Logo";

/**
 * Customer-facing chrome: the company's white-lettering logo on its navy, and
 * a footer with the positioning line and contact details from the company site.
 */
export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="bg-brand-navy text-white">
        <div className="mx-auto flex h-24 max-w-5xl items-center justify-between gap-4 px-4">
          <a href={BRAND.site} target="_blank" rel="noreferrer" className="flex items-center" aria-label={BRAND.company}>
            <BrandLogo tone="white" height={64} />
          </a>
          <div className="text-right">
            <div className="font-heading text-sm font-semibold uppercase tracking-[0.08em] text-brand-sky">Customer portal</div>
            <div className="text-xs text-white/70">Orders, deliveries, and invoices</div>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">{children}</main>
      <footer className="border-t border-border bg-card">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-6 text-sm text-muted-foreground md:flex-row md:items-start md:justify-between">
          <div className="max-w-xl">
            <div className="font-heading font-semibold text-brand-navy">{BRAND.company}</div>
            <p className="mt-1">{BRAND.positioning}</p>
          </div>
          <div className="space-y-1 md:text-right">
            <div>
              Sales:{" "}
              <a className="text-link hover:underline" href={`mailto:${BRAND.salesEmail}`}>
                {BRAND.salesEmail}
              </a>
            </div>
            <div>Office: {BRAND.phone}</div>
            <div>{BRAND.city}</div>
            <div>
              <a className="text-link hover:underline" href={BRAND.linkedin} target="_blank" rel="noreferrer">
                LinkedIn
              </a>
              {" · "}
              <a className="text-link hover:underline" href={BRAND.site} target="_blank" rel="noreferrer">
                royaltypetroleumsgroup.com
              </a>
            </div>
          </div>
        </div>
        <div className="border-t border-border px-4 py-3 text-center text-xs text-muted-foreground">© {new Date().getFullYear()} {BRAND.company}. All rights reserved.</div>
      </footer>
    </div>
  );
}
