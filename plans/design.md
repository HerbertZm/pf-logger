# QoL Checkpoint 1 — After Design Phase

**Ship these once the design system and component classes are in place.** Both items use new CSS components (toasts, chart containers, banners) that come from the Design Phase output.

| Item | Description | Est. |
|---|---|---|
| QoL 4 — Extension Distribution Histogram | 5-min bucket bar chart per round block (needs QoL 1 done) | 2 hrs |
| QoL 13 — "What Changed Since Last Sync" Diff Banner | Collapsible banner after each worker cycle with changes | 2 hrs |

**Total: ~4 hrs in 1–2 sessions.**

---

# Design Phase — UI/UX Redesign

**Goal:** Produce a complete design system and screen spec before writing a single line of new frontend code. Everything built in Phase 1's frontend work implements the output of this phase.

**Prerequisite:** Phase 0 complete. The design must account for the new data architecture — source availability, async ingestion, and three-layer data model all affect what the UI can and cannot show.

**Reference:** `docs/DESIGN_BRIEF.md` — full context for a Claude Design session. Read it before starting any design work.

---

## D.1 — Update Design Brief

Before running a design session, update `docs/DESIGN_BRIEF.md` to reflect the new architecture:

- **Source-aware rendering:** The UI conditionally shows/hides entire columns and sections based on which sources are enabled for a tournament (`tournament_source_mapping`). Document which UI elements are PF-only, Carde-only, and shared.
- **Async ingestion:** Data freshness is driven by the background worker, not by user-triggered syncs. The UI needs a persistent freshness indicator ("last updated X seconds ago") and a manual re-trigger option, but shouldn't imply that clicking sync is the only path.
- **Worker state:** The UI should surface whether the worker is running, when it last successfully fetched, and whether there are errors — without cluttering the judge-facing view.

### Source-conditional UI map

| UI element | Requires | Hidden when |
|---|---|---|
| Drops list | PurpleFox | PF disabled |
| Extensions list | PurpleFox (or Carde in Carde-only mode) | Never hidden — source changes |
| Judge coverage | PurpleFox | PF disabled |
| Judge call outcomes | PurpleFox | PF disabled |
| Round timer / outstanding tables | Carde | Carde disabled (shouldn't happen) |
| Pairings / match data | Carde | Carde disabled |
| `time_extension_sec` on matches | Carde-only mode | PF enabled (PF is the source) |

---

## D.2 — Claude Design Session

Use the ready-to-paste prompt in `plans/design-prompt.md`. It is self-contained — open it, copy everything below the divider, and paste into a Claude Design session. Produce:

- **Design token spec:** Color palette (semantic: `--urgent`, `--warning`, `--success`, `--info`, `--muted`), spacing scale (4px base), type scale, border radius tokens, shadow levels
- **Component inventory:** Complete list of all UI components with states (default, hover, active, disabled, loading)
- **Navigation spec:** Tab structure, sticky header behavior, mobile bottom nav vs. top tabs decision, persistent context bar (tournament + round)
- **Key screen layouts:** Active round view, cross-round summary, logs feed, manage tab — wireframe or mockup level

### Key design constraints to enforce in the session

- Dark mode by default (venue lighting)
- Mobile-first: portrait phone is primary, tablet/laptop secondary
- No external fonts — system font stack only (LAN deployment, no CDN)
- Design tokens via CSS custom properties in `tokens.css` — no Tailwind, no CSS-in-JS
- No external component library — all components are built in-house
- All interactive elements 44px minimum touch target
- No animations on data updates — sync cycles are frequent, animation would be jarring
- Active round timer must be the most visually prominent element on the main screen

---

## D.3 — Design System Implementation

Translate the design session output into the React design system established in P0.8:

**Token file** (`client/src/styles/tokens.css`) — update with finalized values from the design session. The token structure already exists from P0.8; this step fills in the approved visual values (color palette, spacing scale, type scale, radius, shadows).

**Component audit** — review the shared component primitives built in P0.8 (`Badge`, `Button`, `Panel`, `Spinner`, `Toast`) against the approved component inventory. Update styles and add missing variants (loading states, error states, empty states) per the design spec.

**Layout update** — update `layout/` components (`TopBar`, `TabBar`, `ContextBar`) to match the approved navigation spec. This is where bottom nav vs. top tabs, sticky header behavior, and urgency badge placement get implemented.

No migration of inline `style=""` attributes — the React components are built from the start with tokens.

---

## D.4 — React Shell Implementation

With the design system in place, implement or refine the full screen layouts from the design session:

```
client/src/
  App.tsx                    — tab routing, persistent layout, source-aware wrappers
  components/
    layout/
      Shell.tsx              — outermost wrapper (TopBar + TabBar + content area)
      TopBar.tsx             — tournament name, current round, freshness, worker status
      TabBar.tsx             — tabs with urgency badges; mobile: bottom nav
      ContextBar.tsx         — persistent context strip (always visible)
    dashboard/
      ActiveRound.tsx        — primary view: timer + outstanding tables + counts
      RoundTimer.tsx         — large countdown, color-shifts via urgency tokens
      OutstandingTables.tsx  — collapsible table list with extension markers
    logs/
      LogFeed.tsx            — grouped by round, collapsible round headers
      FilterBar.tsx          — quick-filter presets + search input
    insights/
      CrossRoundSummary.tsx  — one row per round, zero-suppression cells
```

Source-aware rendering: `TournamentContext` exposes the `sources` config; components read `useTournament().sources.pf` and `useTournament().sources.carde` to conditionally render columns. No conditional logic scattered across components — one context value controls all source-conditional visibility.

---

## D.5 — Source-Aware Rendering Spec

Before implementing, define the full rendering contract:

- What does the UI look like with Carde + PF enabled? (current state, full columns)
- What does it look like in Carde-only mode? (no drops, no coverage, `time_extension_sec` from matches)
- What does "worker error" look like? (stale data banner, error indicator)
- What does "no data yet" look like for a newly configured tournament?
- What happens when the PF JWT is expired mid-event?

These states must be designed before implementation, not discovered during it.

---

## Verification Checklist

- Design token spec approved and `tokens.css` updated with finalized values
- All key screens have a wireframe/mockup approved before implementation starts
- All React components cover all states (loading, error, empty, populated)
- Carde-only mode renders correctly — no broken column references, no empty gaps
- Mobile layout tested at 375px width (iPhone SE) — no horizontal scroll
- Touch targets verified at 44px minimum across all interactive elements
- Dark mode renders correctly; no hardcoded light-mode colors in component styles
- `TournamentContext.sources` controls all source-conditional visibility — no scattered conditionals
