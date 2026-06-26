# Plan — User Guide Improvements

**Status:** Not started · **Owner:** TBD · **Created:** 2026-06-26

## Why

`docs/USER_GUIDE.md` still documents the **legacy Python + SQLite app**, not the current
TypeScript + PostgreSQL + React build. It is misleading to staff and out of sync with every feature
shipped since Phase 0. The in-app **Guide tab** (`client/src/components/.../GuidePanel.tsx`) is the
second user-facing surface and must stay consistent with the markdown doc — both need the same rewrite.

## Evidence the doc is stale

Concrete tells in the current `docs/USER_GUIDE.md`:

- Describes a "raw **SQLite** database browser" with "all **12 local tables**" — the app is PostgreSQL now.
- Two hardcoded users **`admin` / `hj`** — the real model is role-based **`admin` / `superadmin`** (see `isAdmin` / `isSuperadmin` in `client/src/App.tsx`).
- "Run backfill … for **both tournaments**" — there is no two-tournament backfill; tournaments are selected individually and managed per-tournament.
- Lists tabs **Logs, Insights, Infractions, Session, Debug, Guide, Schema, Data** — the real tab set (from `App.tsx`) is **Dashboard, Logs, Insights, Guide, Reports (admin), Session, Data, Manage (superadmin)**.
- No mention of **Dashboard**, **Reports**, or **Manage** — the three most important current tabs.
- Token described as "valid ~1 hour"; conflates the PF **JWT** (short-lived, in-memory) with the **login session** (separate). Needs disentangling.

## Current real tab set (ground truth — `client/src/App.tsx`)

| Tab | Who | What it is now |
|---|---|---|
| **Dashboard** | all | Primary live view; active round, outstanding tables, round selection (`DashboardRoundProvider`). Not in the old guide at all. |
| **Logs** | all | Event feed grouped by round (drops, extensions, penalties, **judge seats / coverage**, results). |
| **Insights** | all | Round-by-round summary. New since old guide: **seating gap** column, **overtime** column. |
| **Guide** | all | In-app help (`GuidePanel`), role-aware. Must mirror this doc. |
| **Reports** | admin+ | **Fixed Seating Report** + **Round Timing Report**. Entirely undocumented. |
| **Session** | all | Paste PF **JWT** for live sync. |
| **Data** | admin | Raw **PostgreSQL** table browser (replaces the old "Data"/SQLite + "Schema" tabs). |
| **Manage** | superadmin | Tournament/admin operations, health checklist. Not in old guide. |

## Scope of work

1. **Rewrite `docs/USER_GUIDE.md` top to bottom** against the real tab set above. Delete all SQLite /
   `hj` / "both tournaments" / "Schema tab" / "Debug tab" legacy language.
2. **Document the Reports tab** (new, highest-value):
   - **Fixed Seating Report** — what it shows (each fixed-seat player's name, assigned seat, current
     table, opponent; blue highlight + `FS` badge when both players are fixed-seat), Refresh/Print,
     and that it reflects the round that currently has pairings (pre-timer included).
   - **Round Timing Report** — columns (Published At, Round Time Start, Scheduled End, Additional
     Time Used, Play Time, Since Publish, Seating Turnover, Tables Playing After Time, Max Extension),
     CSV export, and which columns are still proxies. Cross-reference `plans/reports.md`.
3. **Document the new Insights columns** — seating gap (`play_started_at − started_at`) and overtime
   (`last_match_completed_at − timer_end_datetime`), in plain language.
4. **Correct the auth/role model** — `admin` vs `superadmin`, what each unlocks (Reports = admin+,
   Manage = superadmin), tournament selector, and PF+Carde vs Carde-only modes (in Carde-only mode
   there are no drops/penalties/coverage/judge calls — set that expectation).
5. **Fix the Session/JWT section** — separate the 7-day login session from the short-lived in-memory
   PF JWT; explain re-paste after server restart (`inMemory: false`).
6. **Reconcile the in-app Guide tab** (`GuidePanel.tsx`) with the rewritten doc so the two never drift.
   Decide whether the doc is generated from / linked to the panel, or kept deliberately in sync.
7. **Add a "what's not available" note** — StageTimer (Phase 2, may not be live yet), and that
   "who started the round / who marked tables done" is **not recoverable from PurpleFox** (no audit log).

## Open questions

- Is `docs/USER_GUIDE.md` published anywhere, or staff-internal only? Affects tone/depth.
- Should the markdown doc be the source of truth and the Guide tab render it, or are they independent?
- Is the "Infractions" view gone, or folded into Insights/Logs? Confirm before writing.

## Done when

- `docs/USER_GUIDE.md` matches the real tab set and feature set with zero legacy references.
- Reports tab (both reports) and the new Insights columns are documented.
- Role model and PF JWT lifecycle are accurate.
- In-app Guide tab and the markdown doc agree.
