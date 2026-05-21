# Agent Rules

Behavioral rules, corrections, and strong preferences extracted from past sessions. Agents must read this at the start of any session. Updated by the consolidation skill — do not edit manually unless correcting a stale rule.

Rules are organized by topic. Each rule leads with the behavior, followed by **Why:** and **When:** lines where relevant.

---

## Communication style

- Keep responses short and direct. Avoid trailing summaries of what was just done.
- Do not narrate internal deliberation or explain what you're about to do at length — just do it.
- When referencing code, include file path and line number so the user can navigate directly.

## Code changes

- Do not add features, abstractions, or cleanup beyond what was explicitly asked.
- Do not add comments unless the WHY is non-obvious.
- Never add emojis to files or responses unless explicitly asked.

## File and doc edits

- When editing agent docs (`agent/*.md`), preserve the user's formatting style — extra blank lines between list items, etc. Do not revert formatting changes.
- Do not rewrite sections the user has already edited in the same session. If a system reminder says a file was modified, read it before touching it again.
- Do not create markdown files unless explicitly requested.

## Memory and context

- Always check `agent/RULES.md` and `agent/MEMORY.md` at the start of a session for behavioral context.
- Write session memory files during the session, not only at the end — checkpoints matter.
- When consolidating, do not delete session files from the memory folder.

## Tool use

- Use dedicated tools (Read, Edit, Grep, Glob) over Bash for file operations.
- Run independent tool calls in parallel.
- Do not re-read a file immediately after writing it to verify — trust the write succeeded.

## Domain-specific

- "Timer app" always means **StageTimer** — never use the generic term in docs or responses.
- Extensions in **PF+Carde mode** come from PurpleFox `tournament_logs` only — Carde `time_extension_seconds` is always 0 for our events in this mode. In **Carde-only mode**, use `time_extension_seconds` from Carde match objects (integer seconds).
- `completed_at` in Carde.io equals the next round's `started_at` for Swiss rounds — never use it as "round end."
- Outstanding tables include tables with extensions — extensions do not exempt a table from the count.
- Byes (`table_number = -1` in Carde) must not be counted as outstanding tables.
- Top-8 rounds have `timer_duration_minutes = NULL` — always null-check before computing timing metrics for any round.
- `is_ghost_match` from Carde is informational only — ghost marking may happen outside Carde and will not be reflected there.
- PF users are **staff** (judges/scorekeepers), not players. Never conflate `pf_staff` with players or `app_users`.
- Player names and IDs come from Carde match records. `user_identifier` in Carde is a **display name string** (e.g. `"Aldo M"`), not a UUID or gameId. Use `player_match_relationships[].user_event_status.user.id` (integer) as the stable player identifier.
- `status=in_progress` on `matches-list/` is confirmed functional — the ingestion worker uses this and never fetches full match lists.
- `table_coverage` (judge visited) and `table_judge_calls` (outcome of formal call) are distinct concepts — never merge them. Both come from the PF `tables` table (`coveredBy` and `judgeResult` columns). The `tables` table is **current-round-only** — wiped on every round advance.
- PF `tables`, `table_status`, and `tournament_time` hold **current round data only** — fully wiped on every round advance. Never treat an empty response from these tables as "no activity." Historical data does not exist in PF for these tables.
- PF drops are in `tournament_drops` (not `drops`). PF penalties are in `tournament_penalities` (extra 'i' — typo is real). Both accumulate across rounds and are NOT wiped on round advance.
- PF `tournament_logs` extensions have a `round` column — attribution by round does NOT require timestamp cross-referencing against Carde round windows. Use `round` directly.
- PF `judgeResult` on the `tables` table is **free-text**, not an enum. Do not match against fixed strings like "Warning" or "Game Loss" — those are penalty sanctions on a different table.
- `timer_is_running` in Carde does NOT flip to false when the round clock expires. Detect expiry by comparing `timer_end_datetime` (from `v2/organize/events/{id}/detail/`) against wall time.
- Carde round `status` values are `UPCOMING`, `IN_PROGRESS`, `COMPLETE`. There is no `ACTIVE` or `SCHEDULED` status.
- Carde round objects do NOT have `extra_time_seconds` or `additional_time_seconds` fields. These do not exist. Round-level timer adjustments are made via `edit_current_round_timer` and reflected only in `timer_end_datetime` on the event-level `detail/` endpoint.
- `timer_end_datetime` lives on `GET /api/v2/organize/events/{id}/detail/` — NOT on round objects from `get_all_rounds` or `tournament_overview`. It is also returned by `edit_current_round_timer` responses.
- Default page size for Carde `matches-list` is **25**, not 50. Always use `page_size=200` to fetch all matches in one call.

## PF JWT management

- The PF JWT is **never** stored in the DB or `.env`. It lives in memory (`src/ingestion/jwtStore.ts`) only.
- `pf_session` table (singleton, `id=1`) stores only metadata: `set_by`, `set_at`, `expires_at`. Never the token.
- `GET /api/session/pf-jwt` returns `inMemory: boolean` — `false` after server restart, even if `expiresAt` is in the future. UI must prompt re-paste in this case.
- On JWT expiry mid-event, worker logs the failure and continues Carde-only. It does not crash or stop.
- `SUPABASE_URL` and `SUPABASE_ANON_KEY` go in `.env` (long-lived, public). `CARDE_API_TOKEN` goes in `.env`. PF JWT does not.

## Architecture (current stack)

- The tool is being rewritten to TypeScript + Express + Prisma + PostgreSQL. Do not write or suggest Python code for new work.
- Schema is three layers: raw (verbatim API, append-only) → normalized (app queries) → app (`app_*`, tool-owned). See `docs/SCHEMA_DESIGN.md`.
- All timestamps are TIMESTAMPTZ. Carde timestamps are EDT for US events and must be converted to UTC at ingestion.
- `timer_end_datetime` for round display is computed locally as `started_at + (timer_duration_min * 60s)` and stored in the normalized `rounds` table. The API does expose it on `detail/` and `edit_current_round_timer` responses — but compute locally for reliability and to handle the +7–83s server lag.
- Carde-only mode: `tournament_source_mapping.is_enabled = FALSE` on the PF row. Worker skips all PF fetches. Extensions come from `time_extension_seconds` on Carde match objects. No drops, penalties, coverage, or judge calls.
- PF+Carde mode: extensions from PF `tournament_logs` only. Carde `time_extension_seconds` always 0 for our events.
