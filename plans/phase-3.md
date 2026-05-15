# Phase 3 — Depth, Polish, and Infrastructure

**Goal:** Production-grade reliability, advanced analytics, infrastructure tooling, and full integrations for future platform support.

**Prerequisites:** Phase 2 complete.

---

## 3.1 — Advanced Analysis

- Per-table incident heatmap: tables appearing across drops, extensions, judge seats, and penalties — slow play candidate identification
- Drop timing analysis: flag drops arriving after `timer_end_datetime`
- Judge efficiency report: tables covered per judge, repeat coverage, response time distribution
- Extension pattern report: average extension per round → inform future round length decisions
- Cross-tournament event summary: aggregate stats across all tournaments in an event
- Event timeline view: visual Gantt of rounds across all tournaments in an event
- Standings generation investigation: determine if Carde's standings endpoint exposes a `generated_at` field usable as a pairings-published proxy

---

## 3.2 — Export & Reporting

- Print view / PDF export per round (`@media print` + print button)
- CSV export for drops, penalties, pairings (admin only)
- "What's new since last sync" summary banner in Logs tab

---

## 3.3 — Notifications

- Browser push notifications for new drops and penalties during live worker cycles (Web Notifications API, opt-in per device)
- Toast system: completed in Design Phase for in-app toasts; this item adds the push notification layer on top

---

## 3.4 — Infrastructure & Reliability

- Docker Compose: nginx + app + PostgreSQL — one-command local and server deployment
- DB migration runner: Prisma migrations already handle this; add a `migrate:prod` script and document the runbook in `DEPLOY.md`
- Graceful shutdown: drain in-flight worker cycles, close DB connections cleanly on SIGTERM
- Connection retry with exponential backoff for Supabase and Carde failures; surface persistent errors in UI
- Expanded `/api/health`: per-tournament last sync time, worker cycle duration, PF JWT expiry, DB connection pool stats
- Audit access log: who viewed which tournament and when (separate from `app_activity` which tracks writes)
- `CARDE_API_TOKEN` rotation runbook documented in `DEPLOY.md`
- DB vacuum + analyze on a weekly schedule
- `scripts/check_db.ts` — CLI inspector for DB health, row counts, raw vs. normalized sync status
- `scripts/test_fetch.ts` — integration test suite against real test-environment endpoints
- `Makefile` with: `make start`, `make migrate`, `make seed`, `make backup`, `make create-user`
- `CHANGELOG.md` for non-technical operators (plain-language notes per deploy)
- Git tag convention: tag each event deploy (e.g. `v2026-05-atlanta`) for rollback

---

## 3.5 — Partial Venue Coverage UI

On large events, PurpleFox and StageTimer cover only a section of the venue. The UI must make this transparent rather than implying full coverage.

- Per-tournament config: `managed_tables_min`, `managed_tables_max` (or list of ranges) stored in `app_tournaments`
- In Insights tab: note when outstanding-table counts and extension data only reflect a managed subset
- Round timing view: flag when StageTimer coverage is partial vs. full

---

## 3.6 — Melee.gg Full Integration

Melee.gg is used for Magic: The Gathering events (EventLink replacement). Full import path for pairings and round structure.

- Drag-and-drop file upload in Manage tab (tournament detail)
- Scheduled re-import: re-process last uploaded file on each manual sync
- Feature detection: show which columns are available per provider combination
- Diff view: highlight pairings that changed since last import

---

## 3.7 — Future Provider Readiness

`tournament_source_mapping` already supports arbitrary new `source` values. Document the provider interface in `agent/AGENT_CONTEXT.md`. Candidates: EventLink (WotC), Tabletop.to, manual-entry-only mode.
