# Carde.io Admin API — HAR Analysis Prompt for Claude Code

## CONTEXT

This is a continuation of a live browser API exploration session for the **Carde.io** tournament management platform. A HAR file has been captured during a real tournament run (event `611916`, 3-round Swiss). The goal is to produce a complete API reference for building a tournament operations tool.

**Your job:** Analyze the attached HAR file, cross-reference with the confirmed findings below, fill in every open question, and produce the final markdown API reference in the output format specified at the bottom of this file.

---

## SESSION PARAMETERS

| Parameter | Value |
|-----------|-------|
| Base URL (API) | `https://api.admin.carde.io` |
| Base URL (UI) | `https://admin.carde.io` |
| Event ID | `611916` |
| Round IDs | R1=`842725`, R2=`842726`, R3=`842727` |
| Settings ID | `458426` |
| Auth header | `Authorization: Token ca05adef010f23d3eed5e56900f4959100681077` |
| HAR capture start | After round 1 pairings published, timer already running |
| HAR capture end | After round 2 result + round 2→3 transition (at minimum) |

---

## CONFIRMED FINDINGS (from live session — treat as ground truth, do NOT re-derive)

### Timer Architecture

- `timer_end_datetime` is a **static ISO timestamp** — it does NOT decrement. Present on `tournament_overview` and `v2/organize/events/{id}/detail/` response bodies.
- `timer_is_running` does **NOT flip to `false`** when the timer expires. It stays `true` indefinitely until the round is manually completed.
- `timer_end_datetime` is **not present on round objects** in `get_all_rounds`. It lives only on the event-level endpoints above.
- `timer_duration_minutes` on round objects is **`null`** even while the timer is actively running.
- `timer_end_datetime` is offset from `started_at + (duration * 60s)` by **+7 to +83 seconds** of server-side processing lag.
- When `edit_current_round_timer` fires, it **always fires twice in rapid succession** (double-write pattern — both calls appear in network log within ~1s of each other).

### Extra Time / Time Extensions

- **Round objects do NOT have** `extra_time_seconds` or `additional_time_seconds`. These fields do not exist on round objects.
- **Match objects DO have** `time_extension_seconds` (integer, seconds). Confirmed non-null on matches where TO added extra time.
- `timer_end_datetime` on the event-level endpoints reflects only the **round-level timer** — it does NOT account for per-match time extensions.
- A "+0 min" extension badge appeared in the UI for a match that received 2 seconds of extra time — confirming `time_extension_seconds` is in seconds, not minutes.

### Round Lifecycle

- All rounds are **pre-created upfront** — all 3 rounds existed in `get_all_rounds` from the very first call, before any round was started.
- `carde_status` values observed: `COMPLETE` (R1), `IN_PROGRESS` (R2), and (presumably) `PENDING` or similar for R3 — **confirm exact value for not-yet-started round from HAR**.
- `completed_at` on a round is set at the **exact moment of round turnover** and equals `started_at` on the next round. This is atomic.
- `completed_at` is `null` while a round is `IN_PROGRESS`.
- `publish_pairings_and_turnover_round` is the **single endpoint** for both publishing pairings AND advancing to the next round. One POST does both.

### Matches List

- `page_size=200` works and returns all matches in one call.
- `avoid_cache=true` query param works without errors.
- `status=in_progress` filter works.
- `ordering=table_number` works and returns ascending order.
- Response is paginated: `{ count, next, previous, results: [...] }`.
- `user_identifier` on player objects is a **display name string** (e.g. `"Aldo M"`), not a UUID or numeric ID.
- `is_ghost_match` field is present on match objects (boolean).
- `assigned_judge` field is present on match objects (type unknown — confirm from HAR: null / object / string).
- `table_number: -1` entries — **confirm presence/absence from HAR**.
- Intentional draw fields: `match_is_intentional_draw: true`, `games_drawn: 3`, `winning_player_id: null`.
- `result_reported_at` is populated when result is submitted; `null` for pending matches.
- `updated_at` is populated on all match objects.

### UI Bugs Found

- The UI was requesting `matches-list?page=29&page_size=25` for a 2-match round (page 29 does not exist → 404). This was a bug in the tool being built, not in Carde's API.

---

## OPEN QUESTIONS (answer these from the HAR)

### Priority 1 — Timer

1. **What is the exact response body of `edit_current_round_timer`?** Both the first and second of the double-fire calls. Are they identical? What fields does the response contain?
2. **Does `timer_end_datetime` update in the `tournament_overview` response after an `edit_current_round_timer` call?** Diff the response body before and after the timer edit call in the HAR.
3. **What is the `timer_end_datetime` value immediately after `publish_pairings_and_turnover_round`** for Round 2? Is there a brief window where the old Round 1 timer value is still returned before the new timer is set?

### Priority 2 — Round Turnover

4. **What is the full response body of `publish_pairings_and_turnover_round`?** All fields.
5. **What is the exact `carde_status` value for a not-yet-started round** (R3 before R2 completes)? Options: `PENDING`, `NOT_STARTED`, `UPCOMING`, `CREATED`, etc.
6. **Is there a `repair/` endpoint call in the HAR?** If so, what is its full request + response shape? (`POST /api/v2/organize/tournament-rounds/{round_id}/repair/`)

### Priority 3 — Matches & Results

7. **What is the full shape of a completed match object?** Include all fields from `matches-list` for a match with a submitted result (after `result_reported_at` is populated).
8. **What is the full shape of the `player_match_relationships` array?** Include all keys per entry (player_id, seat, player_match_relationship_id, etc.).
9. **What endpoint is called when a result is submitted?** Full URL, method, request body shape, response body shape.
10. **Is `table_number: -1` present on any match objects?** If so, what does it represent?
11. **What is the type/shape of `assigned_judge`?** null, object with id/name, or string?

### Priority 4 — Penalties

12. **What endpoint is called when a penalty is issued?** Full URL, method, request body (player_id? penalty_type? description?), response body.
13. **What does `GET /api/magic-event-settings/458426/list_questions/` return?** Full response body — this appears to be the penalty categories/infraction types list.
14. **Are penalties attached to match objects or player objects?** Check match objects in `matches-list` for a `penalties` array or similar field.

### Priority 5 — Standings

15. **What endpoint serves standings data?** Likely `GET /api/magic-events/611916/standings/` or similar — confirm URL from HAR.
16. **What is the full standings response shape?** Fields per player entry (rank, points, OMW%, GW%, OGW%, tiebreakers).
17. **Is there a separate `publish_standings` endpoint call,** or does standings publication happen automatically at round turnover?

### Priority 6 — Misc

18. **What fields does `v2/organize/events/611916/detail/` return** that `tournament_overview` does NOT? (Or vice versa — are they identical?)
19. **Does any endpoint return `timer_remaining_seconds` as a live value?** (Expected: No — but confirm.)
20. **What HTTP method and request body does the time extension call use?** (`edit_current_round_timer` — is it POST with `{ minutes: N }` or PATCH with something else?)

---

## ENDPOINTS TO EXTRACT FROM HAR

For each of the following, extract: **full URL, HTTP method, request headers, request body (if any), response status, full response body.**

### Known endpoints (confirm and document):

```
GET  /api/magic-events/611916/tournament_overview/
GET  /api/magic-events/611916/get_all_rounds/
GET  /api/v2/organize/events/611916/detail/
GET  /api/magic-event-settings/retrieve_by_event_id/?event_id=611916
GET  /api/magic-event-settings/458426/list_questions/
GET  /api/v2/organize/tournament-rounds/842725/matches-list/
GET  /api/v2/organize/tournament-rounds/842726/matches-list/
POST /api/v2/organize/tournament-rounds/842725/publish_pairings_and_turnover_round/
POST /api/v2/organize/tournament-rounds/842726/publish_pairings_and_turnover_round/
POST /api/v2/organize/tournament-rounds/{round_id}/edit_current_round_timer/
POST /api/v2/organize/tournament-rounds/842725/repair/
```

### Unknown endpoints to find (search HAR for these patterns):

```
POST /*/results*           # result submission
POST /*/penalty*           # penalty creation
GET  /*/standings*         # standings fetch
POST /*/standings*         # standings publish
GET  /*/players*           # player roster
POST /*/drop*              # player drop (if present)
```

---

## PHASE TIMELINE (for HAR navigation)

Use this to orient yourself within the HAR:

| Phase | What happened | What to look for |
|-------|--------------|-----------------|
| HAR Start | R1 complete, R2 about to be paired | `get_all_rounds` baseline, R1 `completed_at`, R2 `carde_status` |
| R2 pairings published | `publish_pairings_and_turnover_round` for R2 | Response body, `timer_end_datetime` race window |
| R2 timer set | `edit_current_round_timer` (×2) | Request body, response body, both calls |
| R2 in progress | Polling calls from UI | Poll interval, which endpoints are polled |
| Table 2 draw | Result submission | Endpoint URL, request body, match object shape |
| Time extension | Timer edit on match | Which endpoint, request/response |
| R2 complete | `publish_pairings_and_turnover_round` for R3 | Response body, `completed_at` timing |
| Between rounds | Standings, `get_all_rounds` | `carde_status` on R2 after completion |
| R3 timer set | `edit_current_round_timer` (×2) | Same as R2 — confirm identical pattern |

---

## FINAL OUTPUT FORMAT

Produce a single markdown document with exactly these 8 sections:

### Section 1: Timer State — Where It Lives and When

Table with 4 rows (Pre-round / Clock running / Clock expired / Between rounds) × columns:
- `tournament_overview` timer fields and values
- `get_all_rounds` round-level timer fields and values
- `timer_is_running` value
- Notes

### Section 2: `tournament_overview` — Full Confirmed Field List

Every top-level key with: field name, type, example value, notes. Sorted alphabetically.

### Section 3: `get_all_rounds` — Full Confirmed Round Object Field List

Every field per round object with: field name, type, example value from R1 (complete) vs R2 (in-progress) vs R3 (not-started). Mark any fields that differ by round state.

### Section 4: `matches-list` — Full Confirmed Match Object Fields

Every field on a match object. Include `player_match_relationships` sub-object fields. Mark: pending vs completed vs draw differences.

### Section 5: Key Timing Conclusions

Answer each of these directly (one sentence each):

1. Can you detect timer expiry from the API alone, without polling? How?
2. Does `timer_end_datetime` include per-match time extensions? How would you compute a "true" deadline for a specific table?
3. Is the timer a live countdown or a static target timestamp?
4. At what exact moment is `completed_at` set on a round?
5. Does `timer_is_running` ever flip to `false` automatically?
6. How many seconds of lag exist between `started_at` and `timer_end_datetime - timer_duration_minutes*60`?

### Section 6: Endpoint Reference

For every confirmed endpoint, a mini-spec:

```
## GET /api/magic-events/{event_id}/tournament_overview/
Auth: Token
Params: none
Response: 200 { ... full field list ... }
Notes: ...
```

### Section 7: Surprises

Bulleted list of anything unexpected, undocumented, or counterintuitive.

### Section 8: Open Questions

Anything the HAR did not answer. Mark each as `[BLOCKER]`, `[NICE-TO-HAVE]`, or `[LOW-PRIORITY]`.

---

## NOTES FOR CLAUDE CODE

- The HAR may contain duplicate requests (UI polling). Use the earliest instance for baseline, latest for final state.
- Request/response bodies in HAR are base64-encoded in some tools — decode if needed.
- The auth token in the HAR is a real token. Do not log it to stdout or include it verbatim in the final output — use `Token [REDACTED]` in the reference doc.
- If a response body is truncated in the HAR, note it as `[TRUNCATED IN HAR]` rather than guessing.
- Treat confirmed findings above as ground truth — if the HAR contradicts them, flag the discrepancy but do not override the confirmed finding without noting both values.
- The double-fire pattern on `edit_current_round_timer` is intentional UI behavior, not a bug.
