"use client";
import { CopilotSidebar } from "@copilotkit/react-core/v2";
import { BRAND } from "@/components/Logo";

export function AssistantPanel() {
  return (
    <CopilotSidebar
      defaultOpen
      width={420}
      labels={{
        modalHeaderTitle: `${BRAND.short} Copilot`,
        welcomeMessageText: `${BRAND.tagline}. Ask about today's prices, orders, loads, BOLs, or billing.`,
        chatInputPlaceholder: "Ask about prices, orders, loads, billing…",
        chatDisclaimerText: "The copilot drafts and flags; pricing, approvals, and orders always need your confirmation.",
      }}
    />
  );
}
