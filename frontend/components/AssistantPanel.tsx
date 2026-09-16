"use client";
import { CopilotSidebar } from "@copilotkit/react-core/v2";

export function AssistantPanel() {
  return (
    <CopilotSidebar
      defaultOpen
      width={420}
      labels={{
        modalHeaderTitle: "RPG Fuel Copilot",
        chatInputPlaceholder: "Ask about prices, orders, loads, billing…",
        chatDisclaimerText: "The copilot drafts and flags; pricing, approvals, and orders always need your confirmation.",
      }}
    />
  );
}
