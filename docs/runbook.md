# Runbook

Production runs on Liara as three resources on one private network (ADR-0001): `torob-api` (FastAPI,
Docker), `torob-web` (Next.js, Docker) and `torob-db` (managed PostgreSQL). Docker Compose is for local
development only.

Liara docs are at https://docs.liara.ir/; paths below are relative to it. Commands are PowerShell; in bash use
`DATABASE_URL=... uv run ...` instead of `$env:DATABASE_URL = ...`.

## Local stack

```
docker compose up --build -d     # db, app (http://localhost:8000), web (http://localhost:3000)
cd backend; $env:DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/pasazhgard"
uv run python -m pasazhgard.ingest ../dataset    # first time, or after the CSVs change
```

Or run the API and web on the host, with only the database in Docker:

```
docker compose up -d db
cd backend; $env:DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/pasazhgard"
uv run --env-file ../.env python -m pasazhgard   # http://localhost:8000
cd web; pnpm build; pnpm start                   # second shell, http://localhost:3000 (proxies /api to :8000)
```

Optional keys (`LLM_API_KEY`, `NESHAN_API_KEY`, ... see ADR-0001) go in a gitignored `.env` at the repo
root. Without them the app runs degraded and search still works.

## First-time Liara setup

App IDs are global on Liara and are also the private hostnames. If `torob-api` or `torob-web` is taken, pick
another ID and change it in `backend/liara.json` / `web/liara.json` (`app`, and `API_URL` in
`web/liara.json` `build.args`).

1. Install the CLI and log in: `npm install -g @liara/cli`, then `liara login`.
2. Console > Private networks: create one network. Apps and databases cannot change network after
   creation, so every resource below goes in it.
3. Create the database: PostgreSQL, the newest version offered (it cannot be changed later), plan Saturn,
   ID `torob-db`, in the network. Pick the **Silver** software package or higher: Bronze has no backups,
   so the restore steps below would not work. Turn on the PostGIS and pgvector extensions.
4. Turn on public access for the database (DB Settings), connect with `psql` using the public URI from the
   Connection tab, and run:
   ```sql
   CREATE DATABASE pasazhgard;
   \c pasazhgard
   CREATE EXTENSION IF NOT EXISTS pg_trgm;
   CREATE EXTENSION IF NOT EXISTS unaccent;
   CREATE EXTENSION IF NOT EXISTS postgis;
   CREATE EXTENSION IF NOT EXISTS vector;
   SELECT name, installed_version FROM pg_available_extensions WHERE name = 'vector';  -- HNSW needs >= 0.5
   ```
   Keep public access on for the first data load (below), then turn it off.
5. Create the apps, both platform Docker, in the network:
   - `torob-api`, plan Jupiter.
   - `torob-web`, plan Mars.
   The Silver package on the apps gives zero-downtime deploys (a release that fails its health check gets
   no traffic).
6. Set env vars on `torob-api` (App > Settings > Variables, or `liara env:set KEY=VALUE -a torob-api`):
   - `DATABASE_URL`: the **private** URI from the DB's Connection tab, with the database name changed to
     `pasazhgard`. Copy host and port; do not guess them.
   - Optional: `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_SMALL_MODEL`, `EMBEDDING_MODEL`,
     `EMBEDDING_DIMENSIONS`, `NESHAN_API_KEY` (ADR-0001 table).
   Never put env vars in `liara.json` (`envs` replaces all of an app's variables). `torob-web` needs none:
   `API_URL` is a build arg in `web/liara.json`.
7. Deploy both apps (next section) and load the data (section after).
8. Custom domain on `torob-web` (`paas/domains/add-domain/`): Domains > Add domain, add the three DNS
   records Liara shows, wait until all are green, then "Obtain SSL certificate". Optionally disable the
   default `*.liara.run` subdomain of `torob-api` so it is reachable only over the private network, then
   check that the site still loads.

## Deploy

The API does not change the schema itself; the ingest does. When a release adds a column to `sessions` or
`inquiries`, apply it before deploying the API, or the routes that write it fail. Run the ingest (next
sections), or with public access on run only the new statements from `ingest.py`. The release with plan
reacts to inquiries (#19) needs, or every `POST /sessions/{id}/inquiries` returns 500:

```sql
ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS instead_of bigint;
```

From the repo root, API first:

```
cd backend; liara deploy
cd ../web; liara deploy
```

The resources live in a Liara team, so run `liara team use --team <name>` once after `liara login`.
Each directory has its own `liara.json` (app ID, port) and `.liaraignore`. Liara builds the
`Dockerfile` in that directory. Check the result:

```
liara logs -a torob-api -f      # JSON lines: time, level, logger, message
curl https://<domain>/api/health
```

`/health` returns `{"status": "ok", "db": "ok", "llm": ..., "maps": ...}`. It returns 503 with
`"db": "unreachable"` when the database cannot be reached. `llm` / `maps` false means the key is not set and
the app is in degraded mode.

Neither app has a Liara `healthCheck`. Liara reads its timings in milliseconds (`timeout` <= 10000,
`startPeriod` <= 3000), but even with valid timings the probe never reached `/health` (no access-log
line) and every release was marked unhealthy, whether the command was a quoted `python -c "..."` or a
plain `python -m` module. Find out how Liara runs the command before adding one back.

If the build fails downloading base images or packages, add `"build": {"location": "germany"}` to that
app's `liara.json` (slower image push, unrestricted downloads).

## Load or reload data

The load is one idempotent job: it rebuilds the tables from the CSVs in one transaction, so a failed run
leaves the old data in place. The new tables are built in a staging schema, so searches keep serving the
old data and wait only for the final swap (well under a second). Take a backup first (next section) if the
current data matters.

With `LLM_API_KEY` set (plus the optional `LLM_BASE_URL`, `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS`), the load
also embeds product title + brand + category for semantic search. Vectors are kept in `embedding_cache`
across reloads, so only new or changed texts are sent to the provider; a failed run keeps the batches it
already paid for. Load without the key and search is lexical only. The embedding settings must match the
app's.

1. Turn on public access for `torob-db`.
2. From a machine that has the full CSVs in `dataset/`:
   ```
   cd backend
   $env:DATABASE_URL = "<public URI, database pasazhgard>"
   uv run python -m pasazhgard.ingest ../dataset
   ```
3. Turn public access off.
4. Check: `curl "https://<domain>/api/products/search?q=%D9%87%D8%AF%D9%81%D9%88%D9%86"` (هدفون) returns items.

If a load is killed mid-run, its server session can live on and hold locks, so the next load hangs on
`DROP SCHEMA staging`. Find it with `SELECT pid, state, query FROM pg_stat_activity WHERE datname =
'pasazhgard'` and end it with `SELECT pg_terminate_backend(<pid>)`.
5. Optional quality check: `uv run python eval/search.py` against the same `DATABASE_URL` prints the top-5
   hit rate over `backend/eval/search_queries.json` (hybrid with `LLM_API_KEY`, lexical without).

## Back up and restore a snapshot

Liara backups need the Silver package or higher on `torob-db`. There is no CLI command for them.

- **Create**: DB > Backup > Create backup (Silver also takes one automatically every day, kept 7 days).
- **Restore (fast path)**: DB > Backup, click restore on a backup, fill in the new database's details
  and put it in the **same private network**, then launch it (`dbaas/restore-using-console/`). Set
  `DATABASE_URL` on `torob-api` to the new database's private URI and `liara restart -a torob-api`.
  Check `/api/health`, then delete the old database when you no longer need it.
- **Portable dump** (independent of Liara backups), with public access on and client tools of the same or
  newer major version as the server:
  ```
  pg_dump    -h <host> -p <port> -U <user> -F c -d pasazhgard -f pasazhgard.dump
  pg_restore -h <host> -p <port> -U <user> -d pasazhgard --clean --if-exists --no-owner -j 4 pasazhgard.dump
  ```
  The target database needs the PostGIS and pgvector toggles on before the restore.

## To confirm on the first real deploy

Confirmed on 2026-10-22: `healthCheck` timings are milliseconds (see Deploy), and the DB user can create all
four extensions in step 4 (PostgreSQL 18.4, pgvector 0.8.1, so HNSW works). Still open:

- How to download a Liara backup file for `pg_restore` (the console fast path does not need it).
- Whether a private-only `torob-api` (default subdomain off) still resolves from `torob-web`.
