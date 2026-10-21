# ADR-0001: Tech stack and hosting

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-21 |
| Issue | #2 (spec: #1, PRD section 11-12) |

## Context

The PRD proposes Python + FastAPI, PostgreSQL with PostGIS / pg_trgm / pgvector, a Next.js PWA, Leaflet + OSM,
SSE, and Docker Compose behind Caddy on one VPS. It leaves open the LLM provider and the hosting region
(PRD open question 2). Hosting in Iran keeps the site fast for local users and seller websites reachable,
but foreign LLM APIs block Iranian IPs. An Iranian OpenAI-compatible gateway solves that.

## Decision

### Hosting: Liara (Iran), PaaS

Liara does not run Docker Compose (docs: `paas/docker/how-tos/deploy-docker-compose`). Each service is a
separate Liara resource on one private network; Liara terminates HTTPS and serves the custom domain, so
there is no Caddy.

| Resource | Liara type | Plan | Notes |
|---|---|---|---|
| `db` | Managed PostgreSQL | Saturn: 2 CPU, 4 GB RAM, 40 GB SSD | PostGIS and pgvector toggled on at creation; pick the newest version offered (it cannot be changed later) |
| `app` | Docker app (FastAPI) | Jupiter: 1 CPU, 2 GB RAM | No local models; HTTP + DB only. Raise to Saturn for the demo if latency needs it |
| `web` | Next.js app | Mars: 1 CPU, 1 GB RAM | Next.js server, CopilotKit runtime, `/api` proxy to `app` |

Sizing against the full dataset: CSVs are 285 MB (6,476 shops, 225,903 products, 331,506 offers).
Loaded with trigram, GiST and B-tree indexes this is an estimated 1.5 GB. Embeddings at 512 dimensions are
226k x 2 KB = 0.46 GB, plus an HNSW index of similar size. About 2.5 GB in total, well inside 40 GB, and
the hot indexes fit in 4 GB RAM. Measure after the first full ingest and move to Uranus (4 CPU, 8 GB) if
search latency suffers.

Docker Compose stays for local development only (`app`, `web`, and a Postgres image with PostGIS and
pgvector). Ingest runs as a one-shot command (`python -m ...ingest`) from any machine that has the CSVs,
against `DATABASE_URL`; for Liara, run it locally against the database's public endpoint (enable public
access for the load, then turn it off). Liara's database backup is the snapshot for fast restore.

### Backend: Python + FastAPI

As in the spec. Python 3.12+, Pydantic models for every tool's input and output.

### Database: PostgreSQL + PostGIS + pg_trgm + pgvector

As in the spec. On Liara, PostGIS and pgvector are enabled in the console; `pg_trgm` and `unaccent` are
contrib extensions enabled with `CREATE EXTENSION` (docs: `dbaas/postgresql/extensions`).

The vector index is HNSW. Liara's docs do not state the pgvector version; check
`SELECT * FROM pg_available_extensions WHERE name = 'vector'` on the new instance. If HNSW is not available
(pgvector < 0.5), use IVFFlat (`lists` about 475, sqrt of row count); at 512 dimensions an exact scan is
also acceptable for 226k rows.

### LLM: BoxAPI, OpenAI Chat Completions format

- Base URL `https://ai.boxapi.ir/ai/v1`, `Authorization: Bearer <key>`. BoxAPI is an Iranian gateway, so it
  is reachable from Liara.
- The provider adapter speaks the OpenAI Chat Completions API (`/chat/completions`) with `tools` and
  `response_format: json_schema`. Base URL and model names come from env, so any OpenAI-compatible gateway
  can replace BoxAPI.
- Main model (agent loop, tool calling): `gpt-5.6-terra`.
- Small model (seller reply parsing, website price extraction): `gpt-5.4-mini`.
- The eval set (#20) may swap the main model for `gpt-5.6-sol` (stronger) or `gpt-5.6-luna` (cheaper);
  both passed the same check.

Checked on 2026-10-21 against BoxAPI with a Persian request
("یه هندزفری بی‌سیم تا ۲ میلیون تومن می‌خوام، امروز عصر میرم جمهوری"):

| Check | Result |
|---|---|
| Tool calling, `gpt-5.6-sol` / `-terra` / `-luna`, `gpt-5.4-mini`, `gpt-5-mini` | Correct call with query, `max_price_toman: 2000000`, `area: جمهوری`; 2.6-5.3 s |
| Structured output (strict `json_schema`), `gpt-5.4-mini`, `gpt-5.6-luna` | Valid parsed seller reply; 2.1-2.7 s |
| Streaming with tool calls, `gpt-5.6-terra` | SSE chunks carry `tool_calls` deltas |
| Tool calling, `gpt-6*` models on `/chat/completions` | Rejected unless `reasoning_effort: none` (`gpt-6.1-sol` refuses even that) |
| Tool calling, `gpt-6*` on `/responses` | Works |

The `gpt-6` family needs the Responses API for tool calls with reasoning. Chat Completions with `gpt-5.6`
is kept because it is the format every OpenAI-compatible gateway serves. Moving to `gpt-6` means adding a
Responses adapter behind the same provider interface.

Responses carry Azure-style content filter results (`prompt_filter_results`, jailbreak detection). Keep an
eye on the seller auto-responder (#22) role-play prompts tripping it.

### Embeddings: `text-embedding-3-small` via BoxAPI, 512 dimensions

Same key and base URL as the LLM (`/embeddings`). The `dimensions` parameter works through BoxAPI.
Precomputed at ingest for product title + brand + category: about 5.7M tokens, about USD 0.11 at the
measured USD 0.023 per 1M tokens. Each search embeds the query with one call.

Without the key or network, semantic search is off and hybrid search falls back to trigram + filters;
this is part of degraded mode. Changing the model or dimensions means re-embedding (minutes, cents).

### Frontend: Next.js + shadcn/ui + CopilotKit

- Next.js (App Router), RTL, Vazirmatn, PWA, as in the spec.
- shadcn/ui for components. It supports RTL via `dir="rtl"` on `<html>` and its `DirectionProvider`.
- CopilotKit for the chat surface and generative UI. Its TypeScript runtime runs in a Next.js route
  handler (`/api/copilotkit`) and needs no CopilotKit Intelligence account. It forwards to the FastAPI agent
  through `HttpAgent` from `@ag-ui/client`, using the AG-UI protocol.
- Generative UI is declarative: each PRD block (`product_cards`, `seller_compare`, `visit_plan`, ...) is the
  result of a tool call, and the frontend registers one shadcn renderer per block type. The UI renders
  numbers from tool output only, as the PRD requires.
- Inquiry consent (no send before the user agrees) maps to CopilotKit's human-in-the-loop actions.
- If CopilotKit gets in the way, the fallback is our own renderer over the same AG-UI event stream; the
  backend does not change.
- The brief bar, filters and other direct UI calls go to FastAPI REST endpoints through a Next.js rewrite
  (`/api/:path*` -> `API_URL`), so the browser talks to one origin.

### Realtime: SSE

As in the spec. Agent turns stream as AG-UI events over SSE (FastAPI `StreamingResponse` with the
`ag-ui-protocol` encoder). Inquiry updates use a plain SSE endpoint per session. Disable response
buffering and compression on SSE routes through the Next.js proxy.

### Maps: Leaflet + OSM tiles, Neshan routing

- Leaflet with OSM tiles; no key. The tile URL is configurable, so Neshan's Leaflet SDK can replace it if
  OSM is slow for users in Iran.
- Neshan Direction API for route distance and time:
  `GET https://api.neshan.org/v4/direction?type=car&origin=lat,lng&destination=lat,lng`, header
  `Api-Key`; distance in `routes[].legs[].distance.value` (m), time in `legs[].duration.value` (s).
- Neshan Distance Matrix (`GET https://api.neshan.org/v1/distance-matrix`, `origins` / `destinations`
  pipe-separated) for travel time across a seller list in one call.
- One Neshan service key covers both. Neshan bills pay-as-you-go and gives new accounts 200,000 toman of
  credit for three months; per-minute and total limits surface as HTTP 482 / 481. On any error or a
  missing key, fall back to straight-line distance with an estimated time.
- Deep links to Neshan, Balad and Google Maps for turn-by-turn navigation.

## Environment variables

`app` (FastAPI):

| Variable | Example / default | Required |
|---|---|---|
| `DATABASE_URL` | Liara private-network URL | yes |
| `LLM_BASE_URL` | `https://ai.boxapi.ir/ai/v1` | no; degraded mode without key |
| `LLM_API_KEY` | BoxAPI key | no; degraded mode without it |
| `LLM_MODEL` | `gpt-5.6-terra` | no |
| `LLM_SMALL_MODEL` | `gpt-5.4-mini` | no |
| `EMBEDDING_MODEL` | `text-embedding-3-small` | no |
| `EMBEDDING_DIMENSIONS` | `512` | no; must match the ingested vectors |
| `NESHAN_API_KEY` | Neshan service key | no; straight-line fallback |
| `INQUIRY_NO_REPLY_SECONDS` | `120` | no |
| `INQUIRY_MAX_PARALLEL` | `3` | no |
| `AUTO_RESPONDER_ENABLED` | `false` | no; its rate settings come with #22 |

`web` (Next.js):

| Variable | Example / default | Required |
|---|---|---|
| `API_URL` | `app` private-network URL, e.g. `http://app:8000` | yes |
| `AGENT_URL` | `${API_URL}/agent` | yes |
| `NEXT_PUBLIC_MAP_TILE_URL` | `https://tile.openstreetmap.org/{z}/{x}/{y}.png` | no |

Secrets: `LLM_API_KEY`, `NESHAN_API_KEY`, and the password inside `DATABASE_URL`. They are set in the
Liara console per app and in a gitignored `.env` locally.

## Differences from the spec

1. **Deployment.** Separate Liara apps plus managed PostgreSQL instead of Docker Compose and Caddy on one
   VPS. Liara has no Compose and provides HTTPS itself. Compose remains for local development.
2. **Agent stream.** AG-UI events (through CopilotKit) instead of a custom block event format. Still SSE,
   and the block types from the spec become tool results with one renderer each.
3. **Frontend libraries.** shadcn/ui and CopilotKit are added on top of Next.js.
4. **Embeddings.** Provider API instead of an unspecified model. Semantic search is off in degraded mode;
   trigram search and filters still work.

## Consequences

- One provider key (BoxAPI) covers chat, small model and embeddings; losing it degrades search quality and
  agent text, never takes the site down.
- `web` depends on `app` over the private network for both the agent and the REST calls.
- The `gpt-6` models stay unavailable for tool calling until a Responses adapter exists.
- First Liara setup must confirm the pgvector version and HNSW support before #12 (hybrid search) relies
  on it.
