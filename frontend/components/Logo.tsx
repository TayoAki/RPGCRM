import { Fuel } from "lucide-react";
import { cn } from "@/lib/utils";

/** RPG Fuel brand mark: rounded badge with a fuel pump and an optional wordmark. */
export function Logo({ collapsed = false, className }: { collapsed?: boolean; className?: string }) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span aria-hidden className="grid h-7 w-7 shrink-0 place-items-center rounded-[0.5rem] bg-primary text-primary-foreground shadow-sm">
        <Fuel className="h-4 w-4" strokeWidth={2} />
      </span>
      {!collapsed && <span className="text-base font-semibold tracking-tight">RPG Fuel</span>}
    </div>
  );
}
