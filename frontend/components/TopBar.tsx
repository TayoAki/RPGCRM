"use client";
import { useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { PAGE_TITLES } from "@/lib/navigation";
import { useOpsContext } from "@/components/ops-context";
import { NewOrderSheet } from "@/components/forms/NewOrderSheet";
import { UserMenu } from "@/components/UserMenu";

export function TopBar() {
  const pathname = usePathname();
  const title = PAGE_TITLES[pathname] ?? "RPG Fuel";
  const { refresh, busy } = useOpsContext();
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
        <UserMenu />
      </div>
      <NewOrderSheet open={newOrder} onOpenChange={setNewOrder} />
    </header>
  );
}
