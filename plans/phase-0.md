# QoL Checkpoint 0 — Before Phase 0

**Ship these against the current Python/JS codebase before starting the rewrite.** All are pure frontend — no schema changes, no new endpoints. They provide immediate value at the next event and get ported into the new TS frontend as part of Phase 0.

| Item | Description | Est. |
|---|---|---|
| QoL 8 — Quick Filter Presets | One-click filter buttons above the Logs feed | 1 hr |
| QoL 11 — Keyboard Shortcuts | `1–8` tabs, `Ctrl+Enter` sync, `F` focus, `Esc` blur | 1 hr |
| QoL 12 — Filter/Sort Persistence | `localStorage` for round filter, type filter, search, refresh interval | 1 hr |
| QoL 5 — New Since Last Sync Badge | Count badge on Logs tab after each sync | 1 hr |
| QoL 7 — Collapsible Round Blocks | Group Logs by round; top round expanded by default | 2 hrs |
| QoL 1 — Logistics Filtering | Exclude large extensions (>50 min) from Insights metrics | 2 hrs |
| QoL 3 — Round Pace Indicator | "On track / Xm over" badge on active round; red banner at >15m over | 2 hrs |

**Total: ~10 hrs across 3–4 sessions.**

---

# Phase 0 — Foundation Rewrite

**Goal:** Replace the Python/SQLite prototype with a TypeScript + PostgreSQL stack. No new features until this is stable.

**Stack:** Node.js + TypeScript (strict mode), Express, Prisma ORM, PostgreSQL (VPS), dotenv.

**Key architecture decisions:**
- Source-separated schema: raw layer (verbatim API data) → normalized layer (app queries) → app layer (tool-owned). Full spec in `docs/SCHEMA_DESIGN.md`.
- `tournament_source_mapping` table with `is_enabled` toggle handles multi-source config and Carde-only mode without destructive row deletion.
- TIMESTAMPTZ on every timestamp column; Carde EDT timestamps converted to UTC at ingestion.
- `timer_end_datetime` always computed locally; `completed_at` stored verbatim but never used for any computation.
- PF staff ≠ players ≠ app users — three distinct identity concepts, three distinct tables.
- Selective match storage: worker fetches only in-progress matches via `status=in_progress` filter (confirmed functional). Never fetches full match lists.
- Existing SQLite DB kept at `data/legacy.db` as read-only reference; no migration to new schema.

---

## P0.1 — API Surface Documentation

Before any schema work, walk every available endpoint from Carde.io and PurpleFox using test environments. Capture exact response shapes, all field names, data types, nullable fields, timestamp formats, and any source inconsistencies between the two.

**Output:** Updated `agent/CARDE_IO.md` and `agent/PURPLEFOX.md` with full field-level documentation.

**Status:** Partially complete. Carde in-progress match filter confirmed (`status=in_progress`). Full PF surface and completed-event Carde responses still pending.

### Remaining P0.1 items
- `timer_end_datetime`: confirm whether it appears in live event responses
- `result_reported_at` on draws: behavior in completed round responses
- PF table and column names: verify `tournament_penalities` typo, all camelCase field names
- PF extensions: confirm no round field exists; timestamp cross-ref is the only attribution path
- PF judge calls: confirm separate table vs. field on coverage record

---

## P0.2 — Project Bootstrap

```
src/
  server.ts               — Express app + entry point
  db/
    schema.prisma         — Prisma schema
    migrations/           — Prisma migration files
  ingestion/
    worker.ts             — Background ingestion coordinator
    providers/
      carde.ts            — Carde.io fetcher
      purplefox.ts        — PurpleFox/Supabase fetcher
  routes/
    tournaments.ts
    admin.ts
    session.ts
    sync.ts
  middleware/
    auth.ts
    rateLimit.ts
static/                   — Frontend assets (served by Express)
index.html                — App shell
.env                      — Local config (gitignored)
.env.example              — Template (checked in)
```

Setup: `tsc --strict`, ESLint + Prettier, `dotenv` at entry point. No bundler.

---

## P0.3 — Source-Separated Schema

Full spec in `docs/SCHEMA_DESIGN.md`. Summary:

**Raw layer (`raw_*`)** — verbatim API data, append-only, TIMESTAMPTZ everywhere.
```
raw_carde_rounds      raw_carde_matches (in-progress only, status=in_progress)
raw_pf_drops          raw_pf_penalties       raw_pf_extensions
raw_pf_coverage       raw_pf_judge_calls     raw_pf_staff
```

**Normalized layer** — business-logic tables derived from raw; what the app queries.
```
rounds     matches    drops      penalties  extensions
table_coverage        table_judge_calls     pf_staff
```

**App layer (`app_*`)** — no source dependency.
```
app_tournaments       tournament_source_mapping (is_enabled toggle)
app_users             app_sessions      app_activity      worker_state
```

---

## P0.4 — Background Ingestion Worker

Module at `src/ingestion/worker.ts`, same deployment as HTTP server. Runs independently.

- Polls Carde on a configurable interval per active tournament using `status=in_progress` — never fetches full match lists
- At `timer_end_datetime`, immediately fetches in-progress matches and stores result as `rounds.missing_tables_json` with `snapshot_captured_at` timestamp
- Subscribes to PurpleFox Supabase real-time where JWT is valid; falls back to polling
- Writes to raw tables only; triggers normalized layer update after each raw write
- Stores per-tournament state in `worker_state` table — survives restarts
- `is_ghost_match` flag captured from Carde but treated as informational only — ghost marking may happen outside Carde

---

## P0.5 — HTTP API Port

Port all existing endpoints to TypeScript + Express. Auth, session, tournament, sync, logs, backfill — all reading from PostgreSQL via Prisma. API surface unchanged from the frontend's perspective.

Includes: hashed passwords (bcrypt), persistent sessions, rate limiting, `PF_PASSWORD_PEPPER` from env.

---

## P0.6 — SQLite → PostgreSQL Migration

Data export script: reads existing `data/legacy.db`, transforms to new schema where possible, writes to PostgreSQL. Some data (e.g. round pairings) cannot be cleanly migrated due to schema divergence — preserve in legacy DB for reference only.

**Zero-loss verification checklist:**
- Drops: row count matches by tournament
- Extensions: row count matches by tournament
- Penalties: row count matches by tournament
- Round timer records: all rounds preserved with timestamps
- `user_activity` → `app_activity`: all audit log rows preserved

---

## P0.7 — .env Config

```
DATABASE_URL=postgresql://user:pass@host/db
CARDE_API_TOKEN=...
PF_PASSWORD_PEPPER=...
PORT=8080
NODE_ENV=production
```

`.env.example` checked in with placeholder values. `.env` gitignored. No hardcoded secrets anywhere in the codebase.

---

## Verification Checklist

- All existing sync/log/backfill flows work against PostgreSQL
- Sessions survive server restart
- Raw tables contain verbatim API data; normalized tables match what the old UI showed
- Carde-only tournament: PF fetches skipped, `is_enabled=false` on PF mapping row
- Worker captures `missing_tables_json` at timer expiry without manual sync trigger
- SQLite data migrated (drops, extensions, penalties, rounds) with no row loss
- `.env` controls all secrets; no hardcoded values remain
- Ingestion worker and HTTP server run independently (worker crash doesn't take down HTTP)
