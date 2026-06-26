# Agent Memory System

This file serves two purposes:
1. Instructions for agents on how to track and consolidate session learnings
2. The running consolidated session log (appended to by the consolidation skill)

---

## Instructions for Agents

### During every session

At natural checkpoints during the session (after a significant block of work, or at the end), write or update a session memory file at:

```
memory/session_YYYY-MM-DD.md
```

(relative to the repo root — this folder is in `.gitignore` so files stay local but the path is consistent across devices)

If a file for today already exists, update it rather than creating a duplicate. Use this format:

```markdown
---
date: YYYY-MM-DD
---

## What was asked
- Brief bullet per major ask or topic

## What we learned / discovered
- Technical findings, API behaviors, data quirks, corrections to prior assumptions

## Decisions made
- Design decisions, approach choices, things explicitly confirmed or ruled out

## Rules / patterns observed
- Behavioral patterns the user enforced or corrected
- Things to do or avoid in future sessions
```

Write only things that would be non-obvious to a future agent reading the codebase cold. Skip ephemeral task state and anything derivable from the code or git history.

---

### When the consolidation skill is invoked

The user will invoke this with something like **"consolidate memory"**, **"sync memory"**, or **"/sync-memory"**.

When that happens, do the following in order:

**Step 0 - let user know what you're doing**
Explicitely log in the chat the following string:
- `CONSOLIDATING MEMORY, YES, THIS WORKED, WUJUUUUU`

**Step 1 — Read session files**
Read all files matching `memory/session_*.md` in the repo root.

**Step 2 — Append to this file**
For each session file not yet represented in the Session Log below, append a new entry under `## Session Log` using this format:

```markdown
### YYYY-MM-DD
**Asked:** [2–4 bullet summary of what was requested]
**Learned:** [2–5 bullet summary of key findings or decisions]
```

Keep entries concise — this is an index, not a transcript.

**Step 3 — Upsert `agent/RULES.md`**
Extract any behavioral rules, correction patterns, or strong preferences from the session files and upsert them into `agent/RULES.md`:
- If a rule already exists and is being refined, update it in place
- If it's new, add it under the appropriate section
- If a rule has been contradicted or superseded, remove or update it

**Step 3b — Review `CLAUDE.md`**
Check whether any critical rules in `CLAUDE.md` need updating based on session learnings:
- If a new domain invariant was established (a trap, a data-source correction, a naming rule), add it to the **Critical rules** section
- If the **Where to find things** table is stale (a doc was added, renamed, or its purpose changed), update it
- If a rule was superseded or corrected, remove or replace it
- Do not add behavioral/communication rules here — those belong in `agent/RULES.md` only

**Step 4 — Clean up**
After a session file has been consolidated, you may leave it in place (it serves as a raw transcript backup). Do not delete session files.

---

## Session Log

_Consolidated session entries appear below. Most recent first._

<!-- entries appended by consolidation skill -->

### 2026-06-26
**Asked:** Build and iteratively fix a round-timing SQL query for DLC Indy Challenge (tournament id=8); connect directly to the VPS Postgres DB to run queries live; consolidate memory. Later: diagnose production 502 bad gateways.
**Learned:** `matches.result_at` is unreliable for "last table finished" — it equals `updated_at` (stale fetch timestamp) for in-progress matches, not actual finish time. The correct source is `rounds.last_match_completed_at`, which the worker stamps with wall-clock time when `stillInProgress === 0`. The insights tab already uses this; `src/services/roundTimingReport.ts` still uses `matches.result_at` and needs to be migrated. `rounds.play_started_at` column now exists (set by worker when timer end is known); it is the correct play-start anchor for duration and scheduled-end math. `timer_end_datetime` in the DB is authoritative for scheduled end — prefer stored value over recomputing from `play_started_at + timer_duration_min`. DB accessible via `node -e` + `pg` package at 144.202.49.22:5432 (psql not available locally). **Prod outage fix:** `src/db/seed-test-tournament.ts` had a bare `main()` call at module level — ran on every import, hit Prisma P2028 transaction timeout, called `process.exit(1)`, causing 165 systemd restart-loop crashes (502s). Fixed with `require.main === module` guard (commit `342bacd`). Rule: any script file that also exports functions for import must use this guard.

### 2026-06-02
**Asked:** Harsh P1 review + fix all issues; finish/wrap Phase 1; verify vs QoL; proactive doc sync; UTC storage with client-side display; DEPLOY.md + migration script; VPS DB access from local; consolidate memory + review handoff prompt.
**Learned:** Phase 1 wrapped on `hz/random-v2` (commit `f46b5b6`): Manage tab, admin API, QoL 1–13, health split (`GET /api/health` liveness vs `GET /api/admin/health` ops), backfill parity, worker lifecycle, prod test-tournament guards, CI deploy. QoL 2/10 duration columns stay `n/a` until Phase 2. UTC (committed after `f46b5b6`, may be uncommitted): `src/utils/datetime.ts` ingest + `formatInTournamentTz` / `formatUtc` display; naive Carde strings use `tournament.timezone`. Post-deploy timestamp fix needs **manual sync per tournament**, not backfill alone. `db:apply-pending` auto-discovers all migration folders; CI retries with it only on P1002. VPS Postgres is localhost-only by default — prefer SSH tunnel (`ssh -L 5433:127.0.0.1:5432`); if opening 5432 use `YOUR.IP/32` in both `pg_hba.conf` and `ufw`, never bare `/32` or `0.0.0.0/0` without accepting risk.
**Learned:** `plans/p1-review-handoff.md` archived; active work → `plans/phase-2.md`.

### 2026-06-01 (session 2)
**Asked:** Dep upgrades (Prisma 7, Express 5, Vite 8); UI fixes (logs judge info, insights columns, dashboard round selector, past-round timer); PF staff profiles sync; test tournament seed + `isTestTournament` flag; dead code removal; plan doc sync.
**Learned:** Prisma 7 changes import path to generated file (not `@prisma/client`); Prisma 7 JSON columns need `JSON.parse(JSON.stringify(x))` for `InputJsonValue` compat; Express 5 wildcard routes require regex; `jwtStore` is now a global singleton (no per-tournament); PF `profiles` table: `{ id, firstname, lastname }` global ~2k rows; advisory lock times out when dev server holds a Prisma connection.
**Decisions made:** `isTestTournament` excluded at worker startup + guarded in sync functions; `npm run db:seed-test` is the local dev fixture; pf_staff sync via `POST /api/admin/staff-sync`; all legacy code (serve.py, scripts/, action_logs.db, archive plans) removed.

### 2026-06-01 (session 1)
**Asked:** Reports tab (API v1, UI, CSV, column reference); games table; indicators/logs UI polish; dashboard click-to-select round; dev `ECONNREFUSED` fix; plans + deploy doc wrap-up.
**Learned:** Vite can proxy before API is up — `wait-on` + repo-root `PORT` in `vite.config.ts`; Prisma shadow DB fails if migration folder names sort before their dependencies (Windows); `<th scope="row">` defaults to centered text.
**Decisions made:** Reports has no indicators sidebar (admin+ only); `DashboardRoundProvider` on dashboard tab only; round timing play duration uses `started_at` until StageTimer; `games` + `game_id` on tournaments shipped.

### 2026-05-20
**Asked:** Rewrite UI docs for TS experts; Figma sync protocol; design critique fixes; P0 code review and fixes.
**Learned:** Mobile layout traps (LogEntry grid, stat chips min-width); Results Pending urgency state; `completedAt` must never drive overtime; Express needs `asyncHandler`; JWT was wrongly in DB metadata (fixed to `jwtStore.ts`); auth/tournament context race fixed via `auth:login` event.
**Decisions made:** `tokens.css` = visual truth, `ui-implementation.md` = behavioral truth; transitions near-zero for ops tool; `ui-code-patterns.md` split from implementation plan; `overtimeMinutes` stays null until worker snapshot.

### 2026-05-18
**Asked:** Full UI/UX redesign in Figma + design tokens and four screen wireframes.
**Learned:** Bottom nav mobile / top tabs desktop; dark-only MVP; timer as hero; badge (pill) vs CTA (rect) must never mix; five log types including Coverage and Judge Call (PF-only).
**Decisions made:** CSS custom properties only (no Tailwind/MUI); `TournamentContext.sources` drives all source-conditional UI; Figma file `czEoZNIW8dHjbiea6OwlOi`.

### 2026-05-21
**Asked:**
- PF and Carde.io API exploration via Claude in Chrome prompts + HAR file analysis on a test tournament
- Update all agent/context/plan docs with confirmed API findings
- Wrap up Phase 0: full API contracts, PF JWT on-the-go design

**Learned:**
- PF round lifecycle: `tables`, `table_status`, `tournament_time` wiped on every round advance — current-round-only, never treat empty response as "no activity"
- Real PF table names: `tournament_drops` (not `drops`), `tournament_penalities` (extra 'i' — correct spelling 404s)
- `tournament_logs` has direct `round` column — no timestamp inference needed for extension round attribution
- Coverage and judge call are both on the `tables` row — `table_coverage` / `table_judge_results` tables do not exist; `judgeResult` is free-text
- Carde `timer_end_datetime` on event-level `detail/` only; `timer_is_running` does NOT flip false on expiry; no `extra_time_seconds` on round objects
- Carde default page size is 25 (not 50); `user_identifier` is a display name string, not UUID
- PF JWT: ~48h validity, Discord OAuth, no refresh token — must never go in `.env`

**Decisions made:**
- PF JWT stored in memory (`jwtStore.ts`) only; `pf_session` table stores only metadata (expires_at, set_by, set_at) — token never written to DB
- `GET /api/session/pf-jwt` returns `inMemory: boolean` to distinguish expired vs. needs-repaste-after-restart
- Worker degrades to Carde-only on JWT expiry and surfaces error via `worker_state.last_error` and `GET /api/admin/health` (public `/api/health` is liveness only)
- `SUPABASE_URL` + `SUPABASE_ANON_KEY` go in `.env`; PF JWT never does
- Full TypeScript API contract documented in `plans/phase-0.md` § P0.5

### 2026-05-15
**Asked:**
- Review and scope a "Phase 0" covering: source-separated DB architecture, PostgreSQL migration, TypeScript rewrite, UI redesign brief, Carde-only mode, ingestion worker decoupling
- Deep-dive DB schema design for the three-layer model (raw → normalized → app)
- Produce API exploration prompts for Claude Chrome extension (Carde + PF test environments)
- Split `plans/PLAN.md` into per-phase files; add Design Phase between Phase 0 and Phase 1
- Sync and update CLAUDE.md, MEMORY.md, RULES.md

**Learned:**
- `status=in_progress` filter on `matches-list/` is confirmed functional — never need to fetch full match list
- New Carde match fields: `is_ghost_match`, `deck_check_started/completed`, `match_is_loss`, `assigned_judge`, intentional/unintentional draw flags
- `is_ghost_match` is informational only — ghost marking may happen outside Carde
- PF users in `users` table are STAFF not players; player names are denormalized from Carde match records
- `table_coverage` and `table_judge_calls` are distinct (visit vs. outcome), both PF-only, both absent in Carde-only mode
- Extensions in Carde-only mode come from `time_extension_seconds` on match records (not PF `tournament_logs`)
- Tech stack decision: full rewrite to TypeScript + Express + Prisma + PostgreSQL; NestJS rejected as too heavyweight

**Decisions made:**
- Three-layer schema: raw (append-only verbatim) → normalized (app queries) → app (tool-owned); full spec in `docs/SCHEMA_DESIGN.md`
- `tournament_source_mapping` with `is_enabled` replaces hardcoded provider config; non-destructive Carde-only toggle
- `carde_first_round_id` in mapping table; `carde_base_round_id` convention dropped
- Existing SQLite kept at `data/legacy.db` — no migration to new schema
- TIMESTAMPTZ on every timestamp; ingest/display split in `src/utils/datetime.ts` + client `utils/time.ts` (see `docs/DEPLOY.md` Timestamps section)
- Design Phase added between Phase 0 and Phase 1 in the plan
- `plans/PLAN.md` split into: `phase-0.md`, `design.md`, `phase-1.md`, `phase-2.md`, `phase-3.md`, `qol.md`, `open-decisions.md`

### 2026-05-14
**Asked:**
- Deep-dive Atlanta RQ round timing analysis across Carde.io API, SQLite, PurpleFox, and StageTimer logs
- Fill out empty/stub agent docs in `agent/` (TOOL_PURPOSE, PURPLEFOX, CARDE_IO, OTHER_SOFTWARES, TOURNAMENT_MANAGEMENT)
- Consolidate all plan files (CURRENT_PLAN, QOL_IMPROVEMENTS, archive/TODO, archive/production-ready) into single `plans/PLAN.md`
- Create memory/rules system: session files in gitignored repo `memory/` folder, consolidation skill, `agent/RULES.md`, `CLAUDE.md` entry point

**Learned:**
- `completed_at` in Carde = next round's `started_at` for Swiss — single button click, never use as round end
- Extensions tracked in PurpleFox only; Carde `time_extension_seconds` always 0 for our events
- Outstanding tables include extension tables — best case is they don't need to use the extension
- `tournament-rounds/{id}/matches-list/` has working filters; old `organize/matches/` ignores all filters
- `missing_tables_json` only reliable if sync fires at exact timer expiry → new Phase 1 items 1.9 and 1.10
- StageTimer logs are UTC; only covers deployed tables (partial venue on large events)
- Memory session files belong in repo `memory/` (gitignored) not local Claude path, for cross-device consistency
