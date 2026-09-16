"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, Inbox, Truck, Tags, TrendingUp, FileText, Receipt, AlertTriangle, Building2, Factory, BarChart3,
  PanelLeftClose, PanelLeftOpen, UserCircle2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/Logo";
import { useSidebarCollapsed } from "@/hooks/use-sidebar-collapsed";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useOpsContext } from "@/components/ops-context";
import { useActorId } from "@/components/Providers";
import { openExceptions } from "@/lib/ops";

type NavItem = { label: string; href: string; icon: LucideIcon; badge?: (n: { exceptions: number; intake: number; approvals: number }) => number };

const NAV: NavItem[] = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard },
  { label: "Orders & Intake", href: "/orders", icon: Inbox, badge: (n) => n.intake },
  { label: "Loads", href: "/loads", icon: Truck },
  { label: "Pricing", href: "/pricing", icon: Tags },
  { label: "Market", href: "/market", icon: TrendingUp },
  { label: "Bills of Lading", href: "/bols", icon: FileText },
  { label: "Billing", href: "/billing", icon: Receipt, badge: (n) => n.approvals },
  { label: "Exceptions", href: "/exceptions", icon: AlertTriangle, badge: (n) => n.exceptions },
  { label: "Customers", href: "/customers", icon: Building2 },
  { label: "Network", href: "/network", icon: Factory },
  { label: "Reports", href: "/reports", icon: BarChart3 },
];

export function NavRail() {
  const pathname = usePathname();
  const { collapsed, toggle } = useSidebarCollapsed();
  const { state } = useOpsContext();
  const actorId = useActorId();
  const actor = state.staff.find((u) => u.id === actorId);
  const counts = {
    exceptions: openExceptions(state).length,
    intake: state.emailIntakes.filter((e) => e.reviewStatus === "pending").length,
    approvals: state.invoices.filter((i) => i.status === "pending_approval").length,
  };
  return (
    <TooltipProvider delayDuration={0}>
      <aside className={cn("hidden shrink-0 flex-col border-r border-border bg-card transition-[width] duration-200 md:flex", collapsed ? "w-[64px]" : "w-[224px]")}>
        <div className={cn("flex h-14 items-center", collapsed ? "justify-center px-0" : "px-4")}>
          <Logo collapsed={collapsed} />
        </div>
        <nav className={cn("flex flex-col gap-1 py-2", collapsed ? "px-2" : "px-3")}>
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            const badge = item.badge?.(counts) ?? 0;
            const link = (
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition",
                  collapsed && "justify-center px-0",
                  active ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
                {!collapsed && badge > 0 && (
                  <span className="rounded-full bg-primary/10 px-1.5 text-[11px] font-medium text-primary tabular-nums">{badge}</span>
                )}
              </Link>
            );
            return collapsed ? (
              <Tooltip key={item.href}>
                <TooltipTrigger asChild>{link}</TooltipTrigger>
                <TooltipContent side="right">{item.label}{badge > 0 ? ` (${badge})` : ""}</TooltipContent>
              </Tooltip>
            ) : (
              <div key={item.href}>{link}</div>
            );
          })}
        </nav>
        <div className={cn("mt-auto flex flex-col gap-1 border-t border-border py-2", collapsed ? "px-2" : "px-3")}>
          <div className={cn("flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground", collapsed && "justify-center px-0")} title={actor ? `${actor.name} · ${actor.role}` : undefined}>
            <UserCircle2 className="h-4 w-4 shrink-0" />
            {!collapsed && (
              <div className="min-w-0 leading-tight">
                <div className="truncate text-foreground">{actor?.name ?? "—"}</div>
                <div className="truncate text-[11px] capitalize">{actor?.role ?? "acting user"}</div>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={toggle}
            className={cn("flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground transition hover:bg-secondary hover:text-foreground", collapsed && "justify-center px-0")}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
            {!collapsed && "Collapse"}
          </button>
        </div>
      </aside>
    </TooltipProvider>
  );
}
