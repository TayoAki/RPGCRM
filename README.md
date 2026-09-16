# RPGCRM — Northstar AI Sales CRM

An agentic CRM built on [CopilotKit](https://copilotkit.ai), the
[AG-UI protocol](https://docs.copilotkit.ai/ag-ui), and a TypeScript
[Strands](https://strandsagents.com) agent. The copilot drives the workspace:
it researches prospects, builds hardware quotes, analyzes the team, and
generates reports that render as full pages.

This repository started as a vendored copy of CopilotKit's
[`strands-crm` showcase](https://github.com/CopilotKit/CopilotKit/tree/main/examples/showcases/strands-crm)
(MIT, see [LICENSE](./LICENSE)) plus Railway deployment config. The plan to turn
it into a multi-tenant SaaS product is written up in [SAAS_AUDIT.md](./SAAS_AUDIT.md).

## Layout

```
agent/      TypeScript Strands agent served over AG-UI by Express (:8000), SQLite store
frontend/   Next.js (App Router) + CopilotKit UI (:3000); its API routes proxy to the agent
```

| Layer    | Tech                                                                                                              |
| -------- | ----------------------------------------------------------------------------------------------------------------- |
| Agent    | TypeScript Strands (`@strands-agents/sdk`), `@ag-ui/aws-strands`, Express, OpenAI, Tavily, SQLite (`node:sqlite`) |
| Frontend | Next.js (App Router) + React 19, CopilotKit (`@copilotkit/*`), `@ag-ui/client`, Tailwind v4                       |

```
Next.js + CopilotKit (UI, :3000)
        │  /api/copilotkit  →  HttpAgent
        ▼
TypeScript Strands agent (Express, :8000)
        │  tools: recommend_products / enrich_lead / analyze_team /
        │         generate_weekly_report / move_stage / confirm_followup / …
        ▼
SQLite CRM store  ──STATE_SNAPSHOT──▶  live board + dashboard + report pages
```

## Prerequisites

- Node.js 22.13 or newer (the store uses the built-in `node:sqlite` module; see `.nvmrc`)
- An **OpenAI API key**
- A **Tavily API key** for lead enrichment (free at https://tavily.com), or `MOCK_TAVILY=1` for canned results

## Local development

```bash
npm run install:all          # installs root, agent, and frontend deps

cp agent/.env.example agent/.env
# edit agent/.env → set OPENAI_API_KEY and TAVILY_API_KEY

npm run dev                  # runs the agent (:8000) and the UI (:3000) together
```

Open http://localhost:3000. The frontend's API routes proxy to the agent at
`http://localhost:8000` (override with `AGENT_URL`).

Prefer two terminals? Run `npm --prefix agent run dev` and `npm --prefix frontend run dev`.

## Deploying to Railway

Both halves run on [Railway](https://railway.com) as two services in one
project, built from the Dockerfiles in `agent/` and `frontend/`. The agent is
reached over Railway's private network, so only the frontend needs a public
domain. Each service directory carries a `railway.toml` with its build and
health-check settings.

### 1. Agent service

1. **New Project → Deploy from GitHub repo**, pick this repository.
2. In the service **Settings → Source**, set **Root Directory** to `agent`.
   Rename the service to `agent` (the frontend's `AGENT_URL` below refers to
   it by this name). If the build log shows Railpack instead of a Dockerfile
   build, set **Railway Config File** to `agent/railway.toml`.
3. **Variables**:

   | Variable            | Value                                            |
   | ------------------- | ------------------------------------------------ |
   | `OPENAI_API_KEY`    | your OpenAI key                                  |
   | `TAVILY_API_KEY`    | your Tavily key (or set `MOCK_TAVILY=1` instead) |
   | `PORT`              | `8000`                                           |
   | `NORTHSTAR_DB_PATH` | `/data/northstar.db`                             |

4. **Add a Volume** to the service with mount path `/data`. Without it the
   SQLite store lives in the container filesystem and re-seeds on every deploy.
5. Do **not** generate a public domain for this service. The health check hits
   `GET /crm`, which also confirms the database opened and seeded.

### 2. Frontend service

1. In the same project, **+ New → GitHub Repo**, pick this repository again.
2. **Settings → Source → Root Directory**: `frontend`. Rename the service to `frontend`.
3. **Variables**:

   | Variable    | Value                                                |
   | ----------- | ---------------------------------------------------- |
   | `AGENT_URL` | `http://${{agent.RAILWAY_PRIVATE_DOMAIN}}:8000`      |
   | `PORT`      | `3000`                                               |

   The `${{agent.RAILWAY_PRIVATE_DOMAIN}}` reference resolves to the agent's
   private hostname (`agent.railway.internal`). The browser never talks to the
   agent directly: both `/api/copilotkit` and `/api/crm/*` proxy to it server-side.
4. **Settings → Networking → Generate Domain**, target port `3000`.
5. Open the domain. The dashboard should show the seeded pipeline; try
   "Show me the pipeline" in the assistant panel.

### Notes

- Each push to the connected branch redeploys both services. The frontend
  build runs `next build` inside its Dockerfile, so build failures surface in
  the Railway build log rather than at runtime.
- Railway restarts a crashed container up to 5 times (`restartPolicyType` in
  `railway.toml`). Health checks: `/crm` for the agent, `/` for the frontend.
- To reset the demo data, delete `northstar.db` on the volume (or detach the
  volume) and redeploy; the store re-seeds when the accounts table is empty.
- Nothing here is multi-tenant or authenticated yet. Anyone with the frontend
  URL can drive the copilot and spend your OpenAI budget. See
  [SAAS_AUDIT.md](./SAAS_AUDIT.md) before sharing the URL widely.

## Tests

```bash
npm --prefix agent test       # agent: store, routes, tools, analytics (121 tests)
npm --prefix frontend test    # frontend: CRM lib + navigation (35 tests)
```

## Try it

In the chat, try: **"Research CopilotKit"**, **"Quote a 30-seat laptop fleet for CopilotKit"**
(then approve the quote), **"How is the team doing this quarter?"**, **"Generate this week's
report"**, or **"Show me the pipeline."**
