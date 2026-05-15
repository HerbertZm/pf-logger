# API Exploration: Lessons Learned
_Written after a deep-dive analysis session on Atlanta Regional Qualifier data (Apr 25–26, 2026)_

---

## Goal

Build a tool that can produce, out-of-the-box, a round-by-round timing table with:
- Pairings published time
- Timer start / scheduled end / actual end
- Time between rounds (break duration)
- Round turnover time
- Seatings turnover time
- Total round duration
- Outstanding tables at timer end (with/without extensions)

What follows is what we actually found vs. what we expected.

---

## 1. Carde API: What We Got Wrong

### `completed_at` is NOT "when the round ended"

For Swiss rounds, `completed_at` and the next round's `started_at` are set **at the same instant** — they're a single button click in the UI ("Complete & Pair Next Round"). This means:

- `completed_at` on round N = `started_at` on round N+1 (always, for normal Swiss)
- **It is useless as a "last result entered" timestamp**
- The only rounds where they diverge are boundary cases: R8 (overnight gap before Day 2) and R13 (phase transition to Top 8 with manual start)

**Implication for the tool:** Do not use `completed_at` to compute break duration. Use `timer_end_datetime` (scheduled end) as the anchor for break start.

---

### `timer_end_datetime` is not in the API response

The API documentation lists `[].rounds[].timer_end_datetime` as a field in `get_all_rounds/`. **It does not appear in actual responses for completed events.** We had to compute it locally as:

```
timer_end_datetime = started_at + timer_duration_minutes * 60 + extra_time_seconds
```

**Implication for the tool:** This field must be computed, not fetched. Confirm whether it appears in responses for *live* events.

---

### `tournament_overview` returns 404 for completed events

`GET /api/magic-events/{event_id}/tournament_overview/` is the endpoint that provides live timer state (is it running, time remaining, etc.). It **404s for completed events.** All other per-round sub-endpoints (timer, audit, history) also 404 post-completion.

**Implication for the tool:** Any live timer data must be captured during the event. We have no retroactive access to it.

---

### No pairings timestamp exists on carde

There is no `pairings_published_at`, `pairings_generated_at`, or any timestamp related to when pairings were released. The only field is `pairings_status` (a string like `"PUBLISHED"`). We have no way to know how long seating/pairing took.

**What we used instead:** Our local DB records `started_at` for each round (when carde starts the round timer), which we used as a proxy for "pairings published." This may actually be accurate if TO behavior is: generate pairings → publish → start timer in quick succession.

---

### `result_reported_at` is null for draws

Any match that ends in a draw has `result_reported_at: null`. `updated_at` must be used as a proxy for when the result was entered for these matches.

---

### Matches-list endpoint: which one actually works

There are two related endpoints:
1. `GET /api/v2/organize/matches/?event_id=...` — **all filters silently ignored**, always returns full count
2. `GET /api/v2/organize/tournament-rounds/{round_id}/matches-list/` — **some filters work** (confirmed: `judge=assigned_to_me`, `search=<name>`; `ordering=table_number` and `ordering=-table_number` work)

The second endpoint is the correct one to use. Filter discovery is still in progress (see Section 4).

---

### Round match counts decrease across rounds — this is expected

When hitting `tournament-rounds/{round_id}/matches-list/`, each round returns only that round's matches. The decreasing counts are explained by two normal tournament behaviors:

- **Byes in early rounds**: No-show registrants and odd-player-count byes inflate R1 (1487 matches → ~2974 player slots). These are the `table_number: -1` entries.
- **Player drops**: As players fall out of prize contention, they drop from the event. R2 drops to 809, R13 is down to 106.

Per-round match counts for Atlanta RQ:
| Round | Matches | ~Active players |
|---|---|---|
| R1 | 1487 | ~2974 |
| R2 | 809 | ~1618 |
| R3 | 750 | ~1500 |
| R4 | 721 | ~1442 |
| R5 | 655 | ~1310 |
| R6 | 562 | ~1124 |
| R7 | 459 | ~918 |
| R8 | 358 | ~716 |
| R9 | 148 | ~296 |
| R10 | 145 | ~290 |
| R11 | 136 | ~272 |
| R12 | 117 | ~234 |
| R13 | 106 | ~212 |

**The timer app (max table 451) only covered a fraction of the venue.** Tables 452+ self-reported results directly into carde without the broadcast timer. This is why our `time_logs` and `missing_tables_json` only reflect a subset of the full event — the tool was deployed for the "featured" section of the venue.

---

## 2. Our Own DB: What We Got Wrong

### `missing_tables_json` is a sync-time snapshot, not a round-end snapshot

When our tool syncs after a round ends, it captures which tables are still missing results at that moment. But:
- If sync happens late (e.g., R12 was synced very late), the snapshot is nearly empty and **not representative** of what was actually outstanding at timer end
- R12 captured only 4 tables despite 28 likely being outstanding at timer end
- Only R8 and R13 had reliable snapshots

**Implication for the tool:** We need to capture the snapshot **at the moment the timer expires**, not at next sync. This likely means a webhook or timer-triggered sync.

---

### `time_logs` only captures extensions, not all table activity

Our `time_logs` table records "Change time from X to Y" events from PurpleFox. This tells us who got extensions and by how much, but:
- It doesn't tell us which tables were still playing at timer end
- It can't be used alone to determine outstanding tables — only cross-referencing with `missing_tables_json` gives that picture

---

### `round_timers.completed_at` vs. actual round end

Same issue as the carde API: `completed_at` in our DB comes from carde and has the same problem — it reflects "round paired" not "last result entered."

---

## 3. Timer App (Third-Party): Timezone & Interpretation

- Timer app logs are in **UTC**
- The event was in **EDT (UTC-4)**
- Convert: `app_time + 4 hours = local event time`
- The user was in UTC+2 during analysis, making logs appear 6 hours behind local — don't let this confuse the offset

Additionally:
- "Stops" in the timer app are often mid-round pauses, not round ends
- The actual round end is the **last stop before the next round's reset**
- R2 on Day 1 was started by "Device FA38" (a secondary device), not the head TO — so `started_by` identity is not reliable

---

## 4. Open Questions for API Exploration

These need a proper session with browser dev tools or the Claude browser extension to answer:

### Matches-list filters
Using `GET /api/v2/organize/tournament-rounds/{round_id}/matches-list/`:
- What are the valid `ordering` values beyond `table_number`?
- What does `judge=<value>` accept beyond `assigned_to_me`?
- Is there a `status` filter that works?
- Is there a `result_pending` or `no_result` filter?
- Note: `has_time_extension` / `time_extension_seconds` filters are low priority — see Section 5 on extension data source.

### Round structure
- Is the cumulative count hypothesis correct? What does R1 actually contain?
- Is there a per-round match count available anywhere?
- Do match objects include a `round_id` field so we can filter by it?

### Standings endpoint
- `GET /api/v2/organize/tournament-rounds/{round_id}/standings/` — does response metadata include a `generated_at` timestamp?
- Does this endpoint work for all round types (Swiss, Top 8)?

### Live vs. completed event differences
- Map all endpoints that return 404 for completed events but data for live events
- Specifically: does `tournament_overview` for a live event include current timer state, pairing timestamps, or pending match count?

---

## 5. Time Extensions: Source of Truth is PurpleFox, Not Carde

Time extensions are granted and tracked entirely within **PurpleFox** (our judge management tool). They are **not entered into carde** — the `time_extension_seconds` field on carde match objects will always be 0 for events using our setup.

This means:
- Any carde-side filter for `has_time_extension` is useless for our events
- Extension data lives in our `time_logs` DB table (PurpleFox sync)
- The carde matches-list `time_extension_seconds` field can be ignored for all current analysis

**Future consideration (carde-only deployments):** If the tool is ever used for events that don't use PurpleFox, extension data would need to come from carde's `time_extension_seconds` field. At that point, revisit whether the matches-list `has_time_extension` filter actually works, and whether the field is populated correctly by TOs who grant extensions directly in carde.

---

## 7. Recommendations for the Tool

### Data that must be captured live (cannot be reconstructed)
| Data point | Why it can't be reconstructed |
|---|---|
| Outstanding tables at timer end | `missing_tables_json` is a snapshot — needs to be triggered at timer expiry |
| Live timer state | `tournament_overview` 404s after completion |
| Pairings publish time | No timestamp exists on carde at all |

### Suggested architecture changes
1. **Timer-triggered sync**: When the carde timer expires (or when we detect `timer_end_datetime` has passed), immediately capture `missing_tables_json`. This is the single highest-value improvement.
2. **Store per-match `updated_at` at round end**: Fetching all matches for a round right after it closes would let us reconstruct who finished late and who had extensions — cheaply, since it's a one-time fetch per round.
3. **Standings generation timestamp**: If the standings endpoint includes metadata with a `generated_at` field, capture that — it's the closest proxy to "pairings published" we'll have.
4. **Timezone-aware storage**: Confirm all timestamps stored in the DB are UTC with explicit tz info. The timer app / carde discrepancy caused repeated confusion.

### Data quality flags to add to the UI
- Flag rounds where `missing_tables_json` was captured late (> N minutes after `timer_end_datetime`)
- Flag `max_extension` values that look like data entry errors (e.g., 99 min)
- Flag rounds where `completed_at` == next round's `started_at` (expected for Swiss) vs. where they differ (anomalous)

---

## 8. Summary: What the Table We Built Actually Shows

| Column | Source | Confidence | Notes |
|---|---|---|---|
| Round | carde `get_all_rounds` | ✅ High | |
| SK Pub (round start) | carde `started_at` | ✅ High | Proxy for pairings published |
| App Timer Start | Timer app log | ✅ High | Converted from UTC |
| App Sched End | Timer start + 60 min | ✅ High | |
| App Actual End | Timer app log (last stop) | ✅ High | |
| Between Rds | Prev `timer_end` → this `started_at` | ✅ High | |
| Rd Turnover | `app_sched_end` → next `started_at` | ✅ High | |
| Seatings Turnover | `app_actual_end` → next `app_timer_start` | ✅ High | |
| Total Duration | `app_timer_start` → `app_actual_end` | ✅ High | |
| Extensions | `time_logs` (PurpleFox) | ✅ High | Count and max |
| Outstanding tables | `missing_tables_json` | ⚠️ Partial | Only R8, R12 (unreliable), R13 |
| Outstanding w/ ext | Cross-ref above | ⚠️ Partial | Only R8 and R13 reliable |
| Total duration R8/R13 | Manual match fetch (`updated_at`) | ✅ High | Found last result via individual API calls |
