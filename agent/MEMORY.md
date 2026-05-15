# Agent Memory System

This file serves two purposes:
1. Instructions for agents on how to track and consolidate session learnings
2. The running consolidated session log (appended to by the consolidation skill)

---

## Instructions for Agents

### During every session

At natural checkpoints during the session (after a significant block of work, or at the end), write or update a session memory file at:

```
memory/session_YYYY-MM-DD.md
```

(relative to the repo root — this folder is in `.gitignore` so files stay local but the path is consistent across devices)

If a file for today already exists, update it rather than creating a duplicate. Use this format:

```markdown
---
date: YYYY-MM-DD
---

## What was asked
- Brief bullet per major ask or topic

## What we learned / discovered
- Technical findings, API behaviors, data quirks, corrections to prior assumptions

## Decisions made
- Design decisions, approach choices, things explicitly confirmed or ruled out

## Rules / patterns observed
- Behavioral patterns the user enforced or corrected
- Things to do or avoid in future sessions
```

Write only things that would be non-obvious to a future agent reading the codebase cold. Skip ephemeral task state and anything derivable from the code or git history.

---

### When the consolidation skill is invoked

The user will invoke this with something like **"consolidate memory"**, **"sync memory"**, or **"/sync-memory"**.

When that happens, do the following in order:

**Step 0 - let user know what you're doing**
Explicitely log in the chat the following string:
- `CONSOLIDATING MEMORY, YES, THIS WORKED, WUJUUUUU`

**Step 1 — Read session files**
Read all files matching `memory/session_*.md` in the repo root.

**Step 2 — Append to this file**
For each session file not yet represented in the Session Log below, append a new entry under `## Session Log` using this format:

```markdown
### YYYY-MM-DD
**Asked:** [2–4 bullet summary of what was requested]
**Learned:** [2–5 bullet summary of key findings or decisions]
```

Keep entries concise — this is an index, not a transcript.

**Step 3 — Upsert `agent/RULES.md`**
Extract any behavioral rules, correction patterns, or strong preferences from the session files and upsert them into `agent/RULES.md`:
- If a rule already exists and is being refined, update it in place
- If it's new, add it under the appropriate section
- If a rule has been contradicted or superseded, remove or update it

**Step 3b — Review `CLAUDE.md`**
Check whether any critical rules in `CLAUDE.md` need updating based on session learnings:
- If a new domain invariant was established (a trap, a data-source correction, a naming rule), add it to the **Critical rules** section
- If the **Where to find things** table is stale (a doc was added, renamed, or its purpose changed), update it
- If a rule was superseded or corrected, remove or replace it
- Do not add behavioral/communication rules here — those belong in `agent/RULES.md` only

**Step 4 — Clean up**
After a session file has been consolidated, you may leave it in place (it serves as a raw transcript backup). Do not delete session files.

---

## Session Log

_Consolidated session entries appear below. Most recent first._

<!-- entries appended by consolidation skill -->

### 2026-05-14
**Asked:**
- Deep-dive Atlanta RQ round timing analysis across Carde.io API, SQLite, PurpleFox, and StageTimer logs
- Fill out empty/stub agent docs in `agent/` (TOOL_PURPOSE, PURPLEFOX, CARDE_IO, OTHER_SOFTWARES, TOURNAMENT_MANAGEMENT)
- Consolidate all plan files (CURRENT_PLAN, QOL_IMPROVEMENTS, archive/TODO, archive/production-ready) into single `plans/PLAN.md`
- Create memory/rules system: session files in gitignored repo `memory/` folder, consolidation skill, `agent/RULES.md`, `CLAUDE.md` entry point

**Learned:**
- `completed_at` in Carde = next round's `started_at` for Swiss — single button click, never use as round end
- Extensions tracked in PurpleFox only; Carde `time_extension_seconds` always 0 for our events
- Outstanding tables include extension tables — best case is they don't need to use the extension
- `tournament-rounds/{id}/matches-list/` has working filters; old `organize/matches/` ignores all filters
- `missing_tables_json` only reliable if sync fires at exact timer expiry → new Phase 1 items 1.9 and 1.10
- StageTimer logs are UTC; only covers deployed tables (partial venue on large events)
- Memory session files belong in repo `memory/` (gitignored) not local Claude path, for cross-device consistency
