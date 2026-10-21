# CLAUDE.md

Pasazhgard: in-store shopping agent over Torob data. PRD `docs/PRD.md`, spec issue #1.
`backend/` is FastAPI + Postgres (uv), `web/` is Next.js RTL (pnpm). `docs/adr/` fixes the stack;
read the ADR for the area you touch before writing code.

## Commands

```bash
docker compose up -d db                                          # Postgres: PostGIS, pgvector, pg_trgm
cd backend && TEST_DB_NAME=pasazhgard_test_<issue> uv run pytest
cd web && pnpm lint && pnpm build
cd web && pnpm smoke                                             # Playwright at 360 px
cd backend && uv run python -m pasazhgard.ingest ../dataset      # full data load
```

- Backend tests drop and recreate their database on every run. Always set `TEST_DB_NAME` unique to your
  worktree, or parallel agents wipe each other's database.
- Read `web/AGENTS.md` before web work: this Next.js differs from your training data. Commit it when
  `next dev` rewrites it.
- The Playwright CDN is blocked from Iran; smoke runs on installed Chrome (`channel: "chrome"`).

## Working an issue

You run unattended. Decide, write the decision in the PR body, keep going.

1. Work the `ready-for-agent` issue the orchestrator gave you. P1 issues (#21-#26) only when the user says so.
2. Worktree `.claude/worktrees/issue-<n>`, branch `issue/<n>-<slug>` off `main`.
3. TDD (`/mattpocock-skills:tdd`): failing test first, per acceptance criterion. API tests run on
   `backend/tests/fixtures/dataset`; every new UI block gets a 360 px check in `web/e2e/`.
4. Smallest complete change (`/ponytail`): nothing the issue does not ask for. List what you skipped in the PR.
5. Conventional Commits, lowercase imperative, optional scope: `feat(web): ...`, `fix: ...`, `test: ...`.
6. Spec wrong? Edit the issue body to match what you built and say why in the PR. Amend an ADR inline
   when your change alters it. Only the integrator writes a new ADR.
7. Open the PR with `/mattpocock-skills:pr`, `Closes #<n>`, with the local gate output
   (pytest, lint, build, smoke) as evidence.
8. Review and merge happen only through the `ship-issue` workflow.

Docs-only changes (CLAUDE.md, `docs/`, ADR text) skip the branch, PR and review loop: commit straight to `main`.

## Review loop: `.claude/workflows/ship-issue.js`

Each step runs in a fresh context.

1. Two Sonnet 5.5 reviewers in parallel, both against the issue and the merge-base with `main`:
   `/code-review high` and `/mattpocock-skills:code-review`.
2. Merge the findings into one deduplicated list.
3. One Sonnet 5.5 fixer per group of findings that share files; groups run in parallel. Each fixer
   writes a failing test, fixes, commits once.
4. Repeat until no correctness, security or spec-mismatch finding remains. Style nits go in the PR body
   and do not block. After 3 rounds, escalate.
5. Merge: rebase on `main`, rerun the gate, `gh pr checks --watch` green, `gh pr merge --merge --delete-branch`.

## Escalate to the user

Pause only that issue and send a push notification when:

- you need a secret, account or paid resource (Liara, BoxAPI, Neshan)
- a change touches deployed infra, or a schema change would break loaded data
- an acceptance criterion contradicts an ADR or the PRD with no clear winner
- you want to drop an acceptance criterion
- the review loop reaches 3 rounds

Anything else, decide yourself. Otherwise the user gets one summary per wave: what merged, what was cut,
open risks. Deploy happens once, before the demo (#27).

## Agent skills

### Issue tracker

Issues live in GitHub Issues for Bahadorrj/torob-shopping-agent (`gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

Default labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
