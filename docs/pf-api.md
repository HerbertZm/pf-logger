# PurpleFox — API Quick Reference

Confirmed 2026-05-21 via live session + HAR analysis.  
Full schema and behavioral notes: `agent/PURPLEFOX.md`

---

## Auth

```
apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...  (public anon key, embedded in PF bundle)
Authorization: Bearer {JWT}                         (staff session token, ~48h, Discord OAuth)
Accept: application/json
```

Base URL: `https://upbcarvmkmyzhbosheyo.supabase.co/rest/v1/`

JWT payload fields: `sub` (staff UUID), `email`, `role: "authenticated"`, `provider: "discord"`, `exp`  
No refresh token — re-login required when expired.

---

## Read patterns

### Tournament

```
GET /rest/v1/tournaments?id=eq.{tournament_id}&limit=1
```

Returns current `round` counter, `firstTable`, `lastTable`, `defaultTime` (seconds), `game`, `software`.

### Round timer start

```
GET /rest/v1/tournament_time?id=eq.{tournament_id}&limit=1
```

Returns `{"id": uuid, "time": "ISO+00:00 | null"}` — `time` is when the scorekeeper started the current round clock.  
**Current round only** — wiped on round advance.

### Tables (current round — pairings, coverage, judge results)

```
GET /rest/v1/tables?tournamentId=eq.{tournament_id}
```

One row per table. **Current round only** — wiped on round advance.  
Filter outstanding (no result): `&result=is.null`  
Filter covered: `&coveredBy=not.is.null`

### Table statuses

```
GET /rest/v1/table_status?tournamentId=eq.{tournament_id}
```

One row per table. **Current round only** — wiped on round advance.  
`status` values: `"playing"` | `"done"` | `"covered"`  
`time` = extension minutes (integer, not a timestamp).

### Drops

```
GET /rest/v1/tournament_drops?tournamentId=eq.{tournament_id}
```

Accumulates across rounds. Filter unchecked: `&isChecked=eq.false`  
No timestamp — cannot sort by insertion time.

### Time extensions

```
GET /rest/v1/tournament_logs?tournamentId=eq.{tournament_id}&action=like.Change*
```

Accumulates across rounds. Filter by round: `&round=eq.{N}`  
With staff name resolved inline:
```
GET /rest/v1/tournament_logs?select=*,profiles(firstname,lastname)&tournamentId=eq.{tournament_id}
```

### Penalties

```
GET /rest/v1/tournament_penalities?tournamentId=eq.{tournament_id}
```

Note: extra 'i' is intentional — correct spelling returns 404.  
Accumulates across rounds. Filter by round: `&round=eq.{N}`  
`createdAt` has **no timezone suffix** — treat as UTC.

### Players

```
GET /rest/v1/players?tournamentId=eq.{tournament_id}
```

### Staff profiles (UUID → name)

```
GET /rest/v1/profiles
GET /rest/v1/profiles?id=eq.{uuid}
```

Returns all staff. Display name = `firstname + ' ' + lastname`.

### Events

```
GET /rest/v1/events?id=eq.{event_id}&limit=1
```

---

## Write patterns

All POST upserts use `Prefer: resolution=merge-duplicates`.

### Round advance (5-step sequence, in order)

```
DELETE /rest/v1/tables?tournamentId=eq.{id}
DELETE /rest/v1/table_status?tournamentId=eq.{id}
DELETE /rest/v1/tournament_time?id=eq.{id}
PATCH  /rest/v1/tournaments?id=eq.{id}          body: {"round": N}
POST   /rest/v1/tournament_time                  body: {"id": "{uuid}", "time": "{ISO timestamp}"}
  Prefer: resolution=merge-duplicates
```

### Import pairings (bulk)

```
POST /rest/v1/tables?columns=%22playerGameId1%22%2C%22playerGameId2%22%2C%22playerName1%22%2C%22playerName2%22%2C%22result%22%2C%22tableNumber%22%2C%22tournamentId%22%2C%22isAtStage%22
Prefer: resolution=merge-duplicates

body: [
  {"tournamentId":"{uuid}","tableNumber":1,"playerGameId1":"123","playerGameId2":"456",
   "playerName1":"Doe, Jane","playerName2":"Smith, John","result":null,"isAtStage":false},
  ...
]
```

### Mark all tables playing (round start)

```
POST /rest/v1/table_status?columns=%22tournamentId%22%2C%22tableNumber%22%2C%22status%22
Prefer: resolution=merge-duplicates

body: [
  {"tournamentId":"{uuid}","tableNumber":1,"status":"playing"},
  {"tournamentId":"{uuid}","tableNumber":2,"status":"playing"},
  ...
]
```

### Cover a table

```
POST /rest/v1/tables
Prefer: resolution=merge-duplicates

body: {"tournamentId":"{uuid}","tableNumber":N,"coveredBy":"Judge Name"}
```

```
POST /rest/v1/table_status
Prefer: resolution=merge-duplicates

body: {"tournamentId":"{uuid}","tableNumber":N,"status":"covered"}
```

### Log judge result

```
POST /rest/v1/tables
Prefer: resolution=merge-duplicates

body: {"tournamentId":"{uuid}","tableNumber":N,"judgeResult":"Player 1 1 - 2 Player 2 (0 draw)"}
```

`judgeResult` is free-text — not an enum.

### Set extension on a table

```
POST /rest/v1/table_status
Prefer: resolution=merge-duplicates

body: {"tournamentId":"{uuid}","tableNumber":N,"time":2}
```

`time` is integer **minutes**, not seconds and not a timestamp.

### Log time extension (tournament_logs)

```
POST /rest/v1/tournament_logs

body: {"tournamentId":"{uuid}","tableNumber":N,"round":R,"action":"Change time from 0min to 2min","userId":"{staff_uuid}"}
```

### Add drop

```
POST /rest/v1/tournament_drops

body: {"tournamentId":"{uuid}","playerGameId":"123","tableNumber":N,"round":R,
       "playerName":"Doe, Jane","isChecked":false,"isCancelled":false,
       "updated_by":"{staff_uuid}","updated_by_name":"Judge Name"}
```

### Add penalty

```
POST /rest/v1/tournament_penalities

body: {"tournamentId":"{uuid}","round":R,"playerGameId":"123","playerName":"Doe, Jane",
       "type":"Gameplay Infractions - HIDDEN CARD ERROR","sanction":"Warning",
       "description":"optional notes","creator_id":"{staff_uuid}","creator_name":"Judge Name"}
```

### Flag feature match

```
POST /rest/v1/tables
Prefer: resolution=merge-duplicates

body: {"tournamentId":"{uuid}","tableNumber":N,"isFeature":true}
```

---

## Gotchas

| Issue | Detail |
|---|---|
| `tables.result` string `"null"` | PF sometimes writes `"null"` (string) instead of JSON null. Treat both as no result. |
| `createdAt` timezone mismatch | `tournament_logs` has `+00:00`; `tournament_penalities` does not. Both are UTC. |
| `table_status.time` is minutes | The extension field on `table_status` is integer minutes, not seconds. |
| No timestamp on drops | `tournament_drops` has no `createdAt` — cannot sort or deduplicate by time. |
| Four kebab-case columns on `tournaments` | `melee-tournament-id`, `melee-rounds`, `match-structure`, `extra-tables` — use bracket notation in JS. |
| Current-round-only tables | `tables`, `table_status`, `tournament_time` are wiped on every round advance. |
| Penalties table typo | `tournament_penalities` (extra 'i'). Correct spelling → 404. |
