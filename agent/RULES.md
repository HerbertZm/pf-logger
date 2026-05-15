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
- Extensions in **PF+Carde mode** come from PurpleFox only — Carde `time_extension_seconds` is always 0. In **Carde-only mode**, use `time_extension_seconds` from Carde match records.
- `completed_at` in Carde.io equals the next round's `started_at` for Swiss rounds — never use it as "round end."
- Outstanding tables include tables with extensions — extensions do not exempt a table from the count.
- Byes (`table_number = -1` in Carde) must not be counted as outstanding tables.
- Top-8 rounds have `timer_duration_minutes = NULL` — always null-check before computing timing metrics for any round.
- `is_ghost_match` from Carde is informational only — ghost marking may happen outside Carde and will not be reflected there.
- PF users are **staff** (judges/scorekeepers), not players. Never conflate `pf_staff` with players or `app_users`.
- Player names and IDs come from Carde match records — they are denormalized in the `matches` normalized table, not stored in a separate players table.
- `status=in_progress` on `matches-list/` is confirmed functional — the ingestion worker uses this and never fetches full match lists.
- `table_coverage` (judge visited) and `table_judge_calls` (outcome of formal call) are distinct concepts — never merge them.

## Architecture (current stack)

- The tool is being rewritten to TypeScript + Express + Prisma + PostgreSQL. Do not write or suggest Python code for new work.
- Schema is three layers: raw (verbatim API, append-only) → normalized (app queries) → app (`app_*`, tool-owned). See `docs/SCHEMA_DESIGN.md`.
- All timestamps are TIMESTAMPTZ. Carde timestamps are EDT for US events and must be converted to UTC at ingestion.
- `timer_end_datetime` is always computed locally: `started_at + (timer_duration_min * 60s) + extra_time_seconds`. Never read from the API.
