"use client";
import { useState } from "react";
import { Plus, ChevronDown, RefreshCw } from "lucide-react";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PAGE_TITLES } from "@/lib/navigation";
import { setActorId } from "@/lib/ops";
import { useOpsContext } from "@/components/ops-context";
import { useActorId } from "@/components/Providers";
import { NewOrderSheet } from "@/components/forms/NewOrderSheet";

export function TopBar() {
  const pathname = usePathname();
  const title = PAGE_TITLES[pathname] ?? (pathname.startsWith("/portal") ? "Customer Portal" : "RPG Fuel");
  const { state, refresh, busy } = useOpsContext();
  const actorId = useActorId();
  const actor = state.staff.find((u) => u.id === actorId);
  const [newOrder, setNewOrder] = useState(false);
  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-border bg-card px-6">
      <h1 className="text-sm font-semibold">{title}</h1>
      <div className="ml-auto flex items-center gap-2">
        <Button size="sm" variant="ghost" onClick={() => void refresh()} disabled={!!busy} title="Refresh data">
          <RefreshCw className="h-4 w-4" />
        </Button>
        <Button size="sm" className="gap-1.5" onClick={() => setNewOrder(true)}>
          <Plus className="h-4 w-4" /> New order
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" className="gap-1.5">
              <span className="max-w-[140px] truncate">{actor ? actor.name : "Acting as…"}</span>
              <ChevronDown className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel>Acting as (until sign-in lands)</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {state.staff.map((u) => (
              <DropdownMenuItem key={u.id} onClick={() => setActorId(u.id)} className="flex items-center justify-between">
                <span>{u.name}</span>
                <span className="text-xs capitalize text-muted-foreground">{u.role}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <NewOrderSheet open={newOrder} onOpenChange={setNewOrder} />
    </header>
  );
}
