/* eslint-disable @next/next/no-img-element */
import { cn } from "@/lib/utils";

/**
 * Royalty Petroleums Group brand lockups. Assets come from the company site
 * (royaltypetroleumsgroup.com): the full logo in color (light backgrounds) and
 * white lettering (dark backgrounds), plus the square drop mark.
 */
export const BRAND = {
  company: "Royalty Petroleums Group",
  short: "RPG",
  product: "RPG Fuel Platform",
  tagline: "Fueling Your Journey Forward",
  positioning:
    "Royalty Petroleums Group delivers cost-effective wholesale fuel solutions with reliable supply, competitive pricing, and expert logistics management.",
  phone: "(404) 424-9835",
  salesEmail: "sales@royaltypetroleumsgroup.com",
  city: "Atlanta, GA",
  site: "https://royaltypetroleumsgroup.com/",
  linkedin: "https://www.linkedin.com/company/royaltypetroleumsgroup/",
} as const;

/** Square drop mark, for compact spots (collapsed rail, favicon, avatars). */
export function BrandMark({ className, size = 32 }: { className?: string; size?: number }) {
  return <img src="/brand/mark.png" alt="" aria-hidden width={size} height={size} className={cn("shrink-0 select-none", className)} />;
}

/** Full logo with wordmark and tagline. `tone` picks the lettering for the background it sits on. */
export function BrandLogo({ tone = "color", className, height = 48 }: { tone?: "color" | "white"; className?: string; height?: number }) {
  return (
    <img
      src={tone === "white" ? "/brand/logo-white.png" : "/brand/logo-color.png"}
      alt={BRAND.company}
      height={height}
      width={Math.round(height * 3)}
      className={cn("select-none", className)}
      style={{ height, width: "auto" }}
    />
  );
}

/**
 * Workspace lockup: the drop mark plus the company name and product label set
 * in the brand type, so it stays legible at sidebar widths where the full
 * logo's lettering would be too small to read.
 */
export function Logo({ collapsed = false, className }: { collapsed?: boolean; className?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <BrandMark size={collapsed ? 30 : 34} />
      {!collapsed && (
        <span className="flex min-w-0 flex-col leading-[1.15]">
          {/* Stacked so the full name fits the 224px rail without truncating. */}
          <span className="font-heading text-[12px] font-semibold uppercase tracking-[0.05em] text-brand-navy">Royalty</span>
          <span className="font-heading text-[12px] font-semibold uppercase tracking-[0.05em] text-brand-navy">Petroleums Group</span>
          <span className="mt-0.5 text-[10.5px] font-medium text-brand-blue">Fuel Platform</span>
        </span>
      )}
    </div>
  );
}
