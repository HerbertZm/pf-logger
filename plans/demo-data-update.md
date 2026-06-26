# Plan — Demo Data Update

**Status:** Not started · **Owner:** TBD · **Created:** 2026-06-26

## Why

`src/db/seed-test-tournament.ts` (`npm run db:seed-test`) is the local demo/dev fixture. It has not
kept up with columns and features added across the 2026-06-21/26 sessions, so several **current
production features render blank against the demo tournament**. A reviewer running the seed today
cannot actually see the round-timing math, the Insights seating-gap/overtime columns, coverage
(seating) logs, or the Fixed Seating Report working.

## Gaps (seed vs. real app)

| Feature / column | Real source | Seed today | Result in demo |
|---|---|---|---|
| `play_started_at` (rounds) | `timer_end_datetime − game.default_round_length_min` | **never set** | Insights **seating gap** blank; report **Round Time Start / Play Time / Seating Turnover** blank |
| `last_match_completed_at` (rounds) | worker stamps when `stillInProgress === 0` | **never set** | Insights **overtime** blank; report **Additional Time Used / last table done** blank |
| `tableCoverage` / `rawPfCoverage` | PF `tables.coveredBy` (seating) | deleted in cascade but **never created** | Coverage / judge-seating logs empty |
| Fixed Seating Report data | live Carde `registrations-slim` (`fixed_seat`) + `matches-list` at request time | no fixed-seat data; `rawCardeRound` deleted, **never created** | Fixed Seating Report **completely empty** |
| `overtime` scenario | needs `last_match_completed_at` after `timer_end_datetime` | scenario sets missing-tables + snapshot only | overtime scenario doesn't actually exercise overtime |

Already correct (no change needed): `judge` on `TableJudgeCall` is populated (line ~321), `timer_end_datetime`,
`missing_tables_json`, matches, drops, extensions, penalties.

## Scope of work

1. **Populate `play_started_at` on every round** with a realistic seating-turnover gap. Because the
   real formula is `play_started_at = timer_end_datetime − default_round_length_min`, model it by
   setting `timer_end_datetime = started_at + gap + 60min` so `play_started_at = started_at + gap`
   (gap ~1–4 min). Keep the existing `play_started_at < started_at` anomaly in **one** round so the
   null/anomaly handling is exercised.
2. **Populate `last_match_completed_at` on COMPLETE rounds** a few minutes after `timer_end_datetime`
   (varying per round) so Additional Time Used / overtime / Play Time all produce non-trivial values.
   In the `overtime` scenario set it well past `timer_end_datetime`.
3. **Create coverage rows** — insert `rawPfCoverage` + `tableCoverage` per round (a handful of tables
   per round with a `coveredBy` judge name), matching the write-once `(tournamentId, tableNumber, coveredBy)`
   shape, so coverage/seating logs appear.
4. **Decide Fixed Seating Report demo strategy.** The report fetches **live from Carde at request
   time** (`registrations-slim` + `matches-list`) using the tournament's real Carde event ID. The test
   tournament uses fake IDs (`999001`), so the live fetch fails — the report cannot be demoed from
   seeded DB rows alone. Options:
   - **(a)** Add a fixture/mock path: when the tournament `isTestTournament`, serve fixed-seating from
     seeded `rawCardeRound` (`pairings_status='GENERATED'`) + a seeded fixed-seat registration table
     instead of calling Carde. *(Recommended — keeps the demo fully offline.)*
   - **(b)** Document that Fixed Seating is not demoable offline and requires a real Carde event.
   Whichever is chosen, also seed `rawCardeRound` rows with `pairings_status='GENERATED'` so the
   round-pairings detection path is at least populated.
5. **Refresh the header comment** in `seed-test-tournament.ts` to list the new fields and any new
   scenario behavior, and update `npm run db:seed-test` docs if the scenario set changes.

## Verification

After re-seeding, in the demo tournament confirm:
- Insights shows non-blank **seating gap** and **overtime** for completed rounds.
- Round Timing Report shows non-blank Round Time Start, Play Time, Additional Time Used, Seating Turnover.
- Logs/coverage view shows judge-seating entries.
- Fixed Seating Report renders (per the chosen strategy) instead of erroring/empty.

## Done when

- A fresh `npm run db:seed-test` produces a tournament where every current Insights and Reports
  column has realistic, non-blank data, and the Fixed Seating Report path is exercised.
