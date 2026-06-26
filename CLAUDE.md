# pf-logger — Agent Entry Point

Local-network tournament ops dashboard for TCG events. Pulls from PurpleFox (Supabase) and Carde.io, stores in PostgreSQL, serves a real-time dashboard for drops, penalties, extensions, round timing, and judge activity. TypeScript + Express 5 + Prisma 7 backend, React 18 + Vite 8 frontend. **Phase 0–1 complete — active development is Phase 2 (SSE, timing analysis, StageTimer). See `plans/phase-2.md`; Phase 1 record in `plans/phase-1.md`.**

---

## Read first — every session

1. **`agent/RULES.md`** — behavioral rules and corrections from past sessions. If a rule here conflicts with your defaults, the rule wins.
2. **`agent/MEMORY.md`** — consolidated log of past sessions and instructions for the memory system.

---

## Critical rules (must internalize before touching any code)

- `completed_at` in Carde.io equals the next round's `started_at` for Swiss rounds — it is NOT "when the round ended." Never use it to compute duration or break time.
- Extensions are tracked in **PurpleFox only** — Carde's `time_extension_seconds` is always 0 for our events.
- Outstanding tables **include** tables with extensions — extensions don't exempt a table from the count.
- Top-8 rounds have `timer_duration_minutes = NULL` — always null-check before computing any timing metric.
- "Timer app" always means **StageTimer** specifically — never use the generic term.
- Never use `INSERT OR REPLACE` on `tournament_meta` or any table with write-once fields — use `ON CONFLICT DO UPDATE SET` with `COALESCE`.
- Extensions are tracked in **PurpleFox only in PF+Carde mode** — in Carde-only mode, use `time_extension_seconds` from Carde match records.
- `is_ghost_match` from Carde is informational only — ghost marking may happen outside Carde entirely and will not be reflected in that flag.
- PF users are **staff** (judges/scorekeepers), not players. Player names come from Carde match records and are denormalized — no separate players table.
- `status=in_progress` on `matches-list/` is confirmed functional — use it in the ingestion worker; never fetch full match lists.
- **Carde `next` pagination type differs by endpoint:** unfiltered `matches-list` and `registrations-slim` return `next` as a **numeric page number** (e.g., `2`), NOT a URL. The `status=in_progress` matches-list returns `next` as a URL string. Always use an explicit page counter + `&page=${page}` in the URL for new pagination loops; never pass `next` to `cardeGet()` when it may be numeric.
- **Round pairings detection:** to find which round has pairings generated (including before the timer starts), query `raw_carde_rounds WHERE pairings_status = 'GENERATED' ORDER BY round_number DESC`. `rounds.carde_status` stays `UPCOMING` until the timer starts — it is NOT reliable for this check.
- PF JWT is never stored in the DB or `.env` — lives in memory (`jwtStore.ts`) only. `pf_session` table stores only metadata (expires_at, set_by). On server restart, `inMemory: false` is returned and the UI must prompt re-paste.
- Prisma 7: import from `'../generated/prisma/client'` (not `'@prisma/client'`). `src/generated/` is gitignored — run `npm run db:generate` after install or schema changes. `postinstall` handles it for `npm install`; run manually after `npm ci --omit=dev`.
- PF table names: `tournament_drops` (not `drops`), `tournament_penalities` (extra 'i' — the correct spelling 404s).
- `timer_is_running` in Carde does NOT flip false when the round clock expires — detect expiry by comparing `timer_end_datetime` to wall time.
- Round timing report (`plans/reports.md`): `totalDurationPlaySec` = `last_match_completed_at − play_started_at`. Use `rounds.last_match_completed_at` (not `matches.result_at`) for all timing end-points — `result_at` is a stale fetch timestamp for in-progress matches. `play_started_at` on `rounds` is the play-start anchor; fall back to `started_at` only when null.
- Tournaments belong to a **game** (`games` table, `game_id` FK) — default round length comes from `games.default_round_length_minutes`.
- Local `npm run dev`: Vite waits for API (`wait-on`); proxy `PORT` from repo root `.env`. See `docs/DEPLOY.md`.
- **Timestamps:** store UTC (`TIMESTAMPTZ`); ingest with `src/utils/datetime.ts`; API JSON uses `toISOString()` (`Z`); display only in the client (`formatInTournamentTz` for tournament UI, `formatUtc` for Manage). Set `tournament.timezone` correctly before trusting wall clocks.
- **Health:** `GET /api/health` = public liveness; `GET /api/admin/health` = workers + PF JWT (superadmin).

---

## Where to find things

| What you need | Where to look |
|---|---|
| Full architecture, TypeScript API contract, legacy Python reference | `agent/AGENT_CONTEXT.md` |
| Tournament concepts, round terminology, game-specific rules | `agent/TOURNAMENT_MANAGEMENT.md` |
| What the tool does, operational workflow, current limitations | `agent/TOOL_PURPOSE.md` |
| Carde.io API behavior, endpoints, known gaps | `agent/CARDE_IO.md` |
| PurpleFox data model, auth, sync behavior | `agent/PURPLEFOX.md` |
| Other softwares, future expansion context | `agent/OTHER_SOFTWARES.md` |
| Database schema design (three-layer model, all tables) | `docs/SCHEMA_DESIGN.md` |
| UI/UX design brief (for design sessions) | `docs/DESIGN_BRIEF.md` |
| Claude Design ready-to-paste prompt | `plans/design-prompt.md` |
| Phase 0 — Foundation Rewrite (TS + PostgreSQL + ingestion worker) | `plans/phase-0.md` |
| Design Phase — UI/UX redesign spec | `plans/design.md` |
| UI implementation plan — React build steps, component specs, source-conditional map | `plans/ui-implementation.md` |
| UI code patterns — concrete implementations (main.tsx, contexts, hooks, API client) | `plans/ui-code-patterns.md` |
| Phase 1 — Admin API + Manage Tab | `plans/phase-1.md` |
| Phase 2 — Events, SSE, Timing Analysis, StageTimer | `plans/phase-2.md` |
| Phase 3 — Analytics, Infrastructure, Polish | `plans/phase-3.md` |
| Round timing report (admin) | `plans/reports.md` |
| QoL improvements (13 items) | `plans/qol.md` |
| Open decisions (4 remaining) | `plans/open-decisions.md` |
| Carde.io API post-mortem (essential before touching Carde integration) | `docs/api-exploration-lessons-learned.md` |
| PF + Carde exploration checklist (all items resolved 2026-05-21) | `plans/p0-api-exploration.md` |
| PurpleFox API quick reference — auth, read/write patterns, gotchas | `docs/pf-api.md` |
| Carde.io API quick reference — auth, read/write patterns, gotchas | `docs/carde-api.md` |
| Local dev setup, VPS deploy, CI/CD, troubleshooting | `docs/DEPLOY.md` |

---

## During this session

Write or update `memory/session_YYYY-MM-DD.md` (gitignored, repo root) with what was asked, what was learned, and any new rules. See `agent/MEMORY.md` for format.

When the user says "consolidate memory", "sync memory", or "/sync-memory" — follow the 4-step consolidation process in `agent/MEMORY.md`.
