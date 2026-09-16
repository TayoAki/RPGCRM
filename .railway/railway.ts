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
  // SQLite store for the agent. Mounted at /data; NORTHSTAR_DB_PATH points into it.
  const agentData = volume("agent-data", { region: "sfo", sizeMB: 50000 });

  const agent = service("agent", {
    source: github("TayoAki/RPGCRM", {
      branch: "claude/quirky-cerf-cva5ud",
      rootDirectory: "agent",
    }),
    healthcheck: "/crm",
    healthcheckTimeout: 120,
    volumeMounts: { "/data": agentData },
    env: {
      PORT: "8000",
      NORTHSTAR_DB_PATH: "/data/northstar.db",
      // Canned enrichment results until a Tavily key is configured.
      MOCK_TAVILY: "1",
      // LLM provider: OpenRouter's OpenAI-compatible Chat Completions API.
      // Remove these three to use OpenAI directly (Responses API, gpt-5.4).
      OPENAI_BASE_URL: "https://openrouter.ai/api/v1",
      OPENAI_API_MODE: "chat",
      OPENAI_MODEL: "openai/gpt-5.4",
      // Secret, kept in Railway (agent service → Variables), never in this file.
      OPENAI_API_KEY: preserve(),
      // TAVILY_API_KEY: preserve(),  // add when you drop MOCK_TAVILY
    },
  });

  const frontend = service("frontend", {
    source: github("TayoAki/RPGCRM", {
      branch: "claude/quirky-cerf-cva5ud",
      rootDirectory: "frontend",
    }),
    healthcheck: "/",
    healthcheckTimeout: 300,
    env: {
      PORT: "3000",
      // Private-network address of the agent; the browser never calls it directly.
      AGENT_URL: "http://${{agent.RAILWAY_PRIVATE_DOMAIN}}:8000",
    },
  });

  return project("rpgcrm", { resources: [agent, frontend, agentData] });
});
