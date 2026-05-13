# PurpleFox Exporter — Improvement TODO

## Real-time & sync
- [ ] Replace polling with SSE or WebSocket push — right now every client polls independently; a server-sent event on each sync would cut unnecessary load and make all connected clients update simultaneously
- [ ] Per-user sync state: track which client last triggered a sync and surface "synced X seconds ago by hj" in the header
- [ ] Auto-backfill on server start — running it once at startup costs nothing and ensures timing data is always fresh

## Analysis depth
- [ ] Round duration report: actual time from `started_at` to `completed_at` vs scheduled — which rounds ran long and by how much
- [ ] Inter-round gap tracking: time between `completed_at` of round N and `started_at` of round N+1 — identifies slow pairings/announcement cycles
- [ ] Per-table incident heatmap: tables that show up repeatedly across drops, extensions, judge seats, and penalties — slow play candidates
- [ ] Drop timing: flag drops that arrive after the round should have ended (player should have been playing)
- [ ] Judge efficiency: which judges covered the most tables, which tables had repeat coverage
- [ ] Extension pattern: show average extensions per round — useful for adjusting future round lengths

## Operational
- [ ] Manual drop entry from the UI — right now you can only see drops synced from PurpleFox, not add ad-hoc ones during a round before PF is updated
- [ ] Manual penalty entry — same gap; you may issue a penalty that isn't yet in PurpleFox
- [ ] Notes field on drops and penalties — freeform text that lives only in the local DB, not synced back
- [ ] Print view / PDF export per round for physical records at end of day
- [ ] Browser push notifications when new drops or penalties appear during live sync (Web Notifications API)

## Multi-tournament / multi-user
- [ ] Dynamic tournament registration from the UI — right now adding a tournament requires editing `serve.py`
- [ ] Per-user role tiers: viewer vs judge (can annotate) vs HJ (can add manual drops/penalties) vs admin
- [ ] Audit trail: log who viewed what and when in a local `access_log` table — useful for accountability

## Tech / reliability
- [ ] Move secrets out of source code — `CARDE_API_TOKEN`, `USERS`, and `ADMINS` should be in a `.env` file or environment variables so you don't commit them
- [ ] DB backup endpoint: `/api/backup` that streams the SQLite file as a download (admin only) — one-click backup before a big event
- [ ] Config endpoint: `/api/config` (admin) to read/set default refresh interval, announce when event starts, etc.
- [ ] Structured server logging to a file with rotation — right now everything goes to stdout and is lost on restart
- [ ] Health check endpoint: `/api/health` that returns uptime and last sync times — useful for monitoring on the VPS
