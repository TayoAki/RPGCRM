import {
  defineRailway,
  github,
  preserve,
  project,
  service,
  volume,
} from "railway/iac";

/**
 * Railway Infrastructure as Code for the `rpgcrm` project (production).
 *
 * Railway deprecated per-service `railway.toml` files for new services, so this
 * file is the source of truth for the two services instead. It mirrors the
 * configuration that is live today (applied through the Railway API on
 * 2026-09-16). To manage it from the CLI:
 *
 *   npm install            # installs the `railway` SDK used to evaluate this file
 *   railway login && railway link
 *   railway config plan    # shows the diff against the live environment
 *   railway config apply   # applies it after confirmation
 *
 * Both services build from the Dockerfile in their root directory. Secrets are
 * kept in Railway (`preserve()`), never in this file.
 */
export default defineRailway(() => {
  // SQLite store for the agent. Mounted at /data; RPG_DB_PATH points into it.
  const agentData = volume("agent-data", { region: "sfo", sizeMB: 50000 });

  const agent = service("agent", {
    source: github("TayoAki/RPGCRM", {
      branch: "claude/quirky-cerf-cva5ud",
      rootDirectory: "agent",
    }),
    healthcheck: "/ping",
    healthcheckTimeout: 120,
    volumeMounts: { "/data": agentData },
    env: {
      PORT: "8000",
      RPG_DB_PATH: "/data/rpg.db",
      // LLM provider: OpenRouter's OpenAI-compatible Chat Completions API.
      // Remove these three to use OpenAI directly (Responses API, gpt-5.4).
      OPENAI_BASE_URL: "https://openrouter.ai/api/v1",
      OPENAI_API_MODE: "chat",
      OPENAI_MODEL: "openai/gpt-5.4",
      // Secret, kept in Railway (agent service → Variables), never in this file.
      OPENAI_API_KEY: preserve(),
      // DTN electronic BOL feed (Module E). Off keeps the sample feed; see README "Connecting DTN".
      // DTN_BOL_MODE: "https",
      // DTN_BOL_URL: "https://<from the DTN onboarding packet>",
      // DTN_API_KEY: preserve(),
      // Staff accounts are created with the README's demo password unless this is set
      // before the first start (see README "Staff sign-in").
      // STAFF_BOOTSTRAP_PASSWORD: preserve(),
    },
  });

  const frontend = service("frontend", {
    source: github("TayoAki/RPGCRM", {
      branch: "claude/quirky-cerf-cva5ud",
      rootDirectory: "frontend",
    }),
    // "/" redirects to the staff sign-in page, so the health check uses the public liveness route.
    healthcheck: "/api/health",
    healthcheckTimeout: 300,
    env: {
      PORT: "3000",
      // Private-network address of the agent; the browser never calls it directly.
      AGENT_URL: "http://${{agent.RAILWAY_PRIVATE_DOMAIN}}:8000",
      // Build-time flag: "1" lists the demo accounts on the sign-in pages. Leave unset in production.
      // NEXT_PUBLIC_DEMO_ACCOUNTS: "1",
    },
  });

  return project("rpgcrm", { resources: [agent, frontend, agentData] });
});
