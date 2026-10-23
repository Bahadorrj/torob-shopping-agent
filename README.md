# Pasazhgard (پاساژگرد)

An AI shopping agent for buying in person from shops, pasajs and malls in Tehran, built on Torob's dataset
for Torob's hackathon. The user says what they need in plain Persian. The agent helps pick a model, compares
products, finds and compares sellers that fit budget, location, hours and payment, asks sellers for the
latest price and stock, falls back to other sellers when one is silent or closed, and plans the visit down
to the pasaj, floor and unit.

Mobile first (360 px), Persian, RTL. Listed price, price age and confirmed stock are shown as separate
facts, and unknowns are shown as unknown.

## Stack

| Part | Tech |
|---|---|
| `backend/` | Python, FastAPI, LangGraph agent (AG-UI over SSE), uv |
| `web/` | Next.js, CopilotKit, Leaflet, pnpm |
| Database | PostgreSQL with PostGIS, pg_trgm and pgvector |
| LLM | Any OpenAI-compatible gateway (`LLM_BASE_URL`) |
| Hosting | Liara: `torob-api`, `torob-web`, `torob-db` |

Why each choice: [ADR-0001](docs/adr/0001-tech-stack.md) (stack and hosting),
[ADR-0002](docs/adr/0002-agent-orchestration.md) (agent orchestration).

## Run locally

Needs Docker, [uv](https://docs.astral.sh/uv/) and pnpm. Put the Torob CSVs (`shops.csv`, `products.csv`,
`offers.csv`) in `dataset/` (gitignored).

```bash
docker compose up --build -d     # db, API on :8000, web on :3000
cd backend
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/pasazhgard uv run python -m pasazhgard.ingest ../dataset
```

Open http://localhost:3000.

Optional keys go in a gitignored `.env` at the repo root: `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`,
`LLM_SMALL_MODEL`, `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS`, `NESHAN_API_KEY`, `CONSOLE_SECRET`. Without the
LLM key the app runs degraded: search is lexical only and the chat agent has no model. Without `CONSOLE_SECRET`
the Seller Console is closed. `GET /health` reports which parts are on.

To run the API and web on the host instead, with only the database in Docker, see
[docs/runbook.md](docs/runbook.md#local-stack).

## Tests

```bash
docker compose up -d db
cd backend && TEST_DB_NAME=pasazhgard_test uv run pytest   # drops and recreates that database
cd web && pnpm lint && pnpm build
cd web && pnpm smoke                                       # Playwright at 360 px on installed Chrome
```

## Docs

- [docs/PRD.md](docs/PRD.md): product requirements and the hackathon brief
- [PRODUCT.md](PRODUCT.md) and [DESIGN.md](DESIGN.md): users, positioning and the design system
- [docs/runbook.md](docs/runbook.md): deploy to Liara, load data, backups, Seller Console links
- [docs/adr/](docs/adr/): architecture decisions
- [CLAUDE.md](CLAUDE.md): how agents work issues in this repo
