# pf-logger — Agent Entry Point

Local-network tournament ops dashboard for TCG events. Pulls from PurpleFox (Supabase) and Carde.io, stores in SQLite, serves a real-time dashboard for drops, penalties, extensions, round timing, and judge activity. Single-file Python server (`serve.py`) + single-file frontend (`index.html`). No build step, no external Python deps (yet).

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
| Full roadmap and QoL improvements | `plans/PLAN.md` |
| Carde.io API post-mortem (essential before touching Carde integration) | `docs/api-exploration-lessons-learned.md` |

---

## During this session

Write or update `memory/session_YYYY-MM-DD.md` (gitignored, repo root) with what was asked, what was learned, and any new rules. See `agent/MEMORY.md` for format.

When the user says "consolidate memory", "sync memory", or "/sync-memory" — follow the 4-step consolidation process in `agent/MEMORY.md`.
