# Deployment Guide — pf-logger

---

## Local Development Setup (Windows)

### 1 — Install PostgreSQL

**Option A — winget (recommended):**
```powershell
winget install PostgreSQL.PostgreSQL
```

**Option B — installer:** download from [postgresql.org/download/windows](https://www.postgresql.org/download/windows/), run it with defaults, uncheck Stack Builder.

After install, set the `postgres` superuser password if you used winget:
```powershell
& "C:\Program Files\PostgreSQL\17\bin\psql.exe" -U postgres
# at the prompt:
\password postgres
\q
```

Verify `psql` is on your PATH (open a new terminal):
```powershell
psql --version
```

If not found, add `C:\Program Files\PostgreSQL\17\bin` to your user `PATH` in System → Advanced → Environment Variables.

### 2 — Create the database

```powershell
psql -U postgres -c "CREATE DATABASE pf_logger;"
psql -U postgres -c "CREATE USER pf_logger_user WITH PASSWORD 'yourpassword';"
psql -U postgres -c "GRANT ALL PRIVILEGES ON DATABASE pf_logger TO pf_logger_user;"
psql -U postgres -c "ALTER DATABASE pf_logger OWNER TO pf_logger_user;"
```

### 3 — Configure `.env`

Copy `.env.example` to `.env` (gitignored) and fill in your values:

```
DATABASE_URL=postgresql://pf_logger_user:yourpassword@localhost:5432/pf_logger
CARDE_API_TOKEN=your_carde_api_token_here
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_supabase_anon_key_here
PF_PASSWORD_PEPPER=a_long_random_string
PORT=8080
NODE_ENV=development
```

### 4 — Install dependencies and initialize the schema

```powershell
npm install
# postinstall runs db:generate automatically — Prisma 7 generates TypeScript
# client files to src/generated/prisma/ (gitignored; must exist before starting)
npm run db:migrate    # creates and applies migrations
```

**If `prisma migrate` times out (P1002 advisory lock):** stop `npm run dev` first, then run `npx prisma migrate deploy`. While the API is still running you can apply pending folders with:

```powershell
npm run db:apply-pending
```

That script discovers **all** folders under `src/db/migrations/*/migration.sql`, applies any not yet recorded in `_prisma_migrations`, and skips the rest. Preview pending work with:

```powershell
node scripts/apply-pending-migrations.cjs --dry-run
```

> **Warning:** Unlike `prisma migrate deploy`, `db:apply-pending` does **not** wrap each migration in a transaction. If a migration contains multiple statements and fails mid-way, the schema may be left in a partial state while the migration is recorded as applied. Use this script only as a last resort when `prisma migrate deploy` is blocked by a P1002 lock. Always prefer `npx prisma migrate deploy` on the VPS.

On the VPS, prefer `npx prisma migrate deploy` when nothing holds the DB lock (see [Timestamps and post-deploy data refresh](#timestamps-utc-storage-and-display) for when to re-sync after deploy).

### 5 — Start the dev server

```powershell
npm run dev
```

This runs two processes:

1. **API** — `ts-node-dev` on `PORT` from `.env` (default **8080**). Wait until you see `pf-logger running on port …` in the `[api]` log line.
2. **Client** — Vite starts only after the API accepts TCP on that port (`wait-on`), then serves the React app (default **5173**; Vite picks the next free port if 5173 is busy — check the `[web]` log for `Local:`).

Open the Vite URL in the browser (not `:8080` directly in dev). All `/api/*` requests proxy to Express. The Vite config reads `PORT` from the **repo root** `.env` so the proxy target always matches the API.

**If you see `ECONNREFUSED` on `/api/*`:** the API is not listening yet (still compiling) or `PORT` in `.env` does not match what you expect. Do not run `vite client` alone without the API.

**Scripts:** `npm run dev:api` (API only) · `node scripts/start-client.cjs` (wait + Vite only, after API is up).

---

## Local Development Setup (Ubuntu/Linux)

### 1 — Install Node.js 22 LTS

Ubuntu's default `apt` packages are too old. Use NodeSource:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # should print v22.x.x
npm -v
```

### 2 — Install PostgreSQL

```bash
sudo apt update
sudo apt install -y postgresql postgresql-contrib
sudo systemctl enable postgresql
sudo systemctl start postgresql
psql --version
```

### 3 — Create the database

```bash
sudo -u postgres psql -c "CREATE DATABASE pf_logger;"
sudo -u postgres psql -c "CREATE USER pf_logger_user WITH PASSWORD 'yourpassword';"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE pf_logger TO pf_logger_user;"
sudo -u postgres psql -c "ALTER DATABASE pf_logger OWNER TO pf_logger_user;"
```

Verify the connection:

```bash
psql postgresql://pf_logger_user:yourpassword@localhost:5432/pf_logger -c "SELECT 1;"
```

### 4 — Install Git and clone the repo

```bash
sudo apt install -y git
git clone https://github.com/YOUR_ORG/pf-logger.git ~/pf-logger
cd ~/pf-logger
```

### 5 — Configure `.env`

```bash
cp .env.example .env
nano .env
```

Fill in your values:

```
DATABASE_URL=postgresql://pf_logger_user:yourpassword@localhost:5432/pf_logger
CARDE_API_TOKEN=your_carde_api_token_here
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_supabase_anon_key_here
PF_PASSWORD_PEPPER=a_long_random_string
PORT=8080
NODE_ENV=development
```

### 6 — Install dependencies and initialize the schema

```bash
npm install
# postinstall runs db:generate automatically (Prisma 7 — generates client to src/generated/prisma/)
npm run db:migrate    # creates and applies migrations
```

### 7 — Start the dev server

```bash
npm run dev
```

Same as Windows (see §5 above): API on `PORT` (default 8080), Vite after `wait-on`, browser on the Vite `Local:` URL. Proxy uses repo-root `.env` `PORT`.

---

## Production Deployment (VPS)

Deploy on a VPS with nginx reverse proxy + Let's Encrypt TLS.

**Stack:** Node.js 22 LTS, PostgreSQL 16, nginx, systemd, GitHub Actions for CI/CD.

**Assumptions:** Ubuntu 22.04/24.04, root or sudo access, DNS for `analysis.heidy.tools` managed somewhere you can add records.

---

## Step 1 — DNS

Add an **A record** in your DNS provider:

```
analysis.heidy.tools  →  <your VPS IP>   TTL 300
```

Propagation takes a few minutes to an hour. Check with `dig analysis.heidy.tools`.

---

## Step 2 — Install dependencies

```bash
sudo apt update && sudo apt upgrade -y

# Node.js 22 LTS (via NodeSource)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# PostgreSQL 16
sudo apt install -y postgresql postgresql-contrib

# Other tools
sudo apt install -y nginx certbot python3-certbot-nginx ufw git
```

Verify versions:

```bash
node -v    # should print v22.x.x
npm -v
psql --version
```

---

## Step 3 — PostgreSQL setup

```bash
sudo -u postgres psql
```

Inside psql:

```sql
CREATE USER pflogger WITH PASSWORD 'your_strong_password_here';
CREATE DATABASE pflogger OWNER pflogger;
\q
```

Test the connection:

```bash
psql postgresql://pflogger:your_strong_password_here@localhost/pflogger -c "SELECT 1;"
```

---

## Step 4 — Create a deploy user

Run the app as a dedicated non-root user. Do not run as `www-data` or `root`.

```bash
sudo useradd -m -s /bin/bash deploy
sudo mkdir -p /opt/pf-logger
sudo chown deploy:deploy /opt/pf-logger
```

---

## Step 5 — Clone the repo and configure

```bash
sudo -u deploy git clone https://github.com/YOUR_ORG/pf-logger.git /opt/pf-logger
cd /opt/pf-logger
sudo -u deploy npm ci
```

Create the environment file:

```bash
sudo -u deploy nano /opt/pf-logger/.env
```

Paste and fill in all values:

```
DATABASE_URL=postgresql://pflogger:your_strong_password_here@localhost/pflogger
CARDE_API_TOKEN=...
SUPABASE_URL=https://upbcarvmkmyzhbosheyo.supabase.co
SUPABASE_ANON_KEY=...
PF_PASSWORD_PEPPER=...
PORT=8080
NODE_ENV=production
```

`.env` is gitignored — it never leaves the server. Reference `.env.example` in the repo for the full list of required variables.

---

## Step 6 — Generate Prisma client, run migrations, and build

```bash
cd /opt/pf-logger

# Generate the Prisma client (Prisma 7 — outputs TS files to src/generated/prisma/, gitignored)
# postinstall does this automatically after npm ci, but run explicitly to be sure
sudo -u deploy npm run db:generate

# Apply database schema migrations (see Timestamps section if migrate lock fails)
sudo -u deploy npx prisma migrate deploy
# P1002 while dev tools hold the DB: sudo -u deploy npm run db:apply-pending

# Build the TypeScript API + React frontend
sudo -u deploy npm run build
```

`npm run build` compiles the Express API to `dist/server.js` and builds the React app to `dist/client/`. Express serves `dist/client/` as static files with a SPA fallback.

> **Prisma 7 note:** `src/generated/prisma/` is gitignored — it must be (re)generated after every install or schema change. `postinstall` runs `prisma generate` automatically, so `npm install` handles this. Run `npm run db:generate` explicitly if you ever install without scripts (e.g. `--ignore-scripts`).

---

## Step 7 — Seed the first superadmin user

```bash
cd /opt/pf-logger
sudo -u deploy npm run db:seed
```

This creates username `admin` with password `changeme` and role `superadmin`. **Change the password immediately after first login** via the Manage tab → Users.

---

## Step 8 — systemd service

```bash
sudo nano /etc/systemd/system/pf-logger.service
```

Paste:

```ini
[Unit]
Description=pf-logger tournament dashboard
After=network.target postgresql.service

[Service]
Type=simple
User=deploy
WorkingDirectory=/opt/pf-logger
EnvironmentFile=/opt/pf-logger/.env
ExecStart=/usr/bin/node dist/server.js
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable pf-logger
sudo systemctl start pf-logger
sudo systemctl status pf-logger   # should show "active (running)"
```

View logs:

```bash
sudo journalctl -u pf-logger -f
```

---

## Step 9 — nginx reverse proxy

```bash
sudo nano /etc/nginx/sites-available/analysis.heidy.tools
```

Paste:

```nginx
server {
    listen 80;
    server_name analysis.heidy.tools;

    # Rate-limit the login endpoint
    location /api/login {
        limit_req zone=login burst=3 nodelay;
        proxy_pass http://127.0.0.1:8080;
    }

    # Everything else → Express (which serves API + built React app)
    location / {
        proxy_pass         http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }
}
```

Add the rate-limit zone to the `http {}` block in `/etc/nginx/nginx.conf`:

```nginx
limit_req_zone $binary_remote_addr zone=login:10m rate=5r/m;
```

Enable the site:

```bash
sudo ln -s /etc/nginx/sites-available/analysis.heidy.tools /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

---

## Step 10 — TLS certificate

```bash
sudo certbot --nginx -d analysis.heidy.tools
```

Certbot validates the domain, issues a Let's Encrypt cert, and rewrites the nginx config to redirect HTTP → HTTPS on port 443.

Test auto-renewal:

```bash
sudo certbot renew --dry-run
```

---

## Step 11 — Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'   # ports 80 and 443
sudo ufw enable
sudo ufw status
```

Port 8080 must **not** be in the allow list — nginx proxies to it internally.

---

## Step 12 — Verify

```bash
curl -I https://analysis.heidy.tools/api/me
# Expected: HTTP/2 401

curl https://analysis.heidy.tools/api/health
# Expected: { ok, uptime, db } — public liveness only

# Full worker/JWT checklist (superadmin, authenticated):
# GET /api/admin/health
```

Open `https://analysis.heidy.tools` in a browser — login modal over HTTPS.

If this deploy includes UTC ingestion/display changes, follow [Timestamps (UTC storage and display)](#timestamps-utc-storage-and-display) — restart, PF JWT, per-tournament sync, then checklist.

---

## Step 13 — Import legacy data (first deploy only)

If you have historical data from the Python/SQLite app, import it now.

**On your local machine** (where `action_logs.db` lives):
```bash
npm run db:export-legacy
# Writes legacy-export.json to the project root
```

**Upload to the server:**
```bash
# Get a token first — log in as admin
TOKEN=$(curl -s -X POST https://analysis.heidy.tools/api/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"changeme"}' | python3 -m json.tool | grep '"token"' | cut -d'"' -f4)

# Run the import
curl -X POST https://analysis.heidy.tools/api/admin/import \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d @legacy-export.json
```

The import is idempotent — safe to re-run if it's interrupted. The response shows exactly how many rows were created vs skipped:

```json
{
  "created": { "tournaments": 2, "rounds": 22, "drops": 696, "penalties": 246, "extensions": 824, ... },
  "skipped": { "tournaments": 0, "rounds": 0, ... },
  "totalsInExport": { "tournaments": 2, "rounds": 22, ... }
}
```

`created.*` should match `totalsInExport.*` on a clean first run. Non-zero `skipped.*` on a re-run is expected and safe.

Skip this step if starting fresh with no legacy data.

---

## CI/CD setup (GitHub Actions)

After the initial manual deploy above, all subsequent deployments happen automatically on push to `main`. Setup is a one-time operation per repo.

### Generate a deployment SSH key pair

Do this on your **local machine** — the private key goes to GitHub, the public key goes to the VPS:

```bash
ssh-keygen -t ed25519 -C "pf-logger-deploy" -f ~/.ssh/pf_logger_deploy
# Passphrase: leave empty (Actions can't enter it interactively)
```

This produces:
- `~/.ssh/pf_logger_deploy` — private key (goes to GitHub)
- `~/.ssh/pf_logger_deploy.pub` — public key (goes to VPS)

### Authorize the key on the VPS

```bash
# Copy the public key to the deploy user on the VPS
ssh-copy-id -i ~/.ssh/pf_logger_deploy.pub deploy@<VPS-IP>

# Or manually: append the .pub contents to /home/deploy/.ssh/authorized_keys
```

Test it works before wiring up GitHub:

```bash
ssh -i ~/.ssh/pf_logger_deploy deploy@<VPS-IP> "echo OK"
# Should print: OK
```

### Add secrets to GitHub

In the repo, go to **Settings → Secrets and variables → Actions → New repository secret** and add:

| Secret name | Value |
|---|---|
| `VPS_HOST` | VPS IP address or hostname |
| `VPS_USER` | `deploy` |
| `VPS_SSH_KEY` | Contents of `~/.ssh/pf_logger_deploy` (the private key, including the `-----BEGIN...` header and footer) |

### GitHub Actions workflow

The workflow file lives at `.github/workflows/deploy.yml` in the repo. On every push to `main` it:

1. Type-checks and lints both the API and React app
2. Runs a production build
3. SSHs to the VPS, pulls the latest code, migrates the DB, rebuilds, and restarts the service

A failed type-check or build aborts the pipeline — a broken build never reaches the server.

See `plans/phase-1.md` — section 1.4 for the full workflow YAML and required `package.json` scripts.

### What the deploy step does on the VPS

```bash
cd /opt/pf-logger
git pull origin main
npm install --no-audit --no-fund   # includes devDeps needed for tsc build
npm run db:generate                # Prisma 7: regenerate client (postinstall handles this, but explicit is safe)
npx prisma migrate deploy          # e.g. games table + game_id on tournaments (2026-06-01+)
npm run build
sudo systemctl restart pf-logger
```

`npm install` is used instead of `npm ci --omit=dev` because the build step (`tsc`) requires devDependencies (`@types/*`, TypeScript). Prisma migrations are applied before the build — if a migration fails, the restart is skipped and the old version stays running.

If `npx prisma migrate deploy` fails with **P1002** (advisory lock — usually another `prisma` or dev server connection), stop competing processes and retry, or run `npm run db:apply-pending` on the VPS as the `deploy` user (same `DATABASE_URL` in `.env`).

### Allowing deploy to restart the service without a password

The `systemctl restart pf-logger` command requires sudo. Grant the deploy user passwordless permission for that one command only:

```bash
sudo visudo -f /etc/sudoers.d/pf-logger-deploy
```

Add this single line:

```
deploy ALL=(ALL) NOPASSWD: /bin/systemctl restart pf-logger
```

---

## Manual deployment (no CI/CD)

If you need to deploy manually outside of the CI/CD flow:

```bash
ssh deploy@<VPS-IP>
cd /opt/pf-logger
git pull origin main
npm install --no-audit --no-fund   # includes devDeps needed for tsc build
npm run db:generate                # Prisma 7: regenerate client after install
npx prisma migrate deploy          # or: npm run db:apply-pending if P1002 lock
npm run build
sudo systemctl restart pf-logger
sudo journalctl -u pf-logger -f    # watch logs to confirm clean start
```

After deploy, complete the [timestamp refresh](#timestamps-utc-storage-and-display) steps if this release changes ingestion or display timezone handling.

---

## Timestamps (UTC storage and display)

### Model

| Layer | Rule |
|-------|------|
| **PostgreSQL** | Every timestamp column is `TIMESTAMPTZ` — stored as UTC. |
| **Ingestion** | `src/utils/datetime.ts`: Carde strings → `parseCardeTimestamp(..., tournament.timezone)`; PurpleFox naive strings → `parsePfTimestamp` (UTC). |
| **API JSON** | `Date.toISOString()` only — always ends with `Z` (UTC). |
| **UI** | Convert at render time only: `formatInTournamentTz` (logs, dashboard, schedule, reports) using `tournament.timezone`; `formatUtc` / columns labeled **(UTC)** on Manage (users, sessions, audit). |

Set each tournament’s **IANA timezone** correctly in Manage (or inherit from the linked event) before trusting wall-clock labels. Naive Carde timestamps without a `Z` or offset are interpreted as wall time in that zone.

### After a deploy that changes timestamp parsing

Existing normalized rows are **not** rewritten by migrations alone. Refresh from the sources:

1. **Restart** the API (`sudo systemctl restart pf-logger`) so ingestion code and health endpoints match the build.
2. **Paste PF JWT** in Session if the server restarted (`inMemory: false` until set).
3. For each **active** tournament, run **Manage → Tools → Sync** (or `POST /api/sync` as admin+). That re-fetches Carde/PF and re-parses timestamps into UTC.
4. Optional: **Backfill** (`POST /api/backfill`) only rebuilds normalized rows from **raw** tables already in the DB — use sync first if raw timestamps were wrong at capture time.
5. Confirm **Manage → Pre-event checklist** (`GET /api/admin/health`) and spot-check log times against the context-bar timezone hint.

### Verify

```bash
# Public liveness (no auth)
curl -fsS https://analysis.heidy.tools/api/health
# → {"ok":true,"uptime":...,"db":"ok"}

# Log in in the browser; open Manage → Pre-event checklist (uses /api/admin/health)
```

---

## Database backups

> **Note:** `GET /api/admin/backup` is not yet implemented (planned for Phase 3). Use the cron job below in the meantime.

For scheduled backups, add a cron job on the VPS:

```bash
sudo crontab -u deploy -e
```

```cron
0 3 * * * pg_dump -U pflogger pflogger | gzip > /opt/pf-logger/backups/$(date +\%Y-\%m-\%d).sql.gz
```

Keep the `backups/` directory gitignored.

---

## Updating environment variables

Environment variables live in `/opt/pf-logger/.env` on the VPS. After changing any value:

```bash
sudo systemctl restart pf-logger
```

The service reads `.env` on startup via the `EnvironmentFile=` directive in the systemd unit. No rebuild needed for env-only changes.

---

## Before going live — security checklist

- [ ] All secrets in `.env` — no hardcoded values anywhere in the codebase
- [ ] `PF_PASSWORD_PEPPER` is random and stored nowhere except `.env`
- [ ] Default admin password changed on first login
- [ ] Firewall active: only ports 22, 80, 443 open
- [ ] Port 8080 not exposed externally (nginx proxies internally)
- [ ] SSH key auth only — password auth disabled in `/etc/ssh/sshd_config` (`PasswordAuthentication no`)
- [ ] Certbot auto-renewal working (`sudo certbot renew --dry-run`)
- [ ] PostgreSQL not accepting external connections (default behavior — listens on localhost only)
