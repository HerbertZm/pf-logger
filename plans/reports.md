# Reports — Round Timing Report (Event Admin)

**Goal:** Post-event and mid-event analysis table for **admin+** staff — one row per Swiss round with timing metrics used for head-judge debriefs and future round-length decisions.

**Status:** **v1 shipped** (2026-06-01) — admin+ tab, API computation for five columns, UI table, column reference, CSV export. Still blocked on Carde publish timestamp and StageTimer for remaining columns. Tournament timezone display uses `America/New_York` placeholder until P1 §1.2.

**Prerequisites:** Phase 1 timezone (§1.2), ingestion worker capturing `missing_tables_json` at timer expiry. StageTimer import (Phase 2.5) unlocks **Round Time Start** from SK/StageTimer logs.

---

## Access

| Role | Access |
|---|---|
| `user` (judge) | No — operational tabs only |
| `admin` / `superadmin` | Yes — **Reports** tab |

Future: when Phase 2.1 event permissions land, scope report to tournaments within the admin's assigned events.

---

## UI

**Tab:** `Reports` (desktop tab bar; admin+ only)

**Layout:** Full-width main content only — **no** `IndicatorsLayout` sidebar (same pattern as Session / Data tabs).

**Primary view:** `RoundTimingReportTable` — full-width scrollable table + **Export CSV** (header action).

**Column reference:** `RoundTimingColumnGuide` below the data table — two-column glossary (label + description) driven by `reportColumns.ts`, left-aligned, full width.

**Empty states:**
- No tournament selected → prompt via context bar
- Tournament has no rounds → "No rounds yet"
- Round row with missing source data → show `—` per cell; optional column-level "n/a" tooltip explaining which source is missing

---

## Column specification

All wall-clock fields display in **tournament timezone** (P1 §1.2). Durations below are stored or computed in **seconds** in the API; the UI formats as `Xm`, `XhYm`, or `XmYs` per column (see Formatting).

| Column | Description | Computation | Primary source | Phase |
|---|---|---|---|---|
| **Round Number** | Swiss round index | `round.round_number` | Normalized `rounds` | P0 |
| **Published At** | When pairings were published for players to see | TBD — Carde field TBD from API exploration | Carde pairings publish timestamp | TBD |
| **Round Time Start** | When the head judge called "you may begin" | StageTimer `start` event for round, or SK log equivalent | StageTimer import + manual SK log | 2.5+ |
| **Round Time Scheduled End** | Scheduled end from judge start + configured round length | `roundTimeStart + timer_duration_minutes` (default 60m if unset for Swiss) | Derived | 1.x |
| **Additional Time Used** | Time from scheduled end until last match result | `lastMatchResultAt - roundTimeScheduledEnd` (clamp ≥ 0) | Carde `result_at` / match timestamps | 1.x |
| **Total Duration (Play Time)** | Playing time: judge start → last result | `lastMatchResultAt - roundTimeStart` | Carde match results | 1.x |
| **Total Duration (Since Publish)** | Full round window: publish → last result | `lastMatchResultAt - publishedAt` | Carde | TBD |
| **Seating Turnover** | Publish → judge start (players finding seats) | `roundTimeStart - publishedAt` | Carde + StageTimer | 2.5+ |
| **Tables Playing After Time** | Matches still in progress when timer expired | Count from `rounds.missing_tables_json` at `snapshot_captured_at` | PF Logger snapshot + Carde | P0 (partial) |
| **Max Extension** | Largest single-table extension in the round | `MAX(extension_minutes)` for round from PF extensions; format as minutes | PurpleFox `tournament_logs` | P0 |

### Domain rules (do not violate)

- **Never** use Carde `completed_at` as round end — it equals the next round's `started_at` for Swiss.
- **Never** use Carde `timer_is_running` to detect expiry — compare `timer_end_datetime` to wall time.
- Top-8 rounds: `timer_duration_minutes IS NULL` — exclude from this report or show a separate Top-8 section later.
- Outstanding tables **include** tables with extensions.
- PF+Carde mode: extensions from PF only; Carde `time_extension_seconds` is 0 for our events.

### Open data gaps (resolve before claiming a column)

| Gap | Blocker | Action |
|---|---|---|
| Published At | Unknown Carde field for "pairings visible to players" | P0 API exploration — document field on `raw_carde_rounds` |
| Round Time Start | No StageTimer rows in DB yet | Phase 2.5 import; until then column stays `—` |
| Last match result time | Need aggregate per round from `matches.result_at` | Add worker rollup or query in report endpoint |
| SK Log | Out of scope for v1 unless parsed manually | Document as future import type |

---

## API

### `GET /api/reports/round-timing?tournamentId=:id`

**Auth:** `admin` or `superadmin` (`requireAdmin`).

**Response:** `RoundTimingReportRow[]` sorted by `roundNumber` ascending.

```typescript
interface RoundTimingReportRow {
    roundNumber: number;
    publishedAt: string | null;           // ISO UTC
    roundTimeStart: string | null;
    roundTimeScheduledEnd: string | null;
    additionalTimeUsedSec: number | null;
    totalDurationPlaySec: number | null;
    totalDurationSincePublishSec: number | null;
    seatingTurnoverSec: number | null;
    tablesPlayingAfterTime: number | null;
    maxExtensionSec: number | null;
}
```

**v1 (implemented):** `src/services/roundTimingReport.ts` populates:

| Field | Source |
|---|---|
| `roundTimeScheduledEnd` | `rounds.timer_end_datetime`, or `started_at + timer_duration_min` (game default if duration null) |
| `additionalTimeUsedSec` | `max(matches.result_at)` − scheduled end (≥ 0) |
| `totalDurationPlaySec` | `max(matches.result_at)` − `started_at` (Carde proxy until StageTimer) |
| `tablesPlayingAfterTime` | `length(missing_tables_json)` when `snapshot_captured_at` set |
| `maxExtensionSec` | `MAX(extension_minutes) × 60` per round (PF extensions only) |

Still `null`: `publishedAt`, `roundTimeStart`, `totalDurationSincePublishSec`, `seatingTurnoverSec`.

**v2:** StageTimer + Published At.

### Export

`GET /api/reports/round-timing/export?tournamentId=:id[&timezone=America/New_York]` — CSV download (formatted wall-clock and durations for spreadsheets).

### Future

- Event-scoped report aggregating all tournaments under an `app_events` row (P1 events shell)

---

## Backend structure

```
src/routes/reports.ts          — router, requireAdmin
src/services/roundTimingReport.ts   — (future) pure computation from prisma
```

Keep computation out of the route handler once logic grows — table-driven column builders mirroring this doc.

---

## Frontend structure

```
client/src/components/reports/
  reportColumns.ts            — column metadata (key, label, description)
  formatReportValue.ts        — format ISO → local tz; format seconds → display string
  RoundTimingReportTable.tsx  — presentational table
  RoundTimingColumnGuide.tsx  — column reference table
  ReportsTab.tsx              — fetch, export, layout
  ReportsTab.css
```

`client/src/api/client.ts` — `api.download()` for CSV blob responses.

Types mirrored in `client/src/api/types.ts` and `src/api/types.ts`.

---

## Formatting conventions (UI)

| Kind | Example | Rule |
|---|---|---|
| Wall clock | `9:57`, `11:09` | `formatInTournamentTz`, no seconds unless needed |
| Duration (long) | `1h27m`, `1h40m` | Hours + minutes; omit seconds |
| Duration (short) | `27m57s`, `12m03s` | Minutes + seconds when sub-hour precision matters |
| Count | `7`, `26` | Integer |
| Extension max | `23m` or `10m` | Minutes; seconds optional |

Align with sample spreadsheet from ops — not the same rules as the indicators pane (which uses minutes-only).

---

## Build order

```
1. ✅ Scaffold — tab, types, API route, table with headers
2. ✅ tablesPlayingAfterTime + maxExtension from normalized data
3. ✅ scheduled end + play duration from started_at, timer_end, match result_at
4. ⬜ Published At — after Carde field confirmed
5. ⬜ StageTimer — round time start, seating turnover, true play duration
6. ✅ CSV export (formatted cells for spreadsheets)
7. ⬜ Event-level rollup (all tournaments under an event)
8. ⬜ Tournament timezone from P1 §1.2 (replace hardcoded default in UI + export query param)
```

---

## Verification checklist

- Non-admin user does not see Reports tab; direct API call returns 403
- Admin sees full column headers and one row per Swiss round
- Times respect tournament timezone once P1 §1.2 ships
- Top-8 rounds excluded or clearly marked
- No column uses `completed_at` for duration math

---

## Related plans

| Doc | Relationship |
|---|---|
| `plans/phase-1.md` §1.2 | Tournament timezone for display |
| `plans/phase-2.md` §2.5 | StageTimer import |
| `plans/open-decisions.md` OD-3 | `result_at` vs StageTimer for last result |
| `plans/qol.md` | Future CSV / copy helpers |
