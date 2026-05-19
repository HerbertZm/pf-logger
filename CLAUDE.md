# pf-logger — Agent Entry Point

Local-network tournament ops dashboard for TCG events. Pulls from PurpleFox (Supabase) and Carde.io, stores in PostgreSQL, serves a real-time dashboard for drops, penalties, extensions, round timing, and judge activity. TypeScript + Express + Prisma backend, vanilla JS frontend. **Currently being rewritten from Python/SQLite — see `plans/phase-0.md`.**

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

---

## Where to find things

| What you need | Where to look |
|---|---|
| Full architecture, DB schema, all API routes, JS functions | `agent/AGENT_CONTEXT.md` |
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
| Phase 1 — Admin API + Manage Tab | `plans/phase-1.md` |
| Phase 2 — Events, SSE, Timing Analysis, StageTimer | `plans/phase-2.md` |
| Phase 3 — Analytics, Infrastructure, Polish | `plans/phase-3.md` |
| QoL improvements (13 items) | `plans/qol.md` |
| Open decisions (4 remaining) | `plans/open-decisions.md` |
| Carde.io API post-mortem (essential before touching Carde integration) | `docs/api-exploration-lessons-learned.md` |

---

## During this session

Write or update `memory/session_YYYY-MM-DD.md` (gitignored, repo root) with what was asked, what was learned, and any new rules. See `agent/MEMORY.md` for format.

When the user says "consolidate memory", "sync memory", or "/sync-memory" — follow the 4-step consolidation process in `agent/MEMORY.md`.
