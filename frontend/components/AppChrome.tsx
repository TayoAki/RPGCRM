"use client";
import { OpsProvider, useOpsContext } from "./ops-context";
import { useCopilotFeatures } from "@/hooks/use-copilot-features";
import { NavRail } from "./NavRail";
import { TopBar } from "./TopBar";
import { AssistantPanel } from "./AssistantPanel";
import { OrderDrawer } from "./drawers/OrderDrawer";
import { LoadDrawer } from "./drawers/LoadDrawer";
import { ErrorToast } from "./ops/ErrorToast";

function Shell({ children }: { children: React.ReactNode }) {
  const { selectedOrderId, setSelectedOrderId, selectedLoadId, setSelectedLoadId } = useOpsContext();
  useCopilotFeatures({ setSelectedOrderId, setSelectedLoadId });
  return (
    <div className="flex h-screen bg-background text-foreground">
      <NavRail />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="relative min-h-0 flex-1 overflow-hidden">
          {children}
          <OrderDrawer orderId={selectedOrderId} onClose={() => setSelectedOrderId(null)} />
          <LoadDrawer loadId={selectedLoadId} onClose={() => setSelectedLoadId(null)} />
          <ErrorToast />
        </main>
      </div>
      <AssistantPanel />
    </div>
  );
}

export function AppChrome({ children }: { children: React.ReactNode }) {
  return (
    <OpsProvider>
      <Shell>{children}</Shell>
    </OpsProvider>
  );
}
