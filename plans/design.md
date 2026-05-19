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
- No build step — CSS custom properties only, no Tailwind, no PostCSS
- All interactive elements 44px minimum touch target
- No animations on data updates — sync cycles are frequent, animation would be jarring
- Active round timer must be the most visually prominent element on the main screen

---

## D.3 — Design System Implementation

Translate the design session output into static files:

```
static/css/
  theme.css        — CSS custom properties (tokens only, no classes)
  layout.css       — grid, flex, page structure, responsive breakpoints
  components.css   — all component classes (buttons, panels, badges, tables, modals, toasts)
```

All recurring inline `style=""` attributes in the current `index.html` replaced with classes from this system.

---

## D.4 — HTML/JS Shell Build

Build the static frontend shell that Phase 1 features plug into:

```
index.html         — app shell, tab structure, persistent header (~200 lines)
static/js/
  api.js           — apiFetch(), worker status polling
  auth.js          — login, session state, role-based visibility
  ui.js            — tab switching, renderAll(), source-aware column toggling
```

Source-aware rendering: `ui.js` receives the `sources` config for the active tournament and applies/removes CSS classes to show or hide source-conditional elements. No conditional logic scattered across render functions — one source config object controls all column visibility.

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

- Design token spec approved and implemented as CSS custom properties
- All key screens have a wireframe/mockup approved before implementation starts
- Component classes cover all states (loading, error, empty, populated)
- Carde-only mode renders correctly — no broken column references
- Mobile layout tested at 375px width (iPhone SE)
- Touch targets verified at 44px minimum
- Dark mode works without any JS — CSS only via `prefers-color-scheme`
