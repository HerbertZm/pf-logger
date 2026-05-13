import sqlite3, json

DB = r"C:\Users\herbo\Documents\code\pf-loggger\action_logs.db"
conn = sqlite3.connect(DB)
conn.row_factory = sqlite3.Row

tables = [t[0] for t in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
print("Tables:", tables)
for t in tables:
    c = conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
    print(f"  {t}: {c} rows")
    if c > 0:
        row = conn.execute(f"SELECT * FROM {t} LIMIT 1").fetchone()
        print(f"    sample: {dict(row)}")
