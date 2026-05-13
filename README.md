# pf-logger

A real-time tournament operations dashboard for Magic/Riftbound events run on PurpleFox. It pulls live data from two external sources — PurpleFox (Supabase) and carde.io — stores it in a local SQLite database, and presents a multi-tab dashboard for drops, time extensions, penalties, round timing, and judge activity. Designed to run on a LAN-connected laptop or a VPS; no build step, no external Python dependencies.

---

## Current Stage — Phase 1 of 3

| Status | Item |
|--------|------|
| Done | Core dashboard: Logs, Insights, Infractions, Session, Debug, Schema, Data, Activity tabs |
| Done | Two-tournament support (hardcoded in `serve.py`) |
| Done | carde.io round timing + pairings fetch; background worker |
| Done | Three-role auth (`user` / `admin` / `superadmin`), in-memory sessions |
| Done | Superadmin activity log tab |
| In progress | Phase 1 — DB-backed auth + sessions, tournament/user management UI, code split, design system |
| Planned | Phase 2 — PostgreSQL, event grouping, provider abstraction layer, SSE push |
| Planned | Phase 3 — Advanced analytics, mobile/a11y, Docker, export/print |

See [plans/CURRENT_PLAN.md](plans/CURRENT_PLAN.md) for the full three-phase roadmap and [plans/QOL_IMPROVEMENTS.md](plans/QOL_IMPROVEMENTS.md) for the quality-of-life improvement queue.

---

## Quick Start

```bash
# Requires Python 3.8+ (no third-party packages)
python serve.py
# Listens on http://0.0.0.0:8765
```

Default credentials (development only — change before any production deployment):

| Username | Password | Role |
|----------|----------|------|
| `admin` | `admin` | Admin |
| `hj` | `hj` | User (head judge) |
| `hz` | `hz` | Superadmin |

On first run, `action_logs.db` is created automatically in the working directory. Do not commit this file — it contains live event data.

To fetch live data, go to the **Session** tab and paste a PurpleFox JWT (see [docs/USER_GUIDE.md](docs/USER_GUIDE.md) for step-by-step instructions on extracting it from browser DevTools).

---

## Key Features

- **Logs tab** — full event feed grouped by round; type/round/search filters; new-entry highlighting; CSV and JSON export
- **Insights tab** — per-round breakdown: timer vs actual duration, extensions, outstanding tables at time-called, drops, penalties; stat cards with detail tooltips
- **Infractions tab** — penalty-focused view with repeat-offender alerts and per-type breakdown
- **Session tab** — PurpleFox JWT management; server-side proxy so all LAN clients share one token
- **Debug tab** — raw Supabase table explorer and schema probe
- **Data tab** *(admin only)* — paginated SQLite browser for all 12 local tables
- **Activity tab** *(superadmin only)* — audit log of all server-side events
- **Auto-refresh** — configurable interval (15 s to 5 min); countdown bar; disables automatically for ended events
- **Carde.io background worker** — fetches paginated round pairings without blocking sync responses
- **Write-once upsert semantics** — COALESCE guards prevent stale syncs from overwriting `is_ended`, `started_at`, `completed_at`, and `missing_tables_json`

---

## File Index

**Application**

| File | Description |
|------|-------------|
| `serve.py` | Single-file Python HTTP server (1,743 lines). All API routes, SQLite schema + migrations, Supabase + carde.io fetch logic, background pairing worker, in-memory auth. Entry point: `python serve.py`. |
| `index.html` | Single-file frontend (2,575 lines). Vanilla JS, no framework, no bundler. All CSS inline. Tabs: Logs, Insights, Infractions, Session, Debug, Guide, Schema, Data, Activity. |
| `action_logs.db` | SQLite database. Auto-created on first run. Contains 12 tables: `drops`, `time_logs`, `penalties`, `table_time_updates`, `table_coverage`, `table_judge_results`, `tournament_meta`, `table_players`, `round_pairings`, `rounds_fetched`, `round_timers`, `user_activity`. **Never commit this file.** |

**Scripts** (`scripts/`)

| File | Description |
|------|-------------|
| `scripts/check_db.py` | Quick DB inspector. Prints row counts and sample rows for each table. Run with `python scripts/check_db.py`. |
| `scripts/test_fetch.py` | Manual integration test script. Exercises fetch endpoints against the running server. |

**Documentation** (`docs/`)

| File | Description |
|------|-------------|
| `docs/USER_GUIDE.md` | Non-technical user documentation. Covers every tab, filter, and workflow step including PurpleFox JWT extraction. |
| `docs/DEPLOY.md` | VPS deployment guide: DNS, systemd service, nginx reverse proxy, Let's Encrypt TLS, firewall, security checklist. |

**Agent / Developer Reference** (`agent/`)

| File | Description |
|------|-------------|
| `agent/AGENT_CONTEXT.md` | Technical reference for AI agents and developers: architecture, all API routes, DB schema, JS function index, upsert conventions, known gotchas. Start here when making code changes. |

**Plans** (`plans/`)

| File | Description |
|------|-------------|
| `plans/CURRENT_PLAN.md` | Three-phase roadmap (auth overhaul → PostgreSQL/events → analytics/infrastructure) with SQL schemas, endpoint tables, code examples, and verification checklists. |
| `plans/QOL_IMPROVEMENTS.md` | Quality-of-life improvement plan: extension logistics filtering, round comparison, pace indicators, operator notes, keyboard shortcuts, filter persistence, and more. Each item is self-contained and can be shipped between events. |
| `plans/archive/TODO.md` | Original improvement backlog (superseded by the plans above — kept for reference). |
| `plans/archive/production-ready.md` | Earlier productionization planning doc (superseded by Phase 1 of `CURRENT_PLAN.md`). |

---

## Documentation

- [agent/AGENT_CONTEXT.md](agent/AGENT_CONTEXT.md) — architecture, all routes, DB schema, JS function index
- [docs/USER_GUIDE.md](docs/USER_GUIDE.md) — end-user instructions for every tab and workflow
- [docs/DEPLOY.md](docs/DEPLOY.md) — VPS deployment with nginx + systemd + TLS
- [plans/CURRENT_PLAN.md](plans/CURRENT_PLAN.md) — three-phase roadmap
- [plans/QOL_IMPROVEMENTS.md](plans/QOL_IMPROVEMENTS.md) — quality-of-life improvement queue
