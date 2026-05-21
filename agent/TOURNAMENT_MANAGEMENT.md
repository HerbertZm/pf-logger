# Tournament Management

## General Context

This tool is used on conventions/events for different TCGs (Magic: The Gathering, Lorcana, Riftbound) to compile and make certain information available in a single place, while also filling some gaps that come from the nature of the different tools that are needed to run actual events.

The intended users for this app are:

- Scorekeepers: the staff member that runs the tournaments in the software and is in charge of tasks like turning rounds over, inputting match results, managing tournament clocks, creating backups, among others
- Head Judges: the main Judge in charge of a tournament, they are tasked with ensuring that tournaments run on time, and need to know information and data-points that are sometimes hard to grasp without consulting multiple tools
- Tournament Organizers: the ones in charge of a whole convention/event. They need to report certain insights (like round times, performance, etc) to publishers or their own companies for better planning in the future

## Tournament Concepts

Some concepts are general to all kinds of tournaments and some are specific or change between different games/tools. In general, tournaments run in Swiss-paired rounds (number of rounds can change between each game and even within the same game, depending on the competitive-ness of the event), with set time limits, and need some kind of tracking for things like penalties, match results, standings, and time extensions.

### Generic Knowledge

- **Tournament**: has information like format, number of rounds, structure (number of phases, cut size), etc.

- **Phase**: a tournament is divided into phases. A typical large event has:
  - Swiss phase(s): all players play a set number of rounds, paired by record. Players may drop at any point.
  - Top cut / playoff: only the top N players advance, bracket-style elimination. No drops, no byes, no clock (or a longer clock).
  - Large multi-day events may split Swiss into sub-phases (e.g. Day 1 and Day 2), each with their own round numbering in the software.

- **Round**: a time-limited event that contains matches. Each round has multiple timestamps that are relevant — this is the core focus of this tool:
  - **Round creation / pairings generated**: when the Scorekeeper generated the round pairings in the software
  - **Pairings published**: when the pairings were made visible to players (they go to find their seat)
  - **Round start**: the time that the Head Judge announced the start of the round and players begin playing. The clock starts here.
  - **Scheduled round end**: the calculated/expected time when a round will end based on the duration set for that round
  - **Round real end**: the time when the round received its last match result
  - **"Completing" a round**: the scorekeeper action that locks results and generates the next round's pairings. In some software (e.g. Carde.io), this is a single button that simultaneously marks the current round complete AND starts the next round — meaning the `completed_at` timestamp equals the next round's `started_at` and cannot be used as a proxy for when the last result was entered.
  - **Outstanding Tables**: matches that have not submitted a result by the scheduled round end. This includes tables with time extensions — an extension gives a table extra time to finish, but the best-case expectation is still that they complete within the original round clock. All tables without a result at timer end are outstanding, regardless of whether they have an extension. The extension vs. no-extension breakdown is useful for diagnosing *why* a table was outstanding, not for excluding it from the count.
  - **Time Extensions**: additional time granted to a specific match, usually due to a judge call, deck check, or other interruption. Extensions are tracked separately from the main round clock and are not automatically reflected in the scorekeeper software's round timer.
  - **Ghost Tables**: matches that are no longer physically present (players left, concession was not entered) but still show as pending in the software.

- **Byes**: a bye is an automatic win granted to a player without them playing a match. Common causes: odd number of players in a round, no-show registrants, or intentional first-round byes for high-seed players. Byes are real match objects in the software but are not assigned a physical table — how this is represented varies by software (Carde.io uses `table_number = -1`). Byes must not be counted as outstanding tables and inflate early-round match counts significantly.

- **Player Drops**: players who withdraw from the event mid-tournament. They stop receiving pairings in subsequent rounds. Drops are why match counts decrease across rounds — a large event may start with thousands of matches in R1 and finish Swiss with a fraction of that.

- **Matches**: usually 1v1 games between two players. Special types:
  - **Bye**: one player, auto-win, no opponent
  - **Intentional Draw**: both players agree to a 0-0-1 or 0-0-3 result
  - **Given Loss / Given Win**: result assigned by a judge (e.g. late show, penalty escalation)

- **Standings**: the ranked comparison of all players by record, used to determine pairings and cut eligibility.

---

### Game-specific knowledge

#### Magic: The Gathering

- Usually has 50-minute rounds
- Uses EventLink (official WotC) or Melee.gg as the scorekeeper software
- Judge management is handled within those tools or via companion apps

#### Riftbound

- Rounds last 60 minutes
- Uses Carde.io as the scorekeeper software
- **PF+Carde mode** (default for large events): uses PurpleFox for judge management (extensions, penalties, coverage). Extensions come from PF `tournament_logs`. Drops, penalties, coverage, and judge calls all available.
- **Carde-only mode** (smaller events or fallback): PurpleFox not in use. Extensions come from Carde `time_extension_seconds` on match objects. Drops, penalties, coverage, and judge calls not available.
- Toggle between modes via `tournament_source_mapping.is_enabled` on the PF row — non-destructive.
- **PF implementation note**: PF `tables`, `table_status`, and `tournament_time` are **current-round-only** — wiped on every round advance. These tables have no historical data.
- **Carde.io implementation note**: pairings published and round start are triggered by the same action in Carde — the SK publishes pairings and starts the clock in one step. There is no separate `pairings_published_at` timestamp; `started_at` is the only available proxy. This is a software limitation, not a general tournament concept — in other software or workflows, these can be distinct events separated by minutes.

#### Lorcana

- Rounds last 50 minutes
- Uses Carde.io as the scorekeeper software
- Uses PurpleFox for judge management
