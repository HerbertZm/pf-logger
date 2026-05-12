#!/usr/bin/env python3
"""
PurpleFox Action Log Exporter — Local Network Server with Supabase JWT Proxy
Run: python serve.py
Then open http://<your-ip>:8765 on any device on your local network.

ROUTES
------
  GET  /                              → serves index.html
  POST /api/set-token                 → { "token": "<jwt>" }  stores JWT in memory
  GET  /api/token-status              → returns sanitized info about stored token
  GET  /api/clear-token               → wipes stored token
  GET  /api/sync?tournamentId=<id>    → fetch from Supabase, upsert SQLite, return rows
  GET  /api/logs?tournamentId=<id>    → return stored rows from SQLite (no network)
  GET  /api/schema                    → PostgREST OpenAPI with stored JWT
  GET  /proxy?url=<encoded-url>       → generic proxy to *.supabase.co
"""

import http.server
import socketserver
import socket
import sqlite3
import os
import sys
import json
import re
import secrets
import threading
import urllib.request
import urllib.error
import urllib.parse
import base64
from datetime import datetime, timezone

PORT = 8765
DIRECTORY = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(DIRECTORY, "action_logs.db")
SUPABASE_BASE = "https://upbcarvmkmyzhbosheyo.supabase.co/rest/v1"
CARDE_API_TOKEN = "ca05adef010f23d3eed5e56900f4959100681077"

# Known tournaments — carde_base_round_id = first_round_id - 1
TOURNAMENTS = {
    "4ac50cb1-f6ad-4507-94a1-6aee88b2cb7e": {
        "name": "Atlanta Regional Qualifier",
        "short": "Regional Qualifier",
        "carde_event_id": 502327,
        "carde_base_round_id": 721201,  # first round 721202
    },
    "17ed5ad8-0c94-41f9-bb22-2ec85453eeb2": {
        "name": "Regional Rebound",
        "short": "Regional Rebound",
        "carde_event_id": 513852,
        "carde_base_round_id": 727668,  # first round 727669
    },
}
SUPABASE_ANON_KEY = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
    ".eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVwYmNhcnZta215emhib3NoZXlvIiwicm9sZSI6ImFub24iL"
    "CJpYXQiOjE2NTE5MjQ5NjIsImV4cCI6MTk2NzUwMDk2Mn0"
    ".Ris66avSM8Qf7yEpyziybP4fm6NB7MPWPR4pRIflamI"
)

_state = {
    "token": None,
    "token_set_at": None,
    "token_set_by": None,
    "token_exp": None,
    "token_email": None,
}

USERS = {"admin": "admin", "hj": "hj", "hz": "hz"}
ADMINS = {"admin", "hz"}
SUPERADMINS = {"hz"}
_sessions = {}  # token → {username, exp}


# ── SQLite setup ───────────────────────────────────────────────────────────────

def db_connect():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def db_init():
    with db_connect() as conn:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS users (
                user_id      TEXT PRIMARY KEY,
                display_name TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS drops (
                tournament_id   TEXT NOT NULL,
                player_game_id  TEXT NOT NULL,
                round           INTEGER NOT NULL,
                table_number    INTEGER,
                player_name     TEXT,
                is_checked      INTEGER DEFAULT 0,
                is_cancelled    INTEGER DEFAULT 0,
                updated_by      TEXT,
                updated_by_name TEXT,
                PRIMARY KEY (tournament_id, player_game_id, round)
            );

            CREATE TABLE IF NOT EXISTS time_logs (
                id              INTEGER PRIMARY KEY,
                tournament_id   TEXT NOT NULL,
                round           INTEGER,
                table_number    INTEGER,
                action          TEXT,
                user_id         TEXT,
                created_at      TEXT
            );

            CREATE TABLE IF NOT EXISTS penalties (
                id              TEXT PRIMARY KEY,
                tournament_id   TEXT NOT NULL,
                round           INTEGER,
                player_game_id  TEXT,
                player_name     TEXT,
                description     TEXT,
                type            TEXT,
                sanction        TEXT,
                created_at      TEXT,
                creator_id      TEXT,
                creator_name    TEXT
            );

            CREATE TABLE IF NOT EXISTS table_time_updates (
                tournament_id   TEXT NOT NULL,
                table_number    INTEGER NOT NULL,
                status          TEXT,
                time_minutes    INTEGER,
                updated_at      TEXT NOT NULL,
                updated_by      TEXT,
                PRIMARY KEY (tournament_id, table_number, updated_at)
            );

            CREATE TABLE IF NOT EXISTS table_coverage (
                tournament_id   TEXT NOT NULL,
                table_number    INTEGER NOT NULL,
                covered_by      TEXT NOT NULL,
                first_seen_at   TEXT NOT NULL,
                PRIMARY KEY (tournament_id, table_number, covered_by)
            );

            CREATE TABLE IF NOT EXISTS table_judge_results (
                tournament_id   TEXT NOT NULL,
                table_number    INTEGER NOT NULL,
                judge_result    TEXT NOT NULL,
                judge           TEXT,
                first_seen_at   TEXT NOT NULL,
                PRIMARY KEY (tournament_id, table_number, judge_result)
            );

            CREATE TABLE IF NOT EXISTS tournament_meta (
                tournament_id   TEXT PRIMARY KEY,
                last_table      INTEGER,
                default_time    INTEGER,
                name            TEXT,
                updated_at      TEXT
            );

            CREATE TABLE IF NOT EXISTS table_players (
                tournament_id   TEXT NOT NULL,
                table_number    INTEGER NOT NULL,
                player_game_id  TEXT NOT NULL,
                player_name     TEXT,
                PRIMARY KEY (tournament_id, table_number, player_game_id)
            );

            CREATE TABLE IF NOT EXISTS round_pairings (
                tournament_id       TEXT NOT NULL,
                round               INTEGER NOT NULL,
                table_number        INTEGER NOT NULL,
                match_id            INTEGER,
                p1_name             TEXT,
                p1_user_id          TEXT,
                p2_name             TEXT,
                p2_user_id          TEXT,
                status              TEXT,
                time_extension_sec  INTEGER DEFAULT 0,
                winner_user_id      TEXT,
                PRIMARY KEY (tournament_id, round, table_number)
            );

            CREATE TABLE IF NOT EXISTS rounds_fetched (
                tournament_id   TEXT NOT NULL,
                round           INTEGER NOT NULL,
                fetched_at      TEXT NOT NULL,
                match_count     INTEGER DEFAULT 0,
                PRIMARY KEY (tournament_id, round)
            );

            CREATE TABLE IF NOT EXISTS round_timers (
                tournament_id           TEXT NOT NULL,
                round                   INTEGER NOT NULL,
                carde_round_id          INTEGER,
                started_at              TEXT,
                completed_at            TEXT,
                timer_duration_minutes  INTEGER,
                carde_status            TEXT,
                incomplete_at_end       INTEGER,
                PRIMARY KEY (tournament_id, round)
            );

            CREATE TABLE IF NOT EXISTS user_activity (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                event_type  TEXT NOT NULL,
                username    TEXT NOT NULL,
                ip          TEXT,
                user_agent  TEXT,
                detail      TEXT,
                created_at  TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS drops_tourn         ON drops(tournament_id);
            CREATE INDEX IF NOT EXISTS timelogs_tourn      ON time_logs(tournament_id);
            CREATE INDEX IF NOT EXISTS penalties_tourn     ON penalties(tournament_id);
            CREATE INDEX IF NOT EXISTS time_updates_tourn  ON table_time_updates(tournament_id);
            CREATE INDEX IF NOT EXISTS coverage_tourn      ON table_coverage(tournament_id);
            CREATE INDEX IF NOT EXISTS judge_res_tourn     ON table_judge_results(tournament_id);
        """)
        # Migrations
        cols = [r[1] for r in conn.execute("PRAGMA table_info(tournament_meta)").fetchall()]
        if "is_ended" not in cols:
            conn.execute("ALTER TABLE tournament_meta ADD COLUMN is_ended INTEGER DEFAULT 0")
        cols = [r[1] for r in conn.execute("PRAGMA table_info(drops)").fetchall()]
        if "added_by_name" not in cols:
            conn.execute("ALTER TABLE drops ADD COLUMN added_by_name TEXT")
        if "verified_by_name" not in cols:
            conn.execute("ALTER TABLE drops ADD COLUMN verified_by_name TEXT")
        cols = [r[1] for r in conn.execute("PRAGMA table_info(table_time_updates)").fetchall()]
        if "status" not in cols:
            conn.execute("ALTER TABLE table_time_updates ADD COLUMN status TEXT")
        if "round" not in cols:
            conn.execute("ALTER TABLE table_time_updates ADD COLUMN round INTEGER")
        cols = [r[1] for r in conn.execute("PRAGMA table_info(table_judge_results)").fetchall()]
        if "judge" not in cols:
            conn.execute("ALTER TABLE table_judge_results ADD COLUMN judge TEXT")
        if "round" not in cols:
            conn.execute("ALTER TABLE table_judge_results ADD COLUMN round INTEGER")
        cols = [r[1] for r in conn.execute("PRAGMA table_info(table_coverage)").fetchall()]
        if "round" not in cols:
            conn.execute("ALTER TABLE table_coverage ADD COLUMN round INTEGER")
        cols = [r[1] for r in conn.execute("PRAGMA table_info(round_timers)").fetchall()]
        for col, typ in [("carde_round_id", "INTEGER"), ("completed_at", "TEXT"),
                         ("timer_duration_minutes", "INTEGER"), ("carde_status", "TEXT"),
                         ("incomplete_at_end", "INTEGER"), ("missing_tables_json", "TEXT"),
                         ("timer_end_datetime", "TEXT"), ("extra_time_seconds", "INTEGER")]:
            if col not in cols:
                conn.execute(f"ALTER TABLE round_timers ADD COLUMN {col} {typ}")
        cols = [r[1] for r in conn.execute("PRAGMA table_info(rounds_fetched)").fetchall()]
        for col, typ in [("carde_round_id", "INTEGER"), ("carde_status", "TEXT")]:
            if col not in cols:
                conn.execute(f"ALTER TABLE rounds_fetched ADD COLUMN {col} {typ}")


def db_upsert_users(conn, pairs):
    """pairs: list of (user_id, display_name) — silently skips blank ids/names."""
    conn.executemany(
        "INSERT OR REPLACE INTO users (user_id, display_name) VALUES (?, ?)",
        [(uid, name) for uid, name in pairs if uid and name]
    )


def db_resolve_name(conn, user_id):
    if not user_id:
        return ""
    row = conn.execute("SELECT display_name FROM users WHERE user_id = ?", (user_id,)).fetchone()
    return row["display_name"] if row else user_id  # fall back to raw UUID


def db_upsert_drops(conn, rows):
    # Pass 1: insert new drops — preserves added_by_name for rows already in DB.
    # added_by_name is only set when the drop is still unchecked (updater = adder).
    conn.executemany("""
        INSERT OR IGNORE INTO drops
          (tournament_id, player_game_id, round, table_number,
           player_name, is_checked, is_cancelled, updated_by, updated_by_name,
           added_by_name, verified_by_name)
        VALUES
          (:tournament_id, :player_game_id, :round, :table_number,
           :player_name, :is_checked, :is_cancelled, :updated_by, :updated_by_name,
           :added_by_name, :verified_by_name)
    """, rows)
    # Pass 2: for unchecked drops, stamp added_by_name if still NULL.
    # updated_by_name is reliably the adder while the drop is unchecked.
    unchecked = [r for r in rows if not r["is_checked"] and r.get("added_by_name")]
    if unchecked:
        conn.executemany("""
            UPDATE drops SET
              added_by_name = COALESCE(added_by_name, :added_by_name)
            WHERE tournament_id  = :tournament_id
              AND player_game_id = :player_game_id
              AND round          = :round
              AND is_checked     = 0
        """, unchecked)
    # Pass 3: stamp verified_by_name (and sync is_checked/is_cancelled) for checked rows.
    # COALESCE keeps the first verifier name we ever saw rather than overwriting.
    checked = [r for r in rows if r["is_checked"]]
    if checked:
        conn.executemany("""
            UPDATE drops SET
              is_checked       = 1,
              is_cancelled     = :is_cancelled,
              verified_by_name = COALESCE(verified_by_name, :verified_by_name)
            WHERE tournament_id  = :tournament_id
              AND player_game_id = :player_game_id
              AND round          = :round
        """, checked)


def db_upsert_time_logs(conn, rows):
    conn.executemany("""
        INSERT OR REPLACE INTO time_logs
          (id, tournament_id, round, table_number, action, user_id, created_at)
        VALUES
          (:id, :tournament_id, :round, :table_number, :action, :user_id, :created_at)
    """, rows)


def db_read_drops(conn, tournament_id):
    cur = conn.execute(
        "SELECT * FROM drops WHERE tournament_id = ? ORDER BY round DESC",
        (tournament_id,)
    )
    return [dict(r) for r in cur.fetchall()]


def db_read_time_logs(conn, tournament_id):
    cur = conn.execute(
        "SELECT * FROM time_logs WHERE tournament_id = ? ORDER BY id DESC",
        (tournament_id,)
    )
    return [dict(r) for r in cur.fetchall()]


def db_upsert_penalties(conn, rows):
    conn.executemany("""
        INSERT OR REPLACE INTO penalties
          (id, tournament_id, round, player_game_id, player_name,
           description, type, sanction, created_at, creator_id, creator_name)
        VALUES
          (:id, :tournament_id, :round, :player_game_id, :player_name,
           :description, :type, :sanction, :created_at, :creator_id, :creator_name)
    """, rows)


def db_upsert_table_time_updates(conn, rows):
    """INSERT OR IGNORE — each (table, updated_at) timestamp is a unique event."""
    conn.executemany("""
        INSERT OR IGNORE INTO table_time_updates
          (tournament_id, table_number, status, time_minutes, updated_at, updated_by, round)
        VALUES
          (:tournament_id, :table_number, :status, :time_minutes, :updated_at, :updated_by, :round)
    """, rows)


def db_upsert_table_coverage(conn, rows):
    """INSERT OR IGNORE — records the first time we see each (table, judge) pair."""
    conn.executemany("""
        INSERT OR IGNORE INTO table_coverage
          (tournament_id, table_number, covered_by, first_seen_at, round)
        VALUES
          (:tournament_id, :table_number, :covered_by, :first_seen_at, :round)
    """, rows)


def db_upsert_table_players(conn, rows):
    """INSERT OR REPLACE — always reflects the latest round's pairings."""
    conn.executemany("""
        INSERT OR REPLACE INTO table_players
          (tournament_id, table_number, player_game_id, player_name)
        VALUES (?, ?, ?, ?)
    """, [(r["tournament_id"], r["table_number"], r["player_game_id"], r["player_name"]) for r in rows])


def db_read_table_players(conn, tournament_id):
    cur = conn.execute(
        "SELECT table_number, player_game_id, player_name FROM table_players WHERE tournament_id = ?",
        (tournament_id,)
    )
    return [dict(r) for r in cur.fetchall()]


def db_upsert_tournament_meta(conn, row):
    conn.execute("""
        INSERT INTO tournament_meta
          (tournament_id, last_table, default_time, name, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(tournament_id) DO UPDATE SET
          last_table   = excluded.last_table,
          default_time = excluded.default_time,
          name         = excluded.name,
          updated_at   = excluded.updated_at
    """, (row["tournament_id"], row["last_table"], row["default_time"], row["name"], row["updated_at"]))


def db_read_tournament_meta(conn, tournament_id):
    row = conn.execute(
        "SELECT * FROM tournament_meta WHERE tournament_id = ?", (tournament_id,)
    ).fetchone()
    return dict(row) if row else {}


def db_upsert_round_pairings(conn, rows):
    conn.executemany("""
        INSERT OR REPLACE INTO round_pairings
          (tournament_id, round, table_number, match_id, p1_name, p1_user_id,
           p2_name, p2_user_id, status, time_extension_sec, winner_user_id)
        VALUES
          (:tournament_id, :round, :table_number, :match_id, :p1_name, :p1_user_id,
           :p2_name, :p2_user_id, :status, :time_extension_sec, :winner_user_id)
    """, rows)


def db_read_round_pairings(conn, tournament_id):
    cur = conn.execute(
        "SELECT * FROM round_pairings WHERE tournament_id = ? ORDER BY round, table_number",
        (tournament_id,)
    )
    return [dict(r) for r in cur.fetchall()]


def db_mark_round_fetched(conn, tournament_id, round_num, match_count,
                          carde_round_id=None, carde_status=None):
    conn.execute("""
        INSERT INTO rounds_fetched (tournament_id, round, fetched_at, match_count, carde_round_id, carde_status)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(tournament_id, round) DO UPDATE SET
          fetched_at     = excluded.fetched_at,
          match_count    = excluded.match_count,
          carde_round_id = excluded.carde_round_id,
          carde_status   = excluded.carde_status
    """, (tournament_id, round_num, datetime.now(timezone.utc).isoformat(),
          match_count, carde_round_id, carde_status))


def db_get_fetched_rounds(conn, tournament_id):
    cur = conn.execute(
        "SELECT round, carde_status FROM rounds_fetched WHERE tournament_id = ?", (tournament_id,)
    )
    return {row["round"]: row["carde_status"] for row in cur.fetchall()}


def db_upsert_round_timer(conn, tournament_id, round_num, carde_round_id,
                          started_at, completed_at, timer_duration_minutes,
                          carde_status, incomplete_at_end=None,
                          timer_end_datetime=None, extra_time_seconds=None):
    conn.execute("""
        INSERT INTO round_timers
          (tournament_id, round, carde_round_id, started_at, completed_at,
           timer_duration_minutes, carde_status, incomplete_at_end,
           timer_end_datetime, extra_time_seconds)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(tournament_id, round) DO UPDATE SET
          carde_round_id         = excluded.carde_round_id,
          started_at             = COALESCE(excluded.started_at, round_timers.started_at),
          completed_at           = COALESCE(excluded.completed_at, round_timers.completed_at),
          timer_duration_minutes = COALESCE(excluded.timer_duration_minutes, round_timers.timer_duration_minutes),
          carde_status           = excluded.carde_status,
          incomplete_at_end      = COALESCE(excluded.incomplete_at_end, round_timers.incomplete_at_end),
          timer_end_datetime     = COALESCE(excluded.timer_end_datetime, round_timers.timer_end_datetime),
          extra_time_seconds     = COALESCE(excluded.extra_time_seconds, round_timers.extra_time_seconds)
    """, (tournament_id, round_num, carde_round_id, started_at, completed_at,
          timer_duration_minutes, carde_status, incomplete_at_end,
          timer_end_datetime, extra_time_seconds))


def db_read_round_timers(conn, tournament_id):
    cur = conn.execute(
        "SELECT * FROM round_timers WHERE tournament_id = ? ORDER BY round",
        (tournament_id,)
    )
    return [dict(r) for r in cur.fetchall()]


def db_upsert_table_judge_results(conn, rows):
    """INSERT OR IGNORE — records first time we see each (table, result) pair."""
    conn.executemany("""
        INSERT OR IGNORE INTO table_judge_results
          (tournament_id, table_number, judge_result, judge, first_seen_at, round)
        VALUES
          (:tournament_id, :table_number, :judge_result, :judge, :first_seen_at, :round)
    """, rows)


def db_read_penalties(conn, tournament_id):
    cur = conn.execute(
        "SELECT * FROM penalties WHERE tournament_id = ? ORDER BY created_at DESC",
        (tournament_id,)
    )
    return [dict(r) for r in cur.fetchall()]


def db_read_table_time_updates(conn, tournament_id):
    cur = conn.execute(
        "SELECT * FROM table_time_updates WHERE tournament_id = ? ORDER BY updated_at DESC",
        (tournament_id,)
    )
    return [dict(r) for r in cur.fetchall()]


def db_read_table_coverage(conn, tournament_id):
    cur = conn.execute(
        "SELECT * FROM table_coverage WHERE tournament_id = ? ORDER BY first_seen_at DESC",
        (tournament_id,)
    )
    return [dict(r) for r in cur.fetchall()]


def db_log_activity(event_type, username, ip="", user_agent="", detail=""):
    try:
        with db_connect() as conn:
            conn.execute(
                "INSERT INTO user_activity (event_type, username, ip, user_agent, detail, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (event_type, username, ip, user_agent, detail,
                 datetime.now(timezone.utc).isoformat())
            )
    except Exception as e:
        print(f"  [activity] log error: {e}", flush=True)


def db_read_activity(limit=500):
    with db_connect() as conn:
        rows = conn.execute(
            "SELECT * FROM user_activity ORDER BY id DESC LIMIT ?", (limit,)
        ).fetchall()
    return [dict(r) for r in rows]


def db_read_table_judge_results(conn, tournament_id):
    cur = conn.execute(
        "SELECT * FROM table_judge_results WHERE tournament_id = ? ORDER BY first_seen_at DESC",
        (tournament_id,)
    )
    return [dict(r) for r in cur.fetchall()]


# ── Supabase fetch helpers ────────────────────────────────────────────────────

def supabase_get(path, params="", timeout=20):
    url = f"{SUPABASE_BASE}/{path}?{params}" if params else f"{SUPABASE_BASE}/{path}"
    req = urllib.request.Request(url)
    req.add_header("apikey", SUPABASE_ANON_KEY)
    req.add_header("Authorization", f"Bearer {_state['token']}")
    req.add_header("Accept", "application/json")
    req.add_header("Prefer", "count=none")
    req.add_header("User-Agent", "PurpleFox-Exporter/1.0")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read())


def safe_supabase_get(label, path, params=""):
    """supabase_get with logging and graceful failure — returns [] on error."""
    try:
        result = supabase_get(path, params)
        print(f"    {label}: {len(result)} rows", flush=True)
        return result
    except Exception as e:
        print(f"    {label}: FAILED — {e}", flush=True)
        return []


def _carde_get(path, label):
    url = f"https://api.admin.carde.io{path}"
    req = urllib.request.Request(url)
    req.add_header("Authorization", f"Token {CARDE_API_TOKEN}")
    req.add_header("Accept", "application/json")
    req.add_header("User-Agent", "PurpleFox-Exporter/1.0")
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return json.loads(resp.read())
    except Exception as e:
        print(f"    carde.io {label}: FAILED — {e}", flush=True)
        return None


def fetch_carde_all_rounds(event_id):
    data = _carde_get(f"/api/magic-events/{event_id}/get_all_rounds/", "get_all_rounds")
    if not data:
        return []
    rounds = []
    for phase in data:
        rounds.extend(phase.get("rounds") or [])
    print(f"    carde.io get_all_rounds: {len(rounds)} rounds", flush=True)
    return rounds


def fetch_carde_tournament_overview(event_id):
    data = _carde_get(f"/api/magic-events/{event_id}/tournament_overview/", "tournament_overview")
    if not data:
        return {}
    print(f"    carde.io tournament_overview: {data.get('lifecycle_status')} / "
          f"timer_running={data.get('timer_is_running')} / "
          f"incomplete={data.get('number_of_incomplete_matches')}", flush=True)
    return data


def fetch_carde_pairings(round_num, carde_round_id):
    """Fetch all matches for a round from carde.io, handling pagination."""
    round_id = carde_round_id
    base_url = (
        f"https://api.admin.carde.io/api/v2/organize/tournament-rounds"
        f"/{round_id}/matches-list/?round_id={round_id}&page_size=25"
    )
    all_matches = []
    page = None
    while True:
        url = base_url + (f"&page={page}" if page else "")
        req = urllib.request.Request(url)
        req.add_header("Authorization", f"Token {CARDE_API_TOKEN}")
        req.add_header("Accept", "application/json")
        req.add_header("User-Agent", "PurpleFox-Exporter/1.0")
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read())
        except Exception as e:
            print(f"    carde.io round {round_num} page {page}: FAILED — {e}", flush=True)
            break
        results = data.get("results") or []
        all_matches.extend(results)
        nxt = data.get("next")
        if not nxt:
            break
        page = nxt
    print(f"    carde.io round {round_num}: {len(all_matches)} raw matches fetched", flush=True)
    return all_matches


def parse_carde_pairings(tournament_id, round_num, raw_matches):
    """Extract structured pairing rows from carde.io match data."""
    rows = []
    for m in raw_matches:
        if m.get("match_is_bye") or (m.get("table_number") or 0) <= 0:
            continue
        rels = m.get("player_match_relationships") or []
        p1 = next((r for r in rels if r.get("player_order") == 1), {})
        p2 = next((r for r in rels if r.get("player_order") == 2), {})

        def get_name(rel):
            ues = rel.get("user_event_status") or {}
            return ues.get("user_identifier") or ""

        def get_uid(rel):
            ues = rel.get("user_event_status") or {}
            u = ues.get("user") or {}
            return str(u.get("id") or "")

        rows.append({
            "tournament_id":      tournament_id,
            "round":              round_num,
            "table_number":       m["table_number"],
            "match_id":           m.get("id"),
            "p1_name":            get_name(p1),
            "p1_user_id":         get_uid(p1),
            "p2_name":            get_name(p2),
            "p2_user_id":         get_uid(p2),
            "status":             m.get("status") or "",
            "time_extension_sec": m.get("time_extension_seconds") or 0,
            "winner_user_id":     str(m.get("winning_player_id") or ""),
        })
    return rows


def _build_missing_tables_json(conn, tournament_id, round_num):
    """Build JSON list of table numbers missing results at time-called."""
    missing = conn.execute(
        "SELECT table_number FROM round_pairings "
        "WHERE tournament_id=? AND round=? "
        "AND (winner_user_id IS NULL OR winner_user_id='') "
        "ORDER BY table_number",
        (tournament_id, round_num)
    ).fetchall()
    if not missing:
        return None
    return json.dumps([r[0] for r in missing])


def _compute_timer_end(started_at, timer_duration_minutes, extra_time_seconds=0):
    """Return ISO timestamp of scheduled round end, or None if inputs are missing."""
    if not started_at or not timer_duration_minutes:
        return None
    try:
        from datetime import timedelta
        dt = datetime.fromisoformat(started_at.replace('Z', '+00:00'))
        total_sec = timer_duration_minutes * 60 + (extra_time_seconds or 0)
        return (dt + timedelta(seconds=total_sec)).isoformat()
    except Exception:
        return None


_carde_lock = threading.Lock()
_carde_running = set()  # set of tournament_ids currently being fetched


def _carde_worker(tournament_id, rounds_to_fetch):
    # rounds_to_fetch: list of {round_num, carde_round_id, carde_status}
    try:
        for r in rounds_to_fetch:
            rnum = r["round_num"]
            carde_round_id = r["carde_round_id"]
            carde_status = r["carde_status"]
            print(f"    [bg] carde.io round {rnum} (id={carde_round_id})…", flush=True)
            raw_matches = fetch_carde_pairings(rnum, carde_round_id)
            pairing_rows = parse_carde_pairings(tournament_id, rnum, raw_matches)
            with db_connect() as conn:
                if pairing_rows:
                    db_upsert_round_pairings(conn, pairing_rows)
                incomplete = None
                if carde_status == "COMPLETE":
                    row = conn.execute(
                        "SELECT COUNT(*) FROM round_pairings WHERE tournament_id=? AND round=? "
                        "AND (winner_user_id IS NULL OR winner_user_id='')",
                        (tournament_id, rnum)
                    ).fetchone()
                    incomplete = row[0] if row else 0
                    conn.execute(
                        "UPDATE round_timers SET incomplete_at_end=? "
                        "WHERE tournament_id=? AND round=? AND incomplete_at_end IS NULL",
                        (incomplete, tournament_id, rnum)
                    )
                # Snapshot fetch: write missing table list from fresh carde.io data
                if r.get("snapshot") and pairing_rows:
                    missing_json = _build_missing_tables_json(conn, tournament_id, rnum)
                    if missing_json:
                        conn.execute(
                            "UPDATE round_timers SET missing_tables_json=? "
                            "WHERE tournament_id=? AND round=? AND missing_tables_json IS NULL",
                            (missing_json, tournament_id, rnum)
                        )
                        print(f"    [bg] round {rnum}: missing table list written", flush=True)
                db_mark_round_fetched(conn, tournament_id, rnum, len(pairing_rows),
                                      carde_round_id=carde_round_id, carde_status=carde_status)
            print(f"    [bg] round {rnum}: {len(pairing_rows)} pairings"
                  + (f", {incomplete} incomplete" if incomplete is not None else ""), flush=True)
    except Exception as e:
        print(f"    [bg] carde.io error: {e}", flush=True)
    finally:
        with _carde_lock:
            _carde_running.discard(tournament_id)
        print(f"    [bg] carde.io fetch complete for {tournament_id[:8]}", flush=True)


def fetch_and_store(tournament_id):
    """Fetch all tables from Supabase, upsert into SQLite, return dict of row lists."""
    now_str = datetime.now(timezone.utc).isoformat()
    print(f"  fetching tournament {tournament_id[:8]}…", flush=True)

    raw_drops = safe_supabase_get(
        "tournament_drops",
        "tournament_drops",
        f"tournamentId=eq.{tournament_id}&select=*&order=round.desc"
    )
    raw_logs = safe_supabase_get(
        "tournament_logs",
        "tournament_logs",
        f"tournamentId=eq.{tournament_id}&select=*&order=id.desc"
    )
    raw_penalties = safe_supabase_get(
        "tournament_penalities",
        "tournament_penalities",
        f"tournamentId=eq.{tournament_id}&select=*&order=createdAt.desc"
    )
    # Only fetch the columns we need, filter to rows that have a timestamp
    raw_table_status = safe_supabase_get(
        "table_status",
        "table_status",
        f"tournamentId=eq.{tournament_id}&select=tableNumber,status,time,updated_status_at,updated_status_by"
    )
    # Only fetch tables where coveredBy or judgeResult is set — avoids pulling 700+ null rows
    raw_tables_covered = safe_supabase_get(
        "tables(coveredBy)",
        "tables",
        f"tournamentId=eq.{tournament_id}&select=tableNumber,coveredBy&coveredBy=not.is.null"
    )
    raw_tables_results = safe_supabase_get(
        "tables(judgeResult)",
        "tables",
        f"tournamentId=eq.{tournament_id}&select=tableNumber,judgeResult&judgeResult=not.is.null"
    )
    raw_tournament = safe_supabase_get(
        "tournaments",
        "tournaments",
        f"id=eq.{tournament_id}&select=id,name,lastTable,defaultTime,firstTable"
    )
    raw_tournament_time = safe_supabase_get(
        "tournament_time",
        "tournament_time",
        f"id=eq.{tournament_id}&select=id,time"
    )
    raw_players = safe_supabase_get(
        "players",
        "players",
        f"tournamentId=eq.{tournament_id}&select=gameId,name,tableNumber&tableNumber=not.is.null"
    )
    # User-name seed from drops across all tournaments
    global_drops = safe_supabase_get(
        "global_drops(users)",
        "tournament_drops",
        "select=updated_by,updated_by_name&limit=5000"
    )

    drops = [
        {
            "tournament_id":    r["tournamentId"],
            "player_game_id":   str(r.get("playerGameId", "")),
            "round":            r.get("round"),
            "table_number":     r.get("tableNumber"),
            "player_name":      r.get("playerName", ""),
            "is_checked":       1 if r.get("isChecked") else 0,
            "is_cancelled":     1 if r.get("isCancelled") else 0,
            "updated_by":       r.get("updated_by", ""),
            "updated_by_name":  r.get("updated_by_name", ""),
            # When unchecked, updated_by is the person who recorded the drop.
            # When already checked, we can't recover the original adder from this field.
            "added_by_name":    r.get("updated_by_name", "") if not r.get("isChecked") else "",
            # When checked, updated_by is the verifier.
            "verified_by_name": r.get("updated_by_name", "") if r.get("isChecked") else "",
        }
        for r in raw_drops
    ]

    time_logs = [
        {
            "id":            r["id"],
            "tournament_id": r["tournamentId"],
            "round":         r.get("round"),
            "table_number":  r.get("tableNumber"),
            "action":        r.get("action", ""),
            "user_id":       r.get("userId", ""),
            "created_at":    r.get("createdAt", ""),
        }
        for r in raw_logs
    ]

    penalties = [
        {
            "id":             r["id"],
            "tournament_id":  r["tournamentId"],
            "round":          r.get("round"),
            "player_game_id": str(r.get("playerGameId") or ""),
            "player_name":    r.get("playerName") or "",
            "description":    r.get("description") or "",
            "type":           r.get("type") or "",
            "sanction":       r.get("sanction") or "",
            "created_at":     r.get("createdAt") or "",
            "creator_id":     r.get("creator_id") or "",
            "creator_name":   r.get("creator_name") or "",
        }
        for r in raw_penalties
    ]

    # Determine current round from the freshest data available
    round_candidates = [r.get("round") for r in raw_logs if r.get("round")]
    if not round_candidates:
        round_candidates = [r.get("round") for r in raw_drops if r.get("round")]
    current_round = max(round_candidates) if round_candidates else None

    # table_status — every row with a timestamp is a unique status-change event
    table_time_updates = [
        {
            "tournament_id": tournament_id,
            "table_number":  r["tableNumber"],
            "status":        r.get("status") or "",
            "time_minutes":  r.get("time"),
            "updated_at":    r.get("updated_status_at") or "",
            "updated_by":    r.get("updated_status_by") or "",
            "round":         current_round,
        }
        for r in raw_table_status
        if r.get("updated_status_at")
    ]

    # tables rows where coveredBy is set (INSERT OR IGNORE preserves first_seen_at)
    table_coverage = [
        {
            "tournament_id": tournament_id,
            "table_number":  r["tableNumber"],
            "covered_by":    r["coveredBy"],
            "first_seen_at": now_str,
            "round":         current_round,
        }
        for r in raw_tables_covered
        if r.get("coveredBy")
    ]

    # Build lookup: tableNumber → updated_status_by from table_status
    status_judge = {
        r["tableNumber"]: r.get("updated_status_by") or ""
        for r in raw_table_status
    }

    # tables rows where judgeResult is set — cross-ref table_status for who did it
    table_judge_results = [
        {
            "tournament_id": tournament_id,
            "table_number":  r["tableNumber"],
            "judge_result":  r["judgeResult"],
            "judge":         status_judge.get(r["tableNumber"], ""),
            "first_seen_at": now_str,
            "round":         current_round,
        }
        for r in raw_tables_results
        if r.get("judgeResult")
    ]

    with db_connect() as conn:
        # Seed user cache from drops, global drops, and penalties
        all_user_pairs = (
            [(r["updated_by"], r["updated_by_name"]) for r in drops] +
            [(r.get("updated_by", ""), r.get("updated_by_name", "")) for r in global_drops] +
            [(r.get("creator_id", ""), r.get("creator_name", "")) for r in raw_penalties if r.get("creator_name")]
        )
        db_upsert_users(conn, all_user_pairs)
        db_upsert_drops(conn, drops)
        db_upsert_time_logs(conn, time_logs)
        db_upsert_penalties(conn, penalties)
        db_upsert_table_time_updates(conn, table_time_updates)
        db_upsert_table_coverage(conn, table_coverage)
        db_upsert_table_judge_results(conn, table_judge_results)
        table_players = [
            {
                "tournament_id":  tournament_id,
                "table_number":   r["tableNumber"],
                "player_game_id": str(r.get("gameId") or ""),
                "player_name":    r.get("name") or "",
            }
            for r in raw_players
            if r.get("tableNumber") and r.get("gameId")
        ]
        db_upsert_table_players(conn, table_players)

        if raw_tournament:
            t = raw_tournament[0]
            db_upsert_tournament_meta(conn, {
                "tournament_id": tournament_id,
                "last_table":    t.get("lastTable") or 0,
                "default_time":  t.get("defaultTime") or 0,
                "name":          t.get("name") or "",
                "updated_at":    now_str,
            })

        # Carde.io: fetch all round metadata + live overview
        tourn_config = TOURNAMENTS.get(tournament_id, {})
        carde_event_id = tourn_config.get("carde_event_id")
        live_status = {}
        if carde_event_id:
            carde_rounds = fetch_carde_all_rounds(carde_event_id)
            live_status = fetch_carde_tournament_overview(carde_event_id)
            # Store timing for every round we know about
            for cr in carde_rounds:
                rnum = cr.get("round_number")
                if rnum:
                    extra_sec = cr.get("extra_time_seconds") or cr.get("additional_time_seconds") or 0
                    ted = (cr.get("timer_end_datetime") or
                           _compute_timer_end(cr.get("started_at"),
                                              cr.get("timer_duration_minutes"),
                                              extra_sec))
                    db_upsert_round_timer(
                        conn, tournament_id, rnum,
                        carde_round_id=cr.get("id"),
                        started_at=cr.get("started_at"),
                        completed_at=cr.get("completed_at"),
                        timer_duration_minutes=cr.get("timer_duration_minutes"),
                        carde_status=cr.get("status") or "",
                        timer_end_datetime=ted,
                        extra_time_seconds=extra_sec or None,
                    )
            # Determine which rounds need pairing fetch / re-fetch
            fetched = db_get_fetched_rounds(conn, tournament_id)  # {round_num: carde_status}
            rounds_to_fetch = []
            for cr in carde_rounds:
                rnum = cr.get("round_number")
                carde_round_id = cr.get("id")
                carde_status = cr.get("status") or ""
                if not rnum or not carde_round_id:
                    continue
                prev_status = fetched.get(rnum)
                if prev_status is None:
                    rounds_to_fetch.append({"round_num": rnum, "carde_round_id": carde_round_id, "carde_status": carde_status})
                elif prev_status in ("UPCOMING", "SCHEDULED") and carde_status not in ("UPCOMING", "SCHEDULED"):
                    # Round just started (pairings now exist) — fetch
                    rounds_to_fetch.append({"round_num": rnum, "carde_round_id": carde_round_id, "carde_status": carde_status})
                elif prev_status != "COMPLETE" and carde_status == "COMPLETE":
                    # Round finished — re-fetch for final results
                    rounds_to_fetch.append({"round_num": rnum, "carde_round_id": carde_round_id, "carde_status": carde_status})
            # Snapshot: at first sync after clock hits 0, write count and queue a
            # fresh pairing fetch so we get the exact table list at time-called.
            if live_status:
                timer_end_str = live_status.get("timer_end_datetime")
                if timer_end_str:
                    try:
                        timer_end = datetime.fromisoformat(timer_end_str.replace('Z', '+00:00'))
                        if timer_end < datetime.now(timezone.utc):
                            ov_round = (live_status.get("current_round") or {}).get("round_number")
                            ov_incomplete = live_status.get("number_of_incomplete_matches")
                            if ov_round and ov_incomplete is not None:
                                conn.execute(
                                    "UPDATE round_timers SET incomplete_at_end=? "
                                    "WHERE tournament_id=? AND round=? AND incomplete_at_end IS NULL",
                                    (ov_incomplete, tournament_id, ov_round)
                                )
                            # Queue a fresh pairing fetch for this round if we don't
                            # yet have the missing-tables snapshot
                            if ov_round:
                                row = conn.execute(
                                    "SELECT missing_tables_json FROM round_timers "
                                    "WHERE tournament_id=? AND round=?",
                                    (tournament_id, ov_round)
                                ).fetchone()
                                if row and row[0] is None:
                                    cr_match = next(
                                        (c for c in carde_rounds if c.get("round_number") == ov_round),
                                        None
                                    )
                                    if cr_match and cr_match.get("id"):
                                        entry = {
                                            "round_num":      ov_round,
                                            "carde_round_id": cr_match["id"],
                                            "carde_status":   cr_match.get("status") or "",
                                            "snapshot":       True,
                                        }
                                        if not any(r["round_num"] == ov_round for r in rounds_to_fetch):
                                            rounds_to_fetch.append(entry)
                                            print(f"    round {ov_round}: queuing snapshot pairing fetch", flush=True)
                    except Exception as e:
                        print(f"    snapshot error: {e}", flush=True)

            if rounds_to_fetch:
                with _carde_lock:
                    if tournament_id not in _carde_running:
                        _carde_running.add(tournament_id)
                        t = threading.Thread(
                            target=_carde_worker,
                            args=(tournament_id, rounds_to_fetch),
                            daemon=True,
                        )
                        t.start()
                        print(f"    carde.io: {len(rounds_to_fetch)} rounds queued in background", flush=True)
                    else:
                        print(f"    carde.io: fetch already in progress, skipping", flush=True)
        else:
            # No carde event — fall back to Supabase tournament_time for current round
            if raw_tournament_time and current_round:
                started_at = raw_tournament_time[0].get("time") or ""
                if started_at:
                    db_upsert_round_timer(conn, tournament_id, current_round,
                                          carde_round_id=None, started_at=started_at,
                                          completed_at=None, timer_duration_minutes=None,
                                          carde_status=None)

        # Re-read full accumulated history
        all_drops    = db_read_drops(conn, tournament_id)
        raw_tl       = db_read_time_logs(conn, tournament_id)
        all_logs     = [
            {**row, "display_name": db_resolve_name(conn, row["user_id"])}
            for row in raw_tl
        ]
        all_penalties    = db_read_penalties(conn, tournament_id)
        all_time_updates = db_read_table_time_updates(conn, tournament_id)
        all_coverage = [
            {**row, "covered_by": db_resolve_name(conn, row["covered_by"])}
            for row in db_read_table_coverage(conn, tournament_id)
        ]
        all_judge_results = [
            {**row, "judge": db_resolve_name(conn, row["judge"])}
            for row in db_read_table_judge_results(conn, tournament_id)
        ]
        tournament_meta   = db_read_tournament_meta(conn, tournament_id)
        all_table_players = db_read_table_players(conn, tournament_id)
        all_round_pairings = db_read_round_pairings(conn, tournament_id)
        all_round_timers   = db_read_round_timers(conn, tournament_id)

    # Slim down live_status to only what the frontend needs
    live = {}
    if live_status:
        cr = live_status.get("current_round") or {}
        live = {
            "timer_end_datetime":       live_status.get("timer_end_datetime"),
            "timer_is_running":         live_status.get("timer_is_running"),
            "timer_paused_at_datetime": live_status.get("timer_paused_at_datetime"),
            "incomplete_matches":       live_status.get("number_of_incomplete_matches"),
            "lifecycle_status":         live_status.get("lifecycle_status"),
            "current_round_num":        cr.get("round_number"),
            "current_round_status":     cr.get("status"),
        }

    return {
        "drops":            all_drops,
        "time_logs":        all_logs,
        "penalties":        all_penalties,
        "time_updates":     all_time_updates,
        "coverage":         all_coverage,
        "judge_results":    all_judge_results,
        "tournament_info":  tournament_meta,
        "table_players":    all_table_players,
        "round_pairings":   all_round_pairings,
        "round_timers":     all_round_timers,
        "live_status":      live,
        "fetched": {
            "drops":          len(drops),
            "time_logs":      len(time_logs),
            "penalties":      len(penalties),
            "time_updates":   len(table_time_updates),
            "coverage":       len(table_coverage),
            "judge_results":  len(table_judge_results),
        },
    }



# ── Misc helpers ───────────────────────────────────────────────────────────────

def get_local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


def log(addr, msg, color=None):
    colors = {"green": "\033[92m", "yellow": "\033[93m", "red": "\033[91m",
              "cyan": "\033[96m", "reset": "\033[0m"}
    ts = datetime.now().strftime("%H:%M:%S")
    c = colors.get(color, "")
    r = colors["reset"] if color else ""
    sys.stdout.write(f"  {ts}  {addr:<15}  {c}{msg}{r}\n")
    sys.stdout.flush()


def decode_jwt_payload(token):
    try:
        parts = token.split(".")
        if len(parts) != 3:
            return {}
        decoded = base64.urlsafe_b64decode(parts[1] + "==")
        return json.loads(decoded)
    except Exception:
        return {}


def check_token_expiry():
    if not _state["token"] or not _state["token_exp"]:
        return False, 0
    remaining = _state["token_exp"] - datetime.now(timezone.utc).timestamp()
    return remaining > 0, max(0, int(remaining))


# ── HTTP handler ───────────────────────────────────────────────────────────────

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def log_message(self, format, *args):
        pass

    def _get_user(self):
        auth = self.headers.get("Authorization", "")
        if not auth.startswith("Bearer "):
            return None
        token = auth[7:]
        session = _sessions.get(token)
        if not session:
            return None
        if datetime.now(timezone.utc).timestamp() > session["exp"]:
            _sessions.pop(token, None)
            return None
        return session["username"]

    def _require_auth(self):
        user = self._get_user()
        if user is None:
            self.send_json(401, {"error": "Unauthorized"})
            return None
        return user

    def send_json(self, code, data):
        body = json.dumps(data).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers",
                         "Content-Type, Authorization, apikey, X-Requested-With")
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")

    def end_headers(self):
        self._cors()
        super().end_headers()

    def _client_ip(self):
        return (self.headers.get("X-Real-IP")
                or self.headers.get("X-Forwarded-For", "").split(",")[0].strip()
                or self.client_address[0])

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_POST(self):
        if self.path == "/api/login":
            self._login()
            return
        if self._require_auth() is None:
            return
        if self.path == "/api/set-token":
            self._set_token()
        elif self.path == "/api/activity":
            self._record_activity()
        else:
            self.send_json(404, {"error": "not found"})

    def do_GET(self):
        addr = self._client_ip()
        parsed = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(parsed.query)

        if parsed.path.startswith("/api/") or parsed.path == "/proxy":
            if self._require_auth() is None:
                return

        if parsed.path == "/api/logout":
            auth = self.headers.get("Authorization", "")
            if auth.startswith("Bearer "):
                _sessions.pop(auth[7:], None)
            self.send_json(200, {"ok": True})
            return

        if parsed.path == "/api/me":
            auth = self.headers.get("Authorization", "")
            token = auth[7:] if auth.startswith("Bearer ") else ""
            session = _sessions.get(token, {})
            username = session.get("username", "")
            self.send_json(200, {
                "username": username,
                "is_admin": username in ADMINS,
                "is_superadmin": username in SUPERADMINS,
            })
            return

        if parsed.path == "/proxy":
            self._proxy(addr, qs)
            return
        if parsed.path == "/api/sync":
            self._sync(addr, qs)
            return
        if parsed.path == "/api/logs":
            self._read_logs(addr, qs)
            return
        if parsed.path == "/api/schema":
            self._fetch_schema(addr)
            return
        if parsed.path == "/api/token-status":
            self._token_status()
            return
        if parsed.path == "/api/tournaments":
            with db_connect() as conn:
                ended = {
                    r[0] for r in conn.execute(
                        "SELECT tournament_id FROM tournament_meta WHERE is_ended=1"
                    ).fetchall()
                }
            self.send_json(200, [
                {"id": tid, "name": cfg["name"], "short": cfg["short"],
                 "ended": tid in ended}
                for tid, cfg in TOURNAMENTS.items()
            ])
            return
        if parsed.path == "/api/backfill":
            self._backfill(addr, qs)
            return
        if parsed.path == "/api/table-data":
            self._table_data(addr, qs)
            return
        if parsed.path == "/api/end-tournament":
            tid = (qs.get("tournamentId") or [None])[0]
            if not tid or tid not in TOURNAMENTS:
                self.send_json(400, {"error": "invalid tournamentId"})
                return
            with db_connect() as conn:
                conn.execute("""
                    INSERT INTO tournament_meta (tournament_id, is_ended)
                    VALUES (?, 1)
                    ON CONFLICT(tournament_id) DO UPDATE SET is_ended=1
                """, (tid,))
            log(addr, f"Tournament {tid[:8]} marked ended", "yellow")
            self.send_json(200, {"ok": True})
            return
        if parsed.path == "/api/clear-token":
            for k in ("token", "token_set_at", "token_set_by", "token_exp", "token_email"):
                _state[k] = None
            log(addr, "Token cleared", "yellow")
            self.send_json(200, {"ok": True})
            return

        if parsed.path == "/api/activity-log":
            user = self._get_user()
            if user not in SUPERADMINS:
                self.send_json(403, {"error": "Superadmin required"})
                return
            rows = db_read_activity()
            self.send_json(200, {"rows": rows})
            return

        log(addr, f"GET {self.path}")
        super().do_GET()

    # ── /api/sync ──────────────────────────────────────────────────────────────

    def _sync(self, addr, qs):
        tid = (qs.get("tournamentId") or qs.get("tournament_id") or [None])[0]
        if not tid:
            self.send_json(400, {"error": "tournamentId required"})
            return
        if not _state["token"]:
            self.send_json(401, {"error": "No token stored — paste your JWT in the Session tab."})
            return
        valid, _ = check_token_expiry()
        if not valid:
            self.send_json(401, {"error": "Token expired — paste a fresh one in the Session tab."})
            return

        log(addr, f"sync {tid[:8]}…", "cyan")
        try:
            result = fetch_and_store(tid)
            f = result["fetched"]
            log(addr, (
                f"sync ok: {f['drops']} drops, {f['time_logs']} time_logs, "
                f"{f['penalties']} penalties, {f['time_updates']} time_updates, "
                f"{f['coverage']} coverage, {f['judge_results']} judge_results"
            ), "green")
            self.send_json(200, {
                "ok": True,
                "synced_at":       datetime.now(timezone.utc).isoformat(),
                "fetched":         result["fetched"],
                "stored": {
                    "drops":          len(result["drops"]),
                    "time_logs":      len(result["time_logs"]),
                    "penalties":      len(result["penalties"]),
                    "time_updates":   len(result["time_updates"]),
                    "coverage":       len(result["coverage"]),
                    "judge_results":  len(result["judge_results"]),
                },
                "drops":           result["drops"],
                "time_logs":       result["time_logs"],
                "penalties":       result["penalties"],
                "time_updates":    result["time_updates"],
                "coverage":        result["coverage"],
                "judge_results":   result["judge_results"],
                "tournament_info": result["tournament_info"],
                "round_pairings":  result["round_pairings"],
                "round_timers":    result["round_timers"],
                "live_status":     result["live_status"],
            })
        except urllib.error.HTTPError as e:
            body = e.read().decode(errors="replace")
            log(addr, f"sync Supabase {e.code}: {body[:80]}", "red")
            self.send_json(e.code, {"error": f"Supabase {e.code}", "detail": body})
        except Exception as e:
            log(addr, f"sync error: {e}", "red")
            self.send_json(502, {"error": str(e)})

    # ── /api/logs ──────────────────────────────────────────────────────────────

    def _read_logs(self, addr, qs):
        tid = (qs.get("tournamentId") or qs.get("tournament_id") or [None])[0]
        if not tid:
            self.send_json(400, {"error": "tournamentId required"})
            return
        try:
            with db_connect() as conn:
                drops        = db_read_drops(conn, tid)
                raw_tl       = db_read_time_logs(conn, tid)
                time_logs    = [
                    {**row, "display_name": db_resolve_name(conn, row["user_id"])}
                    for row in raw_tl
                ]
                penalties     = db_read_penalties(conn, tid)
                time_updates  = db_read_table_time_updates(conn, tid)
                coverage = [
                    {**row, "covered_by": db_resolve_name(conn, row["covered_by"])}
                    for row in db_read_table_coverage(conn, tid)
                ]
                judge_results = [
                    {**row, "judge": db_resolve_name(conn, row["judge"])}
                    for row in db_read_table_judge_results(conn, tid)
                ]
                tournament_meta = db_read_tournament_meta(conn, tid)
                table_players   = db_read_table_players(conn, tid)
                round_pairings  = db_read_round_pairings(conn, tid)
                round_timers    = db_read_round_timers(conn, tid)
            log(addr, (
                f"read {tid[:8]}…: {len(drops)} drops, {len(time_logs)} time_logs, "
                f"{len(penalties)} penalties, {len(time_updates)} time_updates, "
                f"{len(coverage)} coverage, {len(judge_results)} judge_results"
            ), "cyan")
            self.send_json(200, {
                "drops":           drops,
                "time_logs":       time_logs,
                "penalties":       penalties,
                "time_updates":    time_updates,
                "coverage":        coverage,
                "judge_results":   judge_results,
                "tournament_info": tournament_meta,
                "table_players":   table_players,
                "round_pairings":  round_pairings,
                "round_timers":    round_timers,
                "live_status":     {},
            })
        except Exception as e:
            self.send_json(500, {"error": str(e)})

    # ── /api/table-data ────────────────────────────────────────────────────────

    def _table_data(self, addr, qs):
        user = self._get_user()
        if user not in ADMINS:
            self.send_json(403, {"error": "Admin required"})
            return
        ALLOWED = {
            "drops", "time_logs", "penalties", "table_time_updates",
            "table_coverage", "table_judge_results", "tournament_meta",
            "table_players", "round_pairings", "rounds_fetched",
            "round_timers", "users",
        }
        table = (qs.get("table") or [None])[0]
        if not table or table not in ALLOWED:
            self.send_json(400, {"error": f"Unknown table. Allowed: {sorted(ALLOWED)}"})
            return
        limit  = min(int((qs.get("limit")  or ["200"])[0]), 500)
        offset = int((qs.get("offset") or ["0"])[0])
        try:
            with db_connect() as conn:
                cols  = [r[1] for r in conn.execute(
                    f"PRAGMA table_info({table})").fetchall()]
                total = conn.execute(
                    f"SELECT COUNT(*) FROM {table}").fetchone()[0]
                rows  = [dict(r) for r in conn.execute(
                    f"SELECT * FROM {table} LIMIT ? OFFSET ?", (limit, offset)
                ).fetchall()]
            log(addr, f"table-data {table}: {len(rows)} rows (total {total})", "cyan")
            self.send_json(200, {
                "table": table, "columns": cols, "rows": rows,
                "total": total, "limit": limit, "offset": offset,
            })
        except Exception as e:
            self.send_json(500, {"error": str(e)})

    # ── /api/backfill ──────────────────────────────────────────────────────────

    def _backfill(self, addr, qs):
        """Re-fetch carde.io round data for all tournaments and fill missing timing fields."""
        tid_filter = (qs.get("tournamentId") or [None])[0]
        targets = (
            {tid_filter: TOURNAMENTS[tid_filter]}
            if tid_filter and tid_filter in TOURNAMENTS
            else TOURNAMENTS
        )
        results = {}
        for tid, cfg in targets.items():
            carde_event_id = cfg.get("carde_event_id")
            if not carde_event_id:
                results[tid] = {"error": "no carde_event_id"}
                continue
            try:
                carde_rounds = fetch_carde_all_rounds(carde_event_id)
                updated = 0
                with db_connect() as conn:
                    for cr in carde_rounds:
                        rnum = cr.get("round_number")
                        if not rnum:
                            continue
                        extra_sec = (cr.get("extra_time_seconds") or
                                     cr.get("additional_time_seconds") or 0)
                        ted = (cr.get("timer_end_datetime") or
                               _compute_timer_end(cr.get("started_at"),
                                                  cr.get("timer_duration_minutes"),
                                                  extra_sec))
                        db_upsert_round_timer(
                            conn, tid, rnum,
                            carde_round_id=cr.get("id"),
                            started_at=cr.get("started_at"),
                            completed_at=cr.get("completed_at"),
                            timer_duration_minutes=cr.get("timer_duration_minutes"),
                            carde_status=cr.get("status") or "",
                            timer_end_datetime=ted,
                            extra_time_seconds=extra_sec or None,
                        )
                        updated += 1
                log(addr, f"backfill {tid[:8]}: {updated} rounds updated", "green")
                results[tid] = {"rounds": updated, "name": cfg["name"]}
            except Exception as e:
                log(addr, f"backfill {tid[:8]} error: {e}", "red")
                results[tid] = {"error": str(e)}
        self.send_json(200, {"ok": True, "results": results})

    # ── /api/schema ────────────────────────────────────────────────────────────

    def _fetch_schema(self, addr):
        url = f"{SUPABASE_BASE}/"
        token = _state.get("token")
        log(addr, f"-> schema ({'jwt' if token else 'anon'})", "cyan")
        try:
            req = urllib.request.Request(url)
            req.add_header("apikey", SUPABASE_ANON_KEY)
            req.add_header("Accept", "application/json")
            req.add_header("User-Agent", "PurpleFox-Exporter/1.0")
            if token:
                req.add_header("Authorization", f"Bearer {token}")
            with urllib.request.urlopen(req, timeout=15) as resp:
                body = resp.read()
            log(addr, f"<- schema {len(body):,}b", "green")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self._cors()
            self.end_headers()
            self.wfile.write(body)
        except urllib.error.HTTPError as e:
            body = e.read()
            self.send_response(e.code)
            self.send_header("Content-Type", "application/json")
            self._cors()
            self.end_headers()
            self.wfile.write(body or json.dumps({"error": f"HTTP {e.code}"}).encode())
        except Exception as e:
            self.send_json(502, {"error": str(e)})

    # ── /api/login ─────────────────────────────────────────────────────────────

    def _login(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length))
            username = body.get("username", "").strip()
            password = body.get("password", "")
            if USERS.get(username) != password:
                self.send_json(401, {"error": "Invalid credentials"})
                return
            token = secrets.token_hex(16)
            exp = datetime.now(timezone.utc).timestamp() + 7 * 24 * 3600
            _sessions[token] = {"username": username, "exp": exp}
            ua = self.headers.get("User-Agent", "")[:512]
            db_log_activity("login", username, self._client_ip(), ua)
            log(self._client_ip(), f"Login: {username}", "green")
            self.send_json(200, {"ok": True, "token": token, "username": username,
                                 "is_admin": username in ADMINS,
                                 "is_superadmin": username in SUPERADMINS})
        except Exception as e:
            self.send_json(500, {"error": str(e)})

    # ── /api/activity ──────────────────────────────────────────────────────────

    def _record_activity(self):
        user = self._get_user()
        if user is None:
            self.send_json(401, {"error": "Unauthorized"})
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length))
            event_type = str(body.get("event_type", ""))[:64]
            detail = str(body.get("detail", ""))[:256]
            if not event_type:
                self.send_json(400, {"error": "event_type required"})
                return
            ua = self.headers.get("User-Agent", "")[:512]
            db_log_activity(event_type, user, self._client_ip(), ua, detail)
            self.send_json(200, {"ok": True})
        except Exception as e:
            self.send_json(500, {"error": str(e)})

    # ── /api/set-token ─────────────────────────────────────────────────────────

    def _set_token(self):
        addr = self._client_ip()
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length)
            data = json.loads(body)
            token = data.get("token", "").strip()
            if not token:
                self.send_json(400, {"error": "token field empty"})
                return

            payload = decode_jwt_payload(token)
            exp = payload.get("exp")
            email = payload.get("email", "unknown")

            if exp:
                now = datetime.now(timezone.utc).timestamp()
                if exp < now:
                    self.send_json(400, {
                        "error": "Token is already expired. Please log in to PurpleFox again and copy a fresh token."
                    })
                    return

            _state["token"] = token
            _state["token_set_at"] = datetime.now().isoformat()
            _state["token_set_by"] = addr
            _state["token_exp"] = exp
            _state["token_email"] = email

            # Seed our own name into the user cache from the JWT metadata
            user_sub = payload.get("sub", "")
            meta = payload.get("user_metadata", {})
            display = (
                meta.get("full_name") or
                meta.get("name") or
                email.split("@")[0]
            )
            if user_sub and display:
                try:
                    with db_connect() as conn:
                        db_upsert_users(conn, [(user_sub, display)])
                except Exception:
                    pass

            exp_str = datetime.fromtimestamp(exp).strftime("%H:%M:%S") if exp else "unknown"
            log(addr, f"Token stored for {email} / {display} (expires {exp_str})", "green")
            self.send_json(200, {"ok": True, "email": email, "exp": exp_str})
        except Exception as e:
            log(addr, f"set-token error: {e}", "red")
            self.send_json(500, {"error": str(e)})

    # ── /api/token-status ──────────────────────────────────────────────────────

    def _token_status(self):
        if not _state["token"]:
            self.send_json(200, {"set": False})
            return
        valid, remaining = check_token_expiry()
        self.send_json(200, {
            "set": True,
            "valid": valid,
            "remaining_seconds": remaining,
            "email": _state["token_email"],
            "set_by": _state["token_set_by"],
            "set_at": _state["token_set_at"],
            "exp_time": datetime.fromtimestamp(_state["token_exp"]).strftime("%H:%M:%S") if _state["token_exp"] else None,
        })

    # ── /proxy ─────────────────────────────────────────────────────────────────

    def _proxy(self, addr, qs):
        target = (qs.get("url") or [None])[0]
        if not target:
            self.send_json(400, {"error": "Missing ?url= parameter"})
            return

        target = urllib.parse.unquote(target)
        pt = urllib.parse.urlparse(target)
        if not pt.hostname or "upbcarvmkmyzhbosheyo.supabase.co" not in pt.hostname:
            log(addr, f"BLOCKED: {pt.hostname}", "red")
            self.send_json(403, {"error": "Proxy restricted to PurpleFox Supabase project"})
            return

        if not _state["token"]:
            self.send_json(401, {"error": "No JWT token stored."})
            return
        valid, _ = check_token_expiry()
        if not valid:
            self.send_json(401, {"error": "Token has expired."})
            return

        log(addr, f"-> {pt.path[:60]}", "cyan")
        try:
            req = urllib.request.Request(target)
            req.add_header("Authorization", f"Bearer {_state['token']}")
            req.add_header("apikey", SUPABASE_ANON_KEY)
            req.add_header("Accept", "application/json")
            req.add_header("Accept-Profile", "public")
            req.add_header("User-Agent", "PurpleFox-Exporter/1.0")
            with urllib.request.urlopen(req, timeout=15) as resp:
                status = resp.status
                ct = resp.headers.get("Content-Type", "application/json")
                body = resp.read()
            log(addr, f"<- {status} ({len(body):,}b)", "green")
            self.send_response(status)
            self.send_header("Content-Type", ct)
            self.send_header("Content-Length", str(len(body)))
            self._cors()
            self.end_headers()
            self.wfile.write(body)
        except urllib.error.HTTPError as e:
            body = e.read()
            log(addr, f"<- HTTP {e.code}", "red")
            self.send_response(e.code)
            self.send_header("Content-Type", "application/json")
            self._cors()
            self.end_headers()
            self.wfile.write(body or json.dumps({"error": f"Supabase {e.code}"}).encode())
        except Exception as e:
            log(addr, f"Proxy error: {e}", "red")
            self.send_json(502, {"error": str(e)})


# ── Entry point ────────────────────────────────────────────────────────────────

def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    db_init()

    local_ip = get_local_ip()
    socketserver.ThreadingTCPServer.allow_reuse_address = True

    with socketserver.ThreadingTCPServer(("0.0.0.0", PORT), Handler) as httpd:
        print()
        print("  +--------------------------------------------------------+")
        print("  |   PurpleFox - Action Log Exporter                      |")
        print("  +--------------------------------------------------------+")
        print(f"  |   Local:    http://localhost:{PORT}                     |")
        print(f"  |   Network:  http://{local_ip}:{PORT}                     |")
        print(f"  |   DB:       {os.path.basename(DB_PATH):<44}|")
        print("  +--------------------------------------------------------+")
        print()
        print("  Requests:")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n\n  Server stopped.")


if __name__ == "__main__":
    main()
