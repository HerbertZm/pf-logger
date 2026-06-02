# Open Decisions

Decisions that block specific phase work. Resolve before starting the phase that depends on them.

---

## OD-1 — Event model default (blocks Phase 2.1)

Should existing tournaments automatically get a 1:1 event wrapper when Phase 2.1 lands, or remain eventless until manually grouped?

**Recommendation:** Eventless by default. Forced wrapping creates noise for single-tournament deployments and forces superadmin cleanup.

**P1 update:** Minimal `app_events` ships in Phase 1 §1.2 for timezone only. `app_tournaments.event_id` is nullable; orphans stay eventless until superadmin groups them.

---

## OD-2 — Frontend static split: caching on LAN ✅ RESOLVED

Vite generates content-hashed filenames (`index-CIfqoxmd.js`) so cache busting is automatic — old assets are simply unreachable after a redeploy. `index.html` is served with no-cache headers by default in Express static. No additional config needed.

---

## OD-3 — Round duration source of truth (blocks QoL 2, QoL 10, Phase 2.4)

For round duration calculations, which is the primary source when both are available?

- **Phase 0 worker:** captures `result_at` (last match result in a round) from Carde in-progress data
- **Phase 2.5 StageTimer import:** provides actual clock stop events

**Recommendation:** `result_at` from Carde as primary (always available after Phase 0). StageTimer data as supplemental where available (more precise clock-stop timing). Show "N/A" when neither is available (e.g. in-progress rounds).

---

## Resolved / No Longer Applicable

| Decision | Resolution |
|---|---|
| OD-4 — Tournament timezone | **Phase 1 §1.2** — `timezone` on `app_events` (canonical) + denormalized on `app_tournaments`; inherit on create/link; UTC in DB, convert at display only |
| psycopg3 install method | Moot — rewriting to TypeScript + Prisma |
| `round_match_snapshots` table design | Resolved in Phase 0 schema: `rounds.missing_tables_json` + `snapshot_captured_at` |
| `sources JSONB` vs. mapping table | Resolved: `tournament_source_mapping` with `is_enabled` |
| Carde `status` filter functionality | Resolved: `status=in_progress` confirmed functional |
| Frontend caching on LAN (OD-2) | Resolved: Vite content-hashed filenames make this automatic |
