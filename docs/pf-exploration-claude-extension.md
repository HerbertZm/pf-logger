# PurpleFox API Exploration — Complete Field & Schema Reference

**Session date:** 2026-05-21  
**Supabase project:** `upbcarvmkmyzhbosheyo.supabase.co`  
**Supabase URL:** `https://upbcarvmkmyzhbosheyo.supabase.co`  
**Event ID (DLC Indianapolis):** `ad98064b-26e9-4596-988b-2dad193065fb`  
**Test tournament ID:** `8f7a7b52-d7ff-424c-b1aa-5e296cb03a05`  
**Reference populated tournament:** `f9cf3224-60f9-4d13-b902-dc5a795a950a`  
**Auth user (session):** `377d806e-3152-4c49-9820-83c19508e2e7` (Herbert Zurita)  
**JWT expiry:** ~48h from issue, Discord OAuth provider, role: `authenticated`

---

## How to query (auth pattern)

All REST calls use two headers:

```
apikey: {ANON_KEY}
Authorization: Bearer {JWT}
Accept: application/json
```

The anon key is public and embedded in the PF frontend bundle. The JWT is the user's session token — must be refreshed every ~48h via re-login. Staff name resolution uses a Supabase FK join:

```
GET /rest/v1/tournament_logs?select=*,profiles(firstname,lastname)&tournamentId=eq.{id}
```

---

## Tournament creation — what gets written

Only **one** table is written on creation: `tournaments` (single POST → 201).  
No child rows, no seed data. All other tables are written lazily as actions occur.

### `tournaments` row shape (full)
```json
{
  "id": "uuid",
  "name": "string",
  "eventId": "uuid",
  "game": "string",
  "software": "string",
  "round": 1,
  "firstTable": 1,
  "lastTable": 100,
  "defaultTime": 3000,
  "isDone": false,
  "isTeam": false,
  "status": null,
  "prizeStructure": null,
  "seatNames": null,
  "subTournaments": null,
  "melee-tournament-id": null,
  "melee-rounds": [],
  "match-structure": null,
  "extra-tables": null
}
```

**Notes:**
- `round` is the live current round counter — increments as rounds advance
- `firstTable`/`lastTable` are user-editable at any time (not fixed at creation)
- `defaultTime` is in **seconds** (3000 = 50 min)
- Four columns use **kebab-case** (`melee-tournament-id`, `melee-rounds`, `match-structure`, `extra-tables`) — inconsistent with the rest of the camelCase schema

---

## Confirmed table names and full schemas

### `tournament_drops` ✓
> Doc called this `drops` — **wrong**. Real name is `tournament_drops`.

```json
{
  "tournamentId": "uuid (string)",
  "tableNumber": "integer",
  "round": "integer",
  "isChecked": "boolean",
  "isCancelled": "boolean",
  "playerGameId": "string",
  "playerName": "string (denormalized)",
  "updated_by": "uuid (string)",
  "updated_by_name": "string (denormalized display name)"
}
```

**Notes:**
- No `id` primary key visible — composite of `tournamentId` + `playerGameId` is likely the key
- No `createdAt` or `updatedAt` timestamp on this table
- Doc referenced `added_by_name` and `verified_by_name` — **neither exists**. Only `updated_by_name` (single mutable field)
- `isChecked: true` = scorekeeper has processed the drop
- `isCancelled: false` = default; purpose of cancellation flow unknown — needs HAR

---

### `tournament_logs` ✓
> Name confirmed correct. Only contains time-extension entries.

```json
{
  "id": "integer (auto-increment)",
  "tournamentId": "uuid (string)",
  "tableNumber": "integer",
  "round": "integer",
  "action": "string — format: 'Change time from Xmin to Ymin'",
  "userId": "uuid (string)",
  "createdAt": "string — ISO with +00:00 suffix e.g. '2026-05-21T06:05:42.313485+00:00'"
}
```

**Notes:**
- `id` is an integer, not a UUID
- No `staffName` column — only `userId`. PF resolves name via FK join: `?select=*,profiles(firstname,lastname)`
- `userId` has a FK to `profiles.id` (confirmed by Supabase join working)
- `tableNumber` and `round` are direct columns ✓
- `createdAt` **includes** `+00:00` timezone suffix
- `action=like.Change*` filter confirmed working — all rows are extension entries

---

### `tournament_penalities` ✓
> Typo confirmed — extra 'i' is the **real** table name. `tournament_penalties` (correct spelling) → 404.

```json
{
  "id": "uuid",
  "tournamentId": "uuid (string)",
  "round": "integer",
  "playerGameId": "string",
  "playerName": "string (denormalized)",
  "sanction": "string — e.g. 'Warning', 'Intellect Penalty (IP2)'",
  "type": "string — e.g. 'Gameplay Infractions - HIDDEN CARD ERROR', 'Unsporting Conduct - SEVERE'",
  "description": "string|null (free-text notes)",
  "creator_id": "uuid (string)",
  "creator_name": "string (denormalized display name)",
  "createdAt": "string — ISO WITHOUT timezone suffix e.g. '2026-05-21T06:15:29.313903'"
}
```

**Notes:**
- No `tableNumber` column — penalties are not linked to a table number directly
- No `remedy` column — doc was wrong. Outcome is in `sanction`, category is in `type`
- No `infraction` column — doc was wrong. Use `type` for infraction category
- `createdAt` has **no timezone suffix** — inconsistent with `tournament_logs`
- `description` is the free-text notes field ✓

---

### `tables` ✓
> This is ONE table that covers both "table coverage" and "judge results". `table_coverage` and `table_judge_results` **do not exist** as separate tables (both → 404).

```json
{
  "tournamentId": "uuid (string)",
  "tableNumber": "integer",
  "playerGameId1": "string",
  "playerGameId2": "string",
  "playerName1": "string",
  "playerName2": "string",
  "playerScore1": "string|null",
  "playerScore2": "string|null",
  "result": "string|null — e.g. '1WIN', '2WIN', or the literal string 'null' (bug)",
  "coveredBy": "string|null (display name, NOT a uuid)",
  "judgeResult": "string|null",
  "isAtStage": "boolean",
  "isFeature": "boolean"
}
```

**Notes:**
- `coveredBy` and `judgeResult` are on the **same row** — not separate tables
- `coveredBy` is a display name string, not a UUID
- `result` can be the string literal `"null"` instead of JSON null — handle both in sync code
- `judgeResult` was null in all sampled rows — live values unknown, needs HAR
- Written via POST with columns: `playerGameId1`, `playerGameId2`, `playerName1`, `playerName2`, `result`, `tableNumber`, `tournamentId`, `isAtStage`

---

### `table_status` ✓ (undocumented)

```json
{
  "tournamentId": "uuid (string)",
  "tableNumber": "integer",
  "status": "string — 'playing' | 'done' | 'covered'",
  "time": "integer|null — extension minutes for this table",
  "timeA": "null (purpose unknown)",
  "timeC": "null (purpose unknown)",
  "updated_status_at": "string — ISO with +00:00 suffix",
  "updated_status_by": "string (display name, not UUID)"
}
```

**Notes:**
- Three confirmed `status` values: `"playing"`, `"done"`, `"covered"`
- `time` = extension minutes (integer, e.g. `2`), **not** a timestamp
- `timeA` and `timeC` always null in all samples — purpose unknown, needs HAR
- `updated_status_by` is a display name string, not a UUID (inconsistent with `tournament_drops.updated_by` which is a UUID)
- Bulk-inserted one row per table when "mark all as X" is triggered
- Written via POST with columns: `tournamentId`, `tableNumber`, `status`

---

### `tournament_time` ✓ (undocumented)

```json
{
  "id": "uuid — same as tournaments.id (1:1)",
  "time": "string|null — ISO timestamp with +00:00 e.g. '2026-05-21T06:16:26.338+00:00'"
}
```

**Notes:**
- `id` is confirmed to be the tournament UUID — 1:1 with `tournaments`
- `time` = round clock start timestamp. Set when scorekeeper starts the round timer
- Directly relevant to "no timer data" gap — this IS the timer start time

---

### `tournament_deckchecks` ✓ (undocumented)

```json
{
  "id": "uuid",
  "tournamentId": "uuid (string)",
  "round": "integer",
  "playerGameId": "string",
  "opponentName": "string — opponent's gameId stored here (misnamed field)",
  "full": "boolean",
  "note": "string|null (free-text result notes)",
  "subTable": "null (purpose unknown)"
}
```

**Notes:**
- No `tableNumber` column visible
- `opponentName` appears to store the opponent's `gameId` as a string, not a name — likely a misnamed field
- Entirely undocumented

---

### `player_tixs` ✓ (undocumented)

```json
{
  "tournamentId": "uuid (string)",
  "gameId": "string",
  "tixs": "integer",
  "updated_at": "string — ISO with +00:00",
  "updated_by": "string (display name)"
}
```

**Notes:**
- Likely tracks prize/draft tickets per player
- No `id` primary key visible

---

### `players` ✓

```json
{
  "tournamentId": "uuid (string)",
  "gameId": "string",
  "name": "string — 'Lastname, Firstname' format",
  "rank": "integer",
  "standing": "string",
  "tableNumber": "integer|null",
  "isDropped": "boolean",
  "isWatched": "boolean",
  "hero": "null",
  "subHeroes": "null",
  "pseudo": "null",
  "use_pseudo": "null",
  "pod": "null",
  "podSeat": "null",
  "matchesResult": "null",
  "country": "null",
  "elo_cons_rank": "null",
  "elo_lim_rank": "null",
  "isDay2": "null",
  "swu_leader": "null",
  "swu_base": "null"
}
```

---

### `profiles` ✓ (UUID → name resolution)
> `users` table → 404. Use `profiles`.

```json
{
  "id": "uuid — matches auth JWT sub",
  "firstname": "string",
  "lastname": "string",
  "colors": "null"
}
```

**Notes:**
- No `displayName` field — must concatenate `firstname + ' ' + lastname`
- No `email` exposed via anon key
- Accessible without filter — returns all staff profiles

---

### `event_staff` ✓ (undocumented)

```json
{
  "id": "integer (auto-increment)",
  "eventId": "uuid (string)",
  "tournamentId": "uuid|null",
  "name": "string",
  "isFlex": "boolean|null",
  "isHead": "boolean"
}
```

**Notes:**
- Separate from `profiles` — this is a roster/assignment table, not tied to auth users
- `tournamentId` is nullable — staff can be assigned at event level or tournament level
- `isHead` = head judge flag

---

### `roles` ✓ (undocumented)

```json
{
  "id": "integer (auto-increment)",
  "userId": "uuid (string)",
  "eventId": "uuid|null",
  "tournamentId": "uuid|null",
  "streamId": "null",
  "name": "string — 'admin' | 'scorekeeper' | 'deckcheck'"
}
```

**Notes:**
- RBAC table — controls what a given userId can do at event or tournament scope
- `streamId` always null in all samples

---

### `events` ✓

```json
{
  "id": "uuid",
  "name": "string",
  "date": "string|null — date only, 'YYYY-MM-DD'",
  "isDone": "boolean"
}
```

---

## Action → write mapping (what fires when)

| User action | Table written | Method | Key columns sent |
|---|---|---|---|
| Create tournament | `tournaments` | POST | all fields |
| Start round timer | `tournament_time` | POST/UPSERT | `id`, `time` |
| Import results/matches | `tables` | POST | `playerGameId1/2`, `playerName1/2`, `result`, `tableNumber`, `tournamentId`, `isAtStage` |
| Mark all tables as X | `table_status` | POST (bulk) | `tournamentId`, `tableNumber`, `status` |
| Add drop | `tournament_drops` | POST | full row |
| Add penalty | `tournament_penalities` | POST | full row |
| Add time extension | `tournament_logs` | POST | `tournamentId`, `tableNumber`, `round`, `action`, `userId` |
| Process drop (scorekeeper) | `tournament_drops` | PATCH? | `isChecked: true` — **needs HAR to confirm method** |
| Advance round | `tournaments` | PATCH? | `round` increment — **needs HAR to confirm** |
| Change table range | `tournaments` | PATCH? | `firstTable`, `lastTable` — **needs HAR to confirm** |

---

## Field confirmations

| Field | Table | Status | Actual |
|---|---|---|---|
| `tournamentId` | `tournament_drops` | ✓ | camelCase, uuid string |
| `tableNumber` | `tournament_drops` | ✓ | integer |
| `round` | `tournament_drops` | ✓ | integer |
| `isChecked` | `tournament_drops` | ✓ boolean | NOT integer |
| `isCancelled` | `tournament_drops` | ✓ present | undocumented field |
| `droppedBy` / `addedBy` | `tournament_drops` | ✗ absent | actual: `updated_by` (uuid) + `updated_by_name` (string) |
| `added_by_name` | `tournament_drops` | ✗ absent | actual: `updated_by_name` |
| `verified_by_name` | `tournament_drops` | ✗ absent | does not exist |
| `tableNumber` | `tournament_logs` | ✓ | direct column |
| `round` | `tournament_logs` | ✓ | direct column |
| `staffName` | `tournament_logs` | ✗ absent | only `userId`; join profiles for name |
| `createdAt` +00:00 | `tournament_logs` | ✓ | present |
| typo `tournament_penalities` | penalties | ✓ | extra 'i' is real, correct spelling → 404 |
| `tableNumber` | `tournament_penalities` | ✗ absent | not on this table |
| `remedy` | `tournament_penalities` | ✗ absent | use `sanction` instead |
| `infraction` | `tournament_penalities` | ✗ absent | use `type` instead |
| `staffId` | `tournament_penalities` | ~ | actual: `creator_id` + `creator_name` |
| `description` / notes | `tournament_penalities` | ✓ | column is `description` |
| `createdAt` no tz | `tournament_penalities` | ✓ confirmed | NO `+00:00` suffix — parse carefully |
| `table_coverage` (separate table) | — | ✗ | does not exist, 404 |
| `table_judge_results` (separate table) | — | ✗ | does not exist, 404 |
| `coveredBy` string | `tables` | ✓ | display name, not UUID |
| `judgeResult` | `tables` | ✓ present | same row as `coveredBy`, values unknown (all null in samples) |
| `profiles` for UUID→name | `profiles` | ✓ | `firstname` + `lastname` |
| `users` table | — | ✗ | 404 |

---

## Bugs / gotchas found

1. **`tables.result` can be string `"null"`** — when no result, PF sometimes writes the literal string `"null"` instead of JSON `null`. Your sync code must treat `result === "null"` the same as `result === null`.

2. **`createdAt` timezone inconsistency** — `tournament_logs.createdAt` has `+00:00`; `tournament_penalities.createdAt` does not. Parse both formats.

3. **`updated_status_by` on `table_status` is a display name string** — inconsistent with `tournament_drops.updated_by` which is a UUID. No UUID available for table_status author.

4. **`tournament_deckchecks.opponentName` stores a gameId, not a name** — the field is misnamed.

5. **Four kebab-case columns on `tournaments`** — `melee-tournament-id`, `melee-rounds`, `match-structure`, `extra-tables` break camelCase convention. Access via bracket notation in JS: `row["melee-tournament-id"]`.

6. **`tournament_drops` has no `createdAt`** — no timestamp on drops at all. Cannot sort or deduplicate by time.

---

## Open questions (to resolve with HAR)

1. **How does "process drop" work?** — Is it a PATCH to set `isChecked: true`, or a POST upsert? What columns are sent? Does it touch `updated_by`/`updated_by_name`?

2. **How does "advance round" work?** — Is `tournaments.round` PATCHed directly? Is `tournament_time` upserted at the same time (same transaction or separate)?

3. **How does "change table range" work?** — PATCH to `tournaments` with just `firstTable`/`lastTable`? Does it also wipe and re-create `table_status` rows?

4. **What does `isCancelled` do on drops?** — Is there a cancel-drop flow that sets this to `true`? Does a cancelled drop still show in the scorekeeper view?

5. **What values does `judgeResult` take?** — All sampled rows were null. Need a live judge call to see the enum.

6. **What are `timeA` and `timeC` on `table_status`?** — Always null. Possibly player A / player C time splits for team events?

7. **Is `tournament_time` a POST or UPSERT?** — If a second round starts, does it POST a new row (and `id` would collide) or PATCH/upsert?

8. **Does "mark all tables as X" PATCH existing rows or POST new ones?** — The tracker showed POST 201s, suggesting inserts, which means there may be duplicate rows per table across rounds. Confirm with HAR.

9. **What is `player_tixs.tixs` tracking exactly?** — Prize tickets, draft tickets, judge tix?

10. **Does `tournament_penalities` have a `tableNumber` stored anywhere?** — It wasn't in the REST response. Could be added via `description` free text in practice.

---

## JWT reference

```
sub:      377d806e-3152-4c49-9820-83c19508e2e7
email:    herbo351@gmail.com
role:     authenticated
provider: discord
exp:      1779513813  →  2026-05-23T05:23:33Z  (~48h from issue)
aal:      aal1
session:  cb62aa33-5bb7-4f8e-bcd6-f9718764f3ad
```

---

## HAR analysis guidance

When you load the HAR in Claude Code, look for the following:

### Priority 1 — writes we saw fire but couldn't read the body of

Filter by `method: POST` or `method: PATCH`, URL contains `rest/v1/`, sort by time.

**For each of these, capture the full request body and response body:**

- `POST /rest/v1/tournament_drops` — need the exact fields sent on insert. Confirm whether `isChecked` starts as `false` and what `isCancelled` defaults to.
- `POST or PATCH /rest/v1/tournament_drops` with `isChecked: true` — this is the "process drop" write. Confirm method (POST upsert vs PATCH with filter).
- `POST /rest/v1/tournament_penalities` — confirm all fields sent, especially whether `tableNumber` is ever included even though it's not in the schema.
- `POST /rest/v1/tournament_logs` — confirm exact body shape, especially `userId` field name.
- `POST /rest/v1/tournament_time` — confirm whether it's a plain POST or uses `on_conflict` upsert header. Confirm `id` = tournament UUID.
- Any `PATCH /rest/v1/tournaments` — this is round advance and/or table range change. Capture the filter params and body.

### Priority 2 — reads that reveal query patterns

Filter by `method: GET`, URL contains `rest/v1/`.

- Look for `tournament_drops` GETs — what filters does PF use? `isChecked=eq.false`? No filter? Does it page?
- Look for `tables` GETs — does it fetch all tables for the tournament, or filtered by round?
- Look for `tournament_penalities` GETs — any filters on `round` or `creator_id`?
- Look for any `PATCH` on `tables` — this would be `coveredBy` or `judgeResult` being written by a floor judge.

### Priority 3 — anything unexpected

- Any calls to tables not listed in this doc
- Any calls to Supabase Edge Functions (`/functions/v1/`)
- Any non-Supabase API calls (e.g. Carde.io, external scoring endpoints)
- Any `DELETE` method calls (should be none — PF appears to use soft deletes / cancellation flags)

### HAR filter snippet (paste into Claude Code)

```python
import json

with open('purplefox.har', 'r') as f:
    har = json.load(f)

entries = har['log']['entries']
supabase_writes = [
    e for e in entries
    if 'rest/v1/' in e['request']['url']
    and e['request']['method'] in ('POST', 'PATCH', 'PUT', 'DELETE')
]

for e in supabase_writes:
    url = e['request']['url']
    method = e['request']['method']
    status = e['response']['status']
    body = e['request'].get('postData', {}).get('text', '')
    resp = e['response']['content'].get('text', '')
    print(f"\n{'='*60}")
    print(f"{method} {url}")
    print(f"Status: {status}")
    print(f"Request body: {body}")
    print(f"Response: {resp[:500]}")
```
