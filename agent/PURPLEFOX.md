# PurpleFox

PurpleFox is a judge management tool used alongside Carde.io at TCG events. It runs as a
separate web app (`eor-us.purple-fox.fr`) and stores its data in Supabase (Postgres).
This tool reads from PurpleFox's Supabase tables via the REST API using a judge's JWT.

Supabase project: `upbcarvmkmyzhbosheyo.supabase.co`  
Base REST URL: `https://upbcarvmkmyzhbosheyo.supabase.co/rest/v1/`  
Auth headers (every request):
```
apikey: {SUPABASE_ANON_KEY}
Authorization: Bearer {JWT}
Accept: application/json
```

The anon key is public and embedded in the PF frontend bundle.

---

## Uses

### Drop management

Tracks players who have dropped from the event mid-tournament. Each drop has a
`tableNumber`, `round`, `playerName`, and `isChecked` flag (whether the scorekeeper has
processed it). The tool surfaces these in a check-off workflow so nothing gets missed.

### Time extensions

When a judge grants a player extra time at their table, it's logged in PurpleFox as a
`tournament_logs` entry with `action: "Change time from Xmin to Ymin"`. This is the
**only** source of extension data — extensions are **not** entered into Carde.io for our
events. Extension logs accumulate across rounds (not wiped on round advance).

### Penalties

Warnings, game losses, match losses, and DQs are recorded in `tournament_penalities`.
Includes `creator_name` (denormalized), the infraction `type`, `sanction`, and `round`.
Not linked to a table number.

### Table coverage and judge results

Judges log coverage and results on the `tables` table (one row per table per round, wiped
each round). `coveredBy` is a display name string. `judgeResult` is a free-text result
description string (not an enum).

### Player data

Player names, gameIds, rankings, and drop status are available via the `players` table.
Names are in `"Lastname, Firstname"` format. Player data is imported from Carde at the
start of each round.

---

## Auth and sync behavior

### JWT authentication

Staff must log into PurpleFox in their browser and paste their JWT into this tool. JWT
validity is approximately **48 hours** (Discord OAuth provider). The JWT payload contains:

```
sub:      {staff UUID}   — matches profiles.id
email:    {email}
role:     authenticated
provider: discord
exp:      {unix timestamp ~48h from issue}
```

**Implication for agents**: Never assume a valid PF JWT is present. If sync fails with
401, the fix is always human intervention (re-paste JWT) — not a code change.

### Staff name resolution

`profiles` is the canonical staff table. UUID → name mapping:
```
GET /rest/v1/profiles   →  [{id, firstname, lastname, colors}]
```
Display name = `firstname + ' ' + lastname`. No `displayName` field exists. The `profiles`
table is accessible without row-level filters (returns all staff profiles with anon key +
valid JWT).

For `tournament_logs`, PF uses a Supabase FK join to resolve names inline:
```
GET /rest/v1/tournament_logs?select=*,profiles(firstname,lastname)&tournamentId=eq.{id}
```

### Sync is pull-only and on-demand

No webhooks, no real-time subscriptions. Every fetch is triggered by a user or auto-sync
interval. Data is only as fresh as the last successful sync.

---

## Round lifecycle — CRITICAL

**`tables`, `table_status`, and `tournament_time` are current-round-only tables.**
On every round advance, PurpleFox performs this sequence in order:

1. `DELETE tables?tournamentId=eq.{id}` — wipes all table match/coverage data
2. `DELETE table_status?tournamentId=eq.{id}` — wipes all table status rows
3. `DELETE tournament_time?id=eq.{id}` — wipes the round timer
4. `PATCH tournaments?id=eq.{id}` body `{"round": N}` — increments round counter
5. `POST tournament_time` (upsert) body `{"id": tournament_uuid, "time": "ISO timestamp"}` — sets new round start time

These three tables therefore hold **current round data only**. There is no historical
round-by-round data in PF for these tables. `tournament_drops`, `tournament_logs`, and
`tournament_penalities` are NOT wiped on round advance — they accumulate.

**Implication for ingestion**: after a round advance, `tables` and `table_status` will be
empty (or contain only newly-imported data) until PF re-populates them. Do not interpret
an empty `tables` response as "no coverage" — it may mean the round just advanced.

---

## Data model — confirmed schemas

All column names are camelCase unless noted. Confirmed via live session 2026-05-21.

---

### `tournaments`

Written once on creation. PATCH'd to update `round`.

```json
{
  "id":                 "uuid",
  "name":               "string",
  "eventId":            "uuid",
  "game":               "string  (e.g. 'lorcana', 'riftbound')",
  "software":           "string  (e.g. 'carde')",
  "round":              "integer — current live round counter, incremented on advance",
  "firstTable":         "integer",
  "lastTable":          "integer",
  "defaultTime":        "integer — round duration in SECONDS (3000 = 50 min)",
  "isDone":             "boolean",
  "isTeam":             "boolean",
  "status":             "null",
  "prizeStructure":     "null",
  "seatNames":          "null",
  "subTournaments":     "null",
  "melee-tournament-id":"null  (kebab-case — access via bracket notation)",
  "melee-rounds":       "array (kebab-case)",
  "match-structure":    "null  (kebab-case)",
  "extra-tables":       "null  (kebab-case)"
}
```

Note: four columns use kebab-case, inconsistent with the rest of the schema.
`defaultTime` is in **seconds**, not minutes.

Round advance write: `PATCH /rest/v1/tournaments?id=eq.{id}` body `{"round": N}`

---

### `tournament_drops`

Accumulates across rounds. No `createdAt` — no timestamp available for ordering.

```json
{
  "tournamentId":    "uuid (string)",
  "playerGameId":    "string — Carde gameId, part of composite key",
  "tableNumber":     "integer",
  "round":           "integer",
  "playerName":      "string — 'Lastname, Firstname' (denormalized)",
  "isChecked":       "boolean — true = scorekeeper processed the drop",
  "isCancelled":     "boolean — true = drop was cancelled",
  "updated_by":      "uuid (string) — staff UUID who last touched this row",
  "updated_by_name": "string — staff display name (denormalized)"
}
```

**Notes:**
- No `id` PK — composite key is likely `(tournamentId, playerGameId)`
- No `createdAt` or `updatedAt` — cannot sort or deduplicate drops by time
- `added_by_name` and `verified_by_name` do NOT exist — only `updated_by_name` (single
  mutable field, overwritten on each update)
- `isChecked: true` = drop has been processed by scorekeeper
- `isCancelled: false` is the default; purpose of cancel flow not yet confirmed

---

### `tournament_logs`

Accumulates across rounds (not wiped on round advance). Only contains time-extension
entries — not a general audit log.

```json
{
  "id":           "integer (auto-increment)",
  "tournamentId": "uuid (string)",
  "tableNumber":  "integer — direct column",
  "round":        "integer — direct column",
  "action":       "string — format: 'Change time from Xmin to Ymin'",
  "userId":       "uuid (string) — FK to profiles.id",
  "createdAt":    "string — ISO 8601 with +00:00 suffix e.g. '2026-05-21T06:05:42.313485+00:00'"
}
```

**Notes:**
- `tableNumber` and `round` are direct columns (no join needed for basic queries)
- No `staffName` column — resolve via FK join: `?select=*,profiles(firstname,lastname)`
- `action=like.Change*` filter works and returns only extension entries
- All rows confirmed to be extension entries — no other action types observed
- `createdAt` includes `+00:00` suffix (UTC confirmed)

---

### `tournament_penalities`  ← typo is intentional, extra 'i'

`tournament_penalties` (correct spelling) → 404. Accumulates across rounds.

```json
{
  "id":           "uuid",
  "tournamentId": "uuid (string)",
  "round":        "integer",
  "playerGameId": "string",
  "playerName":   "string — 'Lastname, Firstname' (denormalized)",
  "type":         "string — infraction category e.g. 'Gameplay Infractions - HIDDEN CARD ERROR'",
  "sanction":     "string — outcome e.g. 'Warning', 'Intellect Penalty (IP2)'",
  "description":  "string|null — free-text notes",
  "creator_id":   "uuid (string) — FK to profiles.id",
  "creator_name": "string — display name (denormalized)",
  "createdAt":    "string — ISO 8601 WITHOUT timezone suffix e.g. '2026-05-21T06:15:29.313903'"
}
```

**Notes:**
- No `tableNumber` column — penalties are not linked to a table directly
- No `remedy` or `infraction` columns — doc was previously wrong
  - Use `type` for infraction category, `sanction` for outcome
- No `staffId` column — use `creator_id` (UUID) and `creator_name` (string)
- `createdAt` has **no timezone suffix** — inconsistent with `tournament_logs`. Treat as UTC.
- `description` is the free-text notes field

---

### `tables`

**Current-round-only. Wiped on every round advance.** One row per (tournamentId, tableNumber).
All writes use `Prefer: resolution=merge-duplicates` (partial upsert on composite key).

```json
{
  "tournamentId":  "uuid (string)",
  "tableNumber":   "integer",
  "playerGameId1": "string",
  "playerGameId2": "string",
  "playerName1":   "string — 'Lastname, Firstname'",
  "playerName2":   "string — 'Lastname, Firstname'",
  "playerScore1":  "string|null",
  "playerScore2":  "string|null",
  "result":        "string|null — '1WIN', '2WIN', or the literal string 'null' (bug — treat same as null)",
  "coveredBy":     "string|null — judge display name, NOT a UUID",
  "judgeResult":   "string|null — free-text result description, NOT an enum",
  "isAtStage":     "boolean",
  "isFeature":     "boolean"
}
```

**Write patterns (all use `Prefer: resolution=merge-duplicates`):**
- Import pairings: `POST /rest/v1/tables?columns="playerGameId1","playerGameId2","playerName1","playerName2","result","tableNumber","tournamentId","isAtStage"` with full batch
- Coverage: `POST /rest/v1/tables` body `{"tournamentId":…, "tableNumber":N, "coveredBy":"Judge Name"}`
- Feature match: `POST /rest/v1/tables` body `{"tournamentId":…, "tableNumber":N, "isFeature":true}`
- Judge result: `POST /rest/v1/tables` body `{"tournamentId":…, "tableNumber":N, "judgeResult":"Player 1 1 - 2 Player 2 (0 draw)"}`

**Notes:**
- `table_coverage` and `table_judge_results` do NOT exist as separate tables (both → 404)
- Coverage and judge results live on the same row
- `judgeResult` is free-text (e.g. `"Player 1 1 - 2 Player 2 (0 draw)"`), not an enum
- `result` bug: PF sometimes writes the string `"null"` instead of JSON null. Treat
  `result === "null"` the same as `result === null` in sync code

---

### `table_status`

**Current-round-only. Wiped on every round advance.** One row per (tournamentId, tableNumber).
All writes use `Prefer: resolution=merge-duplicates`.

```json
{
  "tournamentId":      "uuid (string)",
  "tableNumber":       "integer",
  "status":            "string — 'playing' | 'done' | 'covered'",
  "time":              "integer|null — extension minutes for this table (not a timestamp)",
  "timeA":             "null — purpose unknown, always null",
  "timeC":             "null — purpose unknown, always null",
  "updated_status_at": "string — ISO with +00:00 suffix",
  "updated_status_by": "string — display name (NOT a UUID)"
}
```

**Write patterns:**
- Mark all tables playing (round start): bulk `POST /rest/v1/table_status?columns="tournamentId","tableNumber","status"` with array of all tables, `status: "playing"`
- Mark single table covered: `POST /rest/v1/table_status` body `{"tournamentId":…, "tableNumber":N, "status":"covered"}`
- Set extension on table: `POST /rest/v1/table_status` body `{"tournamentId":…, "tableNumber":N, "time": 2}` — `time` is integer minutes

**Notes:**
- `updated_status_by` is a display name string (inconsistent with `tournament_drops.updated_by` which is a UUID)
- `time` = extension minutes (integer), not a timestamp — this is the per-table extension,
  separate from the round-level log in `tournament_logs`
- `timeA` and `timeC` always null — possibly reserved for team events

---

### `tournament_time`

**Current-round-only. Wiped on every round advance.** 1:1 with `tournaments` (same UUID as PK).

```json
{
  "id":   "uuid — same as tournaments.id",
  "time": "string|null — ISO with +00:00 e.g. '2026-05-21T06:16:26.338+00:00'"
}
```

`time` = when the scorekeeper started the round clock. This is the PF-side timer start.
Written via: `POST /rest/v1/tournament_time` with `Prefer: resolution=merge-duplicates`,
body `{"id": tournament_uuid, "time": "ISO timestamp"}`.

**This resolves the previously documented "no timer data" gap** — PF does record when the
round clock was started.

---

### `players`

Imported from Carde at the start of each round. Contains denormalized player data.

```json
{
  "tournamentId": "uuid (string)",
  "gameId":       "string — Carde gameId",
  "name":         "string — 'Lastname, Firstname'",
  "rank":         "integer",
  "standing":     "string",
  "tableNumber":  "integer|null",
  "isDropped":    "boolean",
  "isWatched":    "boolean",
  "hero":         "null",
  "subHeroes":    "null",
  "pseudo":       "null",
  "use_pseudo":   "null",
  "pod":          "null",
  "podSeat":      "null",
  "matchesResult":"null",
  "country":      "null",
  "elo_cons_rank":"null",
  "elo_lim_rank": "null",
  "isDay2":       "null",
  "swu_leader":   "null",
  "swu_base":     "null"
}
```

---

### `profiles`

Staff identity table. Accessible without filters using anon key + valid JWT.
Returns all staff profiles.

```json
{
  "id":        "uuid — matches auth JWT sub",
  "firstname": "string",
  "lastname":  "string",
  "colors":    "null"
}
```

Display name = `firstname + ' ' + lastname`. No `displayName` field. No `email` exposed
via anon key. `users` table → 404.

---

### `events`

```json
{
  "id":     "uuid",
  "name":   "string",
  "date":   "string|null — 'YYYY-MM-DD'",
  "isDone": "boolean"
}
```

---

### `event_staff`

Roster/assignment table, separate from `profiles` (not tied to auth users).

```json
{
  "id":           "integer (auto-increment)",
  "eventId":      "uuid (string)",
  "tournamentId": "uuid|null — nullable, staff can be event-level or tournament-level",
  "name":         "string",
  "isFlex":       "boolean|null",
  "isHead":       "boolean"
}
```

---

### `roles`

RBAC table controlling what a given user can do at event or tournament scope.

```json
{
  "id":           "integer (auto-increment)",
  "userId":       "uuid (string)",
  "eventId":      "uuid|null",
  "tournamentId": "uuid|null",
  "streamId":     "null — always null",
  "name":         "string — 'admin' | 'scorekeeper' | 'deckcheck'"
}
```

---

### `tournament_deckchecks`

Undocumented. No `tableNumber` column.

```json
{
  "id":           "uuid",
  "tournamentId": "uuid (string)",
  "round":        "integer",
  "playerGameId": "string",
  "opponentName": "string — stores opponent gameId, not a name (misnamed field)",
  "full":         "boolean",
  "note":         "string|null",
  "subTable":     "null"
}
```

---

### `player_tixs`

Undocumented. Likely tracks prize/draft tickets per player.

```json
{
  "tournamentId": "uuid (string)",
  "gameId":       "string",
  "tixs":         "integer",
  "updated_at":   "string — ISO with +00:00",
  "updated_by":   "string — display name"
}
```

---

## Action → write mapping

| User action | Table | Method | Key fields |
|---|---|---|---|
| Create tournament | `tournaments` | POST | all fields |
| Start round timer | `tournament_time` | POST (upsert) | `id`, `time` |
| Import pairings | `tables` | POST (upsert) | `playerGameId1/2`, `playerName1/2`, `result`, `tableNumber`, `tournamentId`, `isAtStage` |
| Import players | `players` | POST (upsert) | all fields |
| Mark all tables playing | `table_status` | POST bulk (upsert) | `tournamentId`, `tableNumber`, `status:"playing"` |
| Cover a table | `tables` | POST (upsert) | `tournamentId`, `tableNumber`, `coveredBy` |
| Mark table covered | `table_status` | POST (upsert) | `tournamentId`, `tableNumber`, `status:"covered"` |
| Log judge result | `tables` | POST (upsert) | `tournamentId`, `tableNumber`, `judgeResult` |
| Flag feature match | `tables` | POST (upsert) | `tournamentId`, `tableNumber`, `isFeature:true` |
| Set table extension | `table_status` | POST (upsert) | `tournamentId`, `tableNumber`, `time` (minutes) |
| Add time extension log | `tournament_logs` | POST | `tournamentId`, `tableNumber`, `round`, `action`, `userId` |
| Add drop | `tournament_drops` | POST | full row |
| Process drop | `tournament_drops` | PATCH (suspected) | `isChecked:true` — method not confirmed from HAR |
| Add penalty | `tournament_penalities` | POST | full row |
| Advance round | `tables` + `table_status` + `tournament_time` | DELETE × 3, then PATCH `tournaments`, then POST `tournament_time` | sequence above |

All POST upserts use `Prefer: resolution=merge-duplicates`.

---

## Bugs and gotchas

1. **`tables.result` string `"null"`** — PF sometimes writes the literal string `"null"` instead of JSON `null`. Sync code must treat `result === "null"` as null.

2. **`createdAt` timezone inconsistency** — `tournament_logs.createdAt` has `+00:00` suffix; `tournament_penalities.createdAt` does not. Parse both formats; treat both as UTC.

3. **`updated_status_by` is a display name, not UUID** — no UUID available for `table_status` author. Inconsistent with `tournament_drops.updated_by` which is a UUID.

4. **`tournament_deckchecks.opponentName` stores a gameId** — the field is misnamed; it contains the opponent's Carde gameId string, not a human-readable name.

5. **Four kebab-case columns on `tournaments`** — `melee-tournament-id`, `melee-rounds`, `match-structure`, `extra-tables`. Access via bracket notation in JS: `row["melee-tournament-id"]`.

6. **`tournament_drops` has no timestamp** — no `createdAt` or `updatedAt`. Cannot sort or deduplicate drops by insertion time.

7. **`tables` and `table_status` hold current-round data only** — fully wiped on every round advance. Do not treat an empty response as "no activity" — it may mean the round just changed.

---

## Gaps (remaining unknowns)

1. **`isCancelled` flow on drops** — what triggers a cancel? Does `isChecked` interact with it?
2. **`timeA` / `timeC` on `table_status`** — always null; possibly reserved for team events.
3. **`player_tixs.tixs`** — what exactly is being counted (prize tix, draft tix, judge tix)?
4. **Process-drop write method** — suspected `PATCH tournament_drops?tournamentId=eq.{id}&playerGameId=eq.{gid}` with `{isChecked:true}`, but not confirmed from HAR.
5. **`judgeResult` value space** — only one example seen (`"Player 1 1 - 2 Player 2 (0 draw)"`). Format may vary by judge.
