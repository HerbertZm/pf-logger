"""Quick test: fetch new tables from Supabase using a stored token."""
import sqlite3, json, sys
sys.path.insert(0, r"C:\Users\herbo\Documents\code\pf-loggger")
import serve

DB = serve.DB_PATH
conn = sqlite3.connect(DB)
conn.row_factory = sqlite3.Row
token_row = None

# Read token from DB? No — token is in _state (memory). Need to set it manually.
# Check if there's a token in the running server by hitting the status endpoint.
import urllib.request, json

try:
    r = urllib.request.urlopen("http://localhost:8765/api/token-status", timeout=5)
    status = json.loads(r.read())
    print("Token status:", status)
except Exception as e:
    print("Server not reachable:", e)

# Try hitting sync directly
try:
    r = urllib.request.urlopen(
        "http://localhost:8765/api/sync?tournamentId=4ac50cb1-f6ad-4507-94a1-6aee88b2cb7e",
        timeout=30
    )
    d = json.loads(r.read())
    print("Sync result keys:", list(d.keys()))
    print("Fetched:", d.get("fetched"))
    print("Stored:", d.get("stored"))
    print("Penalties:", len(d.get("penalties", [])))
    print("Time updates:", len(d.get("time_updates", [])))
    print("Coverage:", len(d.get("coverage", [])))
    print("Judge results:", len(d.get("judge_results", [])))
except Exception as e:
    print("Sync error:", e)
