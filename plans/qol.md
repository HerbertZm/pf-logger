# QoL Improvements

Day-of-event UX improvements. Each item is self-contained and can be shipped independently between events.

**Phase 1 (2026-06-02):** QoL 1–13 implemented in the React app. Duration-dependent pieces of QoL 2 and 10 show `n/a` until Phase 2 timing data.

**Dependency note:** QoL 2, 4, and 10 rely on QoL 1 (logistics filtering). QoL 9 benefits from QoL 6 (operator notes). All others are standalone.

**Design Phase note:** The Design Phase (before Phase 1) implements the design system and component library. QoL items that touch the UI should use those classes and tokens — no new inline styles.

**Already shipped (not numbered QoL items):** Round timing **CSV export** lives on the admin Reports tab (`plans/reports.md`). Dashboard **indicators row → live round** selection via `DashboardRoundContext` (2026-06-01).

---

## Shipping Schedule

| Checkpoint | When | Items | Total est. |
|---|---|---|---|
| **0** | Before Phase 0 — ship against current Python/JS | QoL 8, 11, 12, 5, 7, 1, 3 | ~11 hrs |
| **1** | After Design Phase — use new CSS components | QoL 4, 13 | ~4 hrs |
| **2** | During Phase 1 — needs new backend endpoint | QoL 6, 9 | ✅ shipped |
| **blocked** | After Phase 2 — needs `result_at` duration data | QoL 2, 10 (duration column) | — |

Checkpoint 0 items ship in the current Python codebase and get ported into the new TS frontend as part of Phase 0. Porting cost is low — all are self-contained JS functions with no backend dependency.

---

## QoL 1 — Extension Logistics Filtering ✅

Large extensions (e.g. 55+ minutes) are not judge responses — they're the TO pausing the clock for lunch, late starts, or early-round adjustments. These should be excluded from Insights metrics without deleting them from the DB.

- Configurable `extensionLogisticsThresholdMin` (default 50), settable via **Manage → App config** (`PATCH /api/admin/config`) — ✅ done
- Tag logistics extensions during rendering, not at the data layer — ✅ Insights totals, per-round counts, histogram
- Show a dimmed note: "N extensions > 50 min excluded (logistics)" — ✅ done
- Raw values remain visible in Data tab — unchanged (full extension rows in DB explorer)

---

## QoL 2 — Round-Over-Round Comparison ✅ (partial)

Side-by-side stat panel in Insights for any two rounds: extensions, drops, penalties, outstanding tables, round duration, with a delta column (▲/▼ color-coded).

**⚠️ Duration requires reliable `result_at` data.** Implement after Phase 2.4 (Round Timing Analysis) provides `result_at` per match, or define a fallback (show "N/A" when data unavailable).

Depends on QoL 1.

**Shipped:** `RoundComparePanel` on Insights — pick round A/B, delta column for drops/extensions/penalties/late tables; overtime shows `n/a`.

---

## QoL 3 — Round Pace Indicator ✅

Badge on each active round block in Insights: "on track / Xm over / significantly over" based on elapsed time vs. `timer_end_datetime`. Red alert banner when a round is >15 minutes past time called. No badge for completed rounds or Top-8 (no `timer_end_datetime`).

**Shipped:** `getRoundPace` / `useRoundPace`; dashboard `RoundStrip` + live alert in `ActiveRound`; pace line in Insights `RoundRow`.

---

## QoL 4 — Extension Distribution Histogram ✅

Small bar chart inside each round block showing extension lengths in 5-minute buckets. Renders only when 2+ extensions exist for the round. Logistics extensions excluded.

Depends on QoL 1.

**Shipped:** `ExtensionHistogram` (requires 2+ operational extensions).

---

## QoL 5 — "New Since Last Sync" Tab Badge ✅

After each worker cycle with new data, show a count badge on the Logs tab. Clears when the user switches to Logs.

**Shipped:** `useLogsBadge` polls `/api/logs` in `App.tsx`; badge on Logs tab in `TabBar`.

---

## QoL 6 — Operator Notes Per Round ✅

Head judge can attach a freeform note to any round ("deck check pile-up at tables 12–15"). Notes live in `rounds.operator_notes` (PostgreSQL), never synced externally. Editable inline by admin+ users. New endpoint: `PATCH /api/rounds/:id/notes`.

---

## QoL 7 — Collapsible Round Blocks in Logs Tab ✅

Group Logs feed by round with collapsible headers. Default: highest-numbered round expanded, others collapsed. Open/closed state preserved across worker refresh cycles.

**Shipped:** `RoundGroup` with per-tournament `localStorage`; latest round expanded by default.

---

## QoL 8 — Quick Filter Presets ✅

One-click buttons above the filter bar: "This round", "Extensions only", "Drops only", "Penalties only", "Clear". Active preset highlighted. Presets do not persist across page loads.

**Shipped:** `FilterBar` preset row.

---

## QoL 9 — Copy-to-Clipboard Round Summary ✅

"Copy" button in each round header in Insights. Produces paste-ready plain text for Discord/Slack: tournament name, round, timer range, drops, extensions, penalties, operator notes if set. Falls back to `alert()` on non-HTTPS. Logistics extensions excluded.

Benefits from QoL 6 (notes in output).

---

## QoL 10 — Trend View (All-Rounds Overview Table) ✅ (partial)

Compact table at the top of Insights: drops, extensions, penalties, outstanding tables, duration for every round. Renders when 2+ rounds of data exist. Zero cells show as "—".

**⚠️ Duration requires reliable `result_at` data.** Same constraint as QoL 2.

Depends on QoL 1.

**Shipped:** `CrossRoundSummary` table + event totals. Overtime/duration column still `n/a` until worker timing (Phase 2).

---

## QoL 11 — Keyboard Shortcuts ✅

`1–N`: switch numbered main tabs (dashboard → manage; Session gear is not numbered). `Ctrl+Enter`: trigger manual sync (admin+). `F`: focus search and jump to Logs. `Esc`: blur inputs. Keys suppressed when focus is in an input/textarea/select. Shortcuts listed in Guide tab.

**Shipped:** `useTabKeyboard`; **Guide** tab with `GuidePanel`.

---

## QoL 12 — Filter and Sort State Persistence ✅ (partial)

Preserve round filter, type filter, search text, highlight-new toggle, and refresh interval across tab switches and page refreshes via `localStorage`. Graceful fallback if a saved round no longer exists in the current tournament.

**Shipped:** Per-tournament logs filter (`logs-filter-{id}`) including round filter; round collapse keys per tournament; configurable poll interval (15–60s); highlight-new entries (blue ring) while on another tab.

---

## QoL 13 — "What Changed Since Last Sync" Diff Banner ✅

After each worker cycle with changes, show a collapsible banner in Logs: new drops, extensions, and penalties since the previous load. Suppressed on first (cold) load. Dismiss button hides until next cycle with changes.

**Shipped:** `LogsDiffBanner` (count delta between polls).

---
