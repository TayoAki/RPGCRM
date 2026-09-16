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

This app is deployed on [Railway](https://railway.com) as project **`rpgcrm`**
with two services built from the Dockerfiles in `agent/` and `frontend/`:

| Service    | Root directory | Health check | Networking                                   |
| ---------- | -------------- | ------------ | -------------------------------------------- |
| `agent`    | `agent`        | `GET /crm`   | private only, port 8000, volume at `/data`   |
| `frontend` | `frontend`     | `GET /`      | public domain, port 3000                     |

The full configuration lives in [`.railway/railway.ts`](./.railway/railway.ts)
(Railway's Infrastructure as Code; the older per-service `railway.toml` format
is deprecated and ignored for new services). Every push to the connected branch
redeploys both services.

### After the first deploy

1. Open the `agent` service → **Variables** and replace the placeholder
   `OPENAI_API_KEY` with a real key. The service redeploys automatically.
   Until then the UI works but the assistant cannot answer.
2. Optional: add `TAVILY_API_KEY` and remove `MOCK_TAVILY` to get live web
   enrichment instead of canned results.
3. Open the frontend's public domain and try "Show me the pipeline".

### Variables

`agent`

| Variable            | Value                                            |
| ------------------- | ------------------------------------------------ |
| `OPENAI_API_KEY`    | your OpenAI key                                  |
| `TAVILY_API_KEY`    | your Tavily key (or set `MOCK_TAVILY=1` instead) |
| `PORT`              | `8000`                                           |
| `NORTHSTAR_DB_PATH` | `/data/northstar.db`                             |

`frontend`

| Variable    | Value                                           |
| ----------- | ----------------------------------------------- |
| `AGENT_URL` | `http://${{agent.RAILWAY_PRIVATE_DOMAIN}}:8000` |
| `PORT`      | `3000`                                          |

The `${{agent.RAILWAY_PRIVATE_DOMAIN}}` reference resolves to the agent's
private hostname. The browser never talks to the agent directly: both
`/api/copilotkit` and `/api/crm/*` proxy to it server-side.

### Reproducing from scratch

With the Railway CLI: `npm install` at the repo root (installs the `railway`
SDK), then `railway login`, `railway link`, `railway config plan`, and
`railway config apply`. Then set `OPENAI_API_KEY` on the agent and generate a
domain for the frontend.

In the dashboard: create two services from this repo, set their **Root
Directory** to `agent` and `frontend`, add the variables above, attach a
volume at `/data` to the agent, set the health checks from the table, and
generate a public domain on port 3000 for the frontend. Railway picks up the
Dockerfile in each root directory automatically.

### Notes

- Railway restarts a crashed container up to 5 times (`ON_FAILURE`).
- To reset the demo data, delete `northstar.db` on the volume and redeploy;
  the store re-seeds when the accounts table is empty.
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
