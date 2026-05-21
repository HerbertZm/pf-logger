You are helping me do a live API exploration session for a tournament ops tool I'm building.
We are exploring the Carde.io admin API — the tournament management software used for our
TCG events. You have access to my browser via the Claude in Chrome extension. Your job is
to make API calls via fetch() in the browser console, capture the full response JSON, and
record exactly what fields are present — field names, types, and values. Flag anything
unexpected. At the end, produce a clean markdown summary.

---

## SETUP

Collect the following from me before starting:

1. CARDE_API_TOKEN — the static admin token
2. event_id — the Carde event integer ID (from the admin URL)

All calls use this header:
  Authorization: Token {CARDE_API_TOKEN}

Base URL: https://api.admin.carde.io

Once you have both, confirm and proceed. Run every fetch() call in the page console and
print the FULL JSON. Don't summarize until the final section.

---

## CONTEXT

The event was just created in Carde and we are at or before Round 1. In the first 5
minutes of this session I will do all of the following in quick succession:

  1. Start the event in Carde
  2. Publish Round 1 pairings
  3. Start the round timer

This means the API state will change rapidly at the start. Your first job — before
anything else — is to get the network tracer running and keep it open so we capture
every request Carde makes during that startup window.

The primary goal of this session is understanding round clock behavior: where the timer
state lives in the API, what fields are present before/during/after a round, and whether
we can derive timer expiry without computing it ourselves.

---

## PHASE 0 — Network monitor setup (do this before anything else, before I touch Carde)

Use tabs_context_mcp to get my current tab list. Ask me which tab has the Carde admin
open (or if I need to navigate there). Once you have the tab ID:

1. Call read_network_requests on that tab to start capturing traffic.
2. Tell me "Network tracer is open — go ahead."
3. Immediately run C0-A and C0-B (below) to capture the pre-event baseline.
4. Then wait and watch. Do NOT stop polling the network tracer. Call read_network_requests
   again every 60 seconds for the next 5 minutes minimum — even if I have not said
   anything — to ensure you do not miss requests that fire during the startup sequence.
5. After 5 minutes (or after I confirm the timer is running, whichever is later), tell me
   the tracer window is closed and summarize every request to api.admin.carde.io you saw.

Note: I will have Chrome DevTools open from the very beginning of the session with the
Network tab recording. This means the full traffic — including anything the tracer misses
— will be preserved in a HAR file that we can analyze afterward. Your tracer polling is a
live backup for real-time awareness; the HAR is the complete record. If you are unsure
whether you caught a request, note it and we will confirm from the HAR later.

For every Carde API request captured during the startup window, record:
- The full URL including path and query params
- The HTTP method
- The response status code
- The full response JSON (or as much as the tracer exposes)
- The approximate wall-clock time it fired

This startup traffic is primary data — it may reveal endpoints and fields we would
otherwise miss by only making manual fetch() calls.

---

## PHASE 0-B — Pre-round baseline fetches (run immediately after tracer is open)

### C0-A — tournament_overview baseline

Run this now, before I start the event. This is the pre-start snapshot we will diff
against once the clock is running.

    fetch('https://api.admin.carde.io/api/magic-events/{event_id}/tournament_overview/', {
      headers: { Authorization: 'Token {CARDE_API_TOKEN}' }
    }).then(r => r.json()).then(console.log)

Answer:
- Status 200 or error?
- List every top-level key with its type and value. Include nested objects in full.
- Is there a field for current round number? Exact key name?
- Is there a field for incomplete/outstanding match count? Exact key name?
- List every timer-related field anywhere in the response — look for: timer_end_datetime,
  timer_remaining_seconds, timer_duration, timer_start, clock, or any nested timer object.
- Save this full response — we will compare it against the live-round response in Phase 1.

### C0-B — get_all_rounds baseline

Run this now as well, before I start the event.

    fetch('https://api.admin.carde.io/api/magic-events/{event_id}/get_all_rounds/', {
      headers: { Authorization: 'Token {CARDE_API_TOKEN}' }
    }).then(r => r.json()).then(console.log)

Answer:
- Are all rounds pre-created upfront, or only the first few? How many round objects exist?
- For each round object, show every field name and its current value.
- Is timer_end_datetime present on any round object? If so, what is its value pre-start?
- What carde_status values are present? (Expected: UPCOMING or SCHEDULED)
- Check both extra_time_seconds and additional_time_seconds — which key name exists?
  Is it present even when zero?
- Is there a phase or bracket field distinguishing Swiss rounds from Top-8?

---

## PHASE 1 — Round clock running (run as soon as Round 1 clock is started)

By this point the network tracer should have captured the startup sequence. Before running
the manual fetches below, summarize the Carde API calls you saw fire during the startup
window — especially any calls to tournament_overview or get_all_rounds that the Carde UI
made automatically (not triggered by us). Note whether the UI polls these endpoints
and at what interval.

Then tell me when you are ready. I will confirm the clock is running.

### C1-A — tournament_overview with clock running

Same call as C0-A. Compare against the saved baseline.

Answer:
- List every field that changed or appeared since Phase 0.
- Is timer_end_datetime now present anywhere in the response? Exact key and value?
- Is timer_remaining_seconds or any countdown field present? Value?
- Does any timer field update if you call this endpoint twice 30 seconds apart? Run it
  twice with a 30-second gap and compare the values — is it a live countdown or a static
  snapshot?
- What is the outstanding match count immediately after pairings are published?

### C1-B — get_all_rounds with clock running

Same call as C0-B. Focus on the ACTIVE round object.

Answer:
- What is carde_status for the active round?
- Is timer_end_datetime now on the active round? What is its exact value and timezone?
- If timer_end_datetime is present: compute started_at + (timer_duration_minutes * 60)
  and compare — do they match, or is there an offset?
- Is extra_time_seconds / additional_time_seconds non-zero if round-level extra time was
  added by the TO? (Ask me to add some extra time so we can test this.)
- What is pairings_status for the active round?
- What is started_at — full value with timezone offset?
- Is completed_at null while the round is active?

### C1-C — StageTimer-style timer probe (run twice, 60 seconds apart)

We need to know if Carde serves a live countdown or a fixed end timestamp. Run
tournament_overview twice with a 60-second gap. For each call, record:
- The exact value of any timer field found
- The wall-clock time you made the call (use Date.now() in the console)

Then answer:
- Is the timer field a static ISO timestamp (timer_end_datetime) or a live decrementing
  value (timer_remaining_seconds)?
- If it is a static timestamp, is it consistent between calls (same value both times)?
- If it is a live countdown, how many seconds did it decrease between the two calls?

### C1-D — Round-level extra time test

Ask me to add 2 minutes of extra time to the round via the Carde admin UI, then run
get_all_rounds again.

Answer:
- Did the extra time field on the active round update? Which key (extra_time_seconds or
  additional_time_seconds)?
- Did timer_end_datetime (if present) shift by 2 minutes to reflect the added time?
- Or is it unchanged, meaning timer_end_datetime does NOT include round-level extra time?
- What is the exact before and after value of the extra time field?

---

## PHASE 2 — Clock expired, results still pending (run right after the timer hits zero)

Ask me before running this. I will tell you when the clock has expired.

### C2-A — tournament_overview at expiry

Same call as C0-A. Run it at the moment the clock hits zero, then again 2 minutes later.

Answer:
- Does any timer field change at expiry? Does timer_remaining_seconds go to 0 or go
  absent? Does timer_end_datetime stay or disappear?
- Does the outstanding match count field decrease in real time as results come in?
- Is there any new field that appears post-expiry that was not present during the round?
- Is carde_status on the overview still ACTIVE, or does it change?

### C2-B — get_all_rounds at expiry

Same call as C0-B.

Answer:
- Has carde_status on the active round changed now that time has expired?
- Has completed_at been set, or is it still null while results are pending?
- Has timer_end_datetime (if it exists) changed?

### C2-C — matches-list outstanding tables at expiry

Use the active round's id as {round_id}.

    fetch('https://api.admin.carde.io/api/v2/organize/tournament-rounds/{round_id}/matches-list/?status=in_progress&avoid_cache=true', {
      headers: { Authorization: 'Token {CARDE_API_TOKEN}' }
    }).then(r => r.json()).then(console.log)

Answer:
- Status 200? Did avoid_cache=true cause any error?
- What are count, next, previous? (Default page size check.)
- For one in-progress match object, list EVERY field with its value and type.
- Is time_extension_seconds present? Value for a normal table? Value for a table that
  has a PurpleFox extension? (Expected: always 0 — Carde does not track our extensions.)
- Is result_reported_at null for pending matches?
- Is is_ghost_match present? Value for a normal pending table?
- Is assigned_judge present? Type?
- Full shape of player_match_relationships — list every sub-field.
- What is user_identifier — UUID or gameId string?
- Are table_number: -1 entries present in in_progress results?

### C2-D — Draw match check (run if a draw occurs)

If a drawn match is reported during or after the round, fetch matches-list for that round
without the status filter and find the draw.

    fetch('https://api.admin.carde.io/api/v2/organize/tournament-rounds/{round_id}/matches-list/', {
      headers: { Authorization: 'Token {CARDE_API_TOKEN}' }
    }).then(r => r.json()).then(console.log)

Answer:
- For the draw match: is result_reported_at null?
- Is updated_at populated with a timestamp?
- Is match_is_unintentional_draw or match_is_intentional_draw set to true?

---

## PHASE 3 — Between rounds (run after the round completes and before the next one starts)

Ask me before running this. I will tell you when the round is marked complete and the
next round has not yet started.

### C3-A — tournament_overview between rounds

Same call as C0-A.

Answer:
- What does the outstanding match count show when the round is fully complete?
- Are there any timer fields still present, or do they disappear on round completion?
- What does the current round number field show — the completed round or the next one?

### C3-B — get_all_rounds between rounds

Same call as C0-B.

Answer:
- What is carde_status on the just-completed round? (Expected: COMPLETE)
- Is completed_at now set? What is its exact value and timezone?
- For Swiss rounds: is completed_at equal to the next round's started_at (same instant)?
  Check by comparing completed_at on round N with started_at on round N+1 after the next
  round starts.
- Has timer_end_datetime changed on the completed round, or does it reflect the original
  scheduled end?
- What carde_status does the upcoming round have before it is started?

### C3-C — matches-list pagination full check

Now that the round is complete, fetch all matches (no status filter) and check pagination.

    fetch('https://api.admin.carde.io/api/v2/organize/tournament-rounds/{round_id}/matches-list/?page_size=200&ordering=table_number', {
      headers: { Authorization: 'Token {CARDE_API_TOKEN}' }
    }).then(r => r.json()).then(console.log)

Answer:
- Does page_size=200 work, or is there a cap?
- What is the total count for this round?
- Are results in ascending table_number order?
- Is there a page_size param that returns all results in one call?

---

## FINAL OUTPUT

Produce a markdown summary with these sections:

### Timer state — where it lives and when

For each of the four moments (pre-round, clock running, clock expired, between rounds):
what timer fields are present, what their values are, and whether they update in real time
or are static snapshots.

### tournament_overview — full confirmed field list

Every top-level key with type and notes on when it appears.

### get_all_rounds — full confirmed round field list

Every field per round object. Exact key name for extra time. Whether timer_end_datetime
is present live and whether it accounts for round-level extra time.

### matches-list — full confirmed match object fields

Every field with type. The player_match_relationships sub-shape. Pagination behavior.

### Key timing conclusions

Answer these directly:
- Can we get timer expiry directly from the API, or must we compute it from started_at?
- If timer_end_datetime exists live: does it include round-level extra time added by the TO?
- Is tournament_overview a live countdown or a static snapshot?
- What is the exact moment completed_at is set — at timer expiry or at the last result?

### Surprises

Anything that differed from expectations.

### Open questions

Anything not verifiable during this session.

### Suggested doc updates

Specific sentences to add or change in the Carde.io documentation.
