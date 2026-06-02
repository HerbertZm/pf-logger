# Phase 2 — Events, Real-Time, and Analysis

**Goal:** Multi-event management with per-event permissions, real-time data push, manual entry, and the first round timing analysis features.

**Prerequisites:** Phase 1 wrapped (2026-06-02) — admin API, Manage tab, CI deploy, public vs admin health, backfill parity, test tournament fixtures.

---

## 2.1 — Event Grouping + Per-Event Permissions

A Regional Weekend has multiple simultaneous tournaments. This groups them under a named event and lets staff be scoped to specific tournaments.

**Prerequisite from P1:** `app_events` already exists with `name`, `short_name`, `timezone`, optional `venue`, and `app_tournaments.event_id`. P1 handles timezone inheritance; this phase adds permissions and UX polish — do not reintroduce a second event table.

**New in P2:** `event_roles` (per-event role overrides per user). Tournament ordering within an event can use `event_tournaments.sort_order` if we outgrow the simple `app_tournaments.event_id` FK (optional — only add if needed).

**Behavior:**
- Non-admin users see only tournaments in their assigned events
- Superadmin and admin see all tournaments regardless
- PF JWT stays global — event permissions are local and orthogonal
- Tournament selector filters by event for scoped users; "(All my tournaments)" is the default view

**New endpoints (all superadmin):** event CRUD, tournament assignment to event, staff role assignment per event.

**Manage tab:** redesigned to be Events-first — event list → event detail with tournament list and staff assignments → tournament management as secondary panel.

---

## 2.2 — Real-Time Push (SSE)

Replace per-client polling with Server-Sent Events. Each ingestion worker cycle pushes to all connected clients after normalizing raw data.

- New `GET /api/stream` endpoint maintains a persistent SSE connection per client
- Each normalized-layer write triggers a push to all connected clients
- Keep polling as fallback for clients that can't maintain SSE connections
- Worker state changes (running, error, idle) also pushed via SSE

---

## 2.3 — Manual Entry

Manual drop and penalty entry from the UI for Carde-only mode or catch-up scenarios.

- Drop entry form in Logs tab (HJ+ role): player name/ID, round, table number, optional note
- Penalty entry form: same fields as PF penalties
- Notes field on manually entered drops and penalties (local DB only, never synced to external sources)
- `source = 'manual'` on all manually entered records
- New endpoints: `POST /api/manual/drops`, `POST /api/manual/penalties`, `PATCH /api/manual/drops/:id/notes`

---

## 2.4 — Round Timing Analysis

**Prerequisite:** Reliable `result_at` data from the ingestion worker (rounds must have `missing_tables_json` captured at timer expiry, and match records must have `result_at` populated).

- Round duration: `started_at` → last `result_at` across all matches in the round
- Scheduled end: `timer_end_datetime` (computed)
- Actual overtime: `last result_at - timer_end_datetime` (null if no outstanding tables)
- Inter-round gap: `round N+1 started_at - round N last result_at`
- Per-user sync activity: "worker last synced X seconds ago" in header

**Note:** `completed_at` is never used for any of these calculations. For Top-8 rounds (`timer_duration_min IS NULL`), duration and overtime fields are omitted entirely.

---

## 2.5 — StageTimer Log Import

StageTimer is an optional broadcast timer used at some events. Its logs are UTC text files, currently processed manually. Adds a first-class import path.

- Upload interface in Manage tab (per tournament)
- Parser: extract start, stop, reset events per round; identify actual clock starts and stops
- Store parsed data in `stagetimer_logs` table (`tournament_id`, `round`, `event_type`, `event_at TIMESTAMPTZ`)
- Use in Insights tab to populate actual timer start/stop times where StageTimer data is available
- Timezone: StageTimer logs are UTC; convert using `app_tournaments.timezone` from Phase 1 §1.2
- Coverage is partial on large events — UI notes when StageTimer data covers only a subset of tables

---

## 2.6 — Completed-Tournament Route Verification

From P0.5 API exploration: several Carde.io endpoints have unknown behavior once a tournament is `COMPLETE` (i.e., past the final round). Verify before relying on them in analysis or reporting.

**Endpoints to test against a completed tournament:**
- `GET /api/v2/organize/events/{id}/detail/` — confirm `timer_end_datetime` and `timer_is_running` are readable and stable post-completion (not 404 or stale)
- `GET /api/v2/organize/events/{id}/rounds/` — confirm all rounds are returned; confirm `COMPLETE` status on all rounds, including Top-8
- `GET /api/v2/organize/events/{id}/matches-list/?status=in_progress` — confirm returns empty list (not 404) for completed events
- `GET /api/v2/organize/tournament_overview/{id}/` — confirm `number_of_incomplete_matches` is 0 and `round` is stable

**If any endpoint 404s post-completion:** add a guard in the ingestion worker that stops polling Carde once the tournament is `isEnded = true`. Currently the worker has no post-completion behavior — it will keep polling indefinitely.

**Add to worker:** when `syncCardeRounds` detects all rounds are `COMPLETE` for N consecutive polls, set `app_tournaments.is_ended = true` and stop the polling loops.

---

## Verification Checklist

- Superadmin creates event, adds 2 tournaments, assigns a judge → judge sees only those 2
- Non-admin cannot sync a tournament outside their event assignments (403)
- SSE: sync cycle completes → all connected clients update without polling
- Manual drop entry: appears in logs feed, marked with `source=manual`
- Round timing: `started_at`, `timer_end_datetime`, overtime all correct for a completed Swiss round; Top-8 rows show no timing data
- StageTimer import: upload log file → round start/stop times appear in Insights
- Completed-tournament routes: all Carde endpoints behave as expected post-completion; worker stops polling after `is_ended = true`
