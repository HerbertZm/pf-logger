# Deployment Guide — pf-logger

Deploy on a VPS with nginx reverse proxy + Let's Encrypt TLS.

**Stack:** Node.js 20 LTS, PostgreSQL 16, nginx, systemd, GitHub Actions for CI/CD.

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

# Node.js 20 LTS (via NodeSource)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# PostgreSQL 16
sudo apt install -y postgresql postgresql-contrib

# Other tools
sudo apt install -y nginx certbot python3-certbot-nginx ufw git
```

Verify versions:

```bash
node -v    # should print v20.x.x
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
PF_PASSWORD_PEPPER=...
PORT=8080
NODE_ENV=production
```

`.env` is gitignored — it never leaves the server. Reference `.env.example` in the repo for the full list of required variables.

---

## Step 6 — Run Prisma migrations and build

```bash
cd /opt/pf-logger

# Apply database schema
sudo -u deploy npx prisma migrate deploy

# Build the TypeScript API + React frontend
sudo -u deploy npm run build
```

`npm run build` compiles the Express API to `dist/server.js` and builds the React app to `client/dist/`. Express serves `client/dist/` as static files with a SPA fallback.

---

## Step 7 — systemd service

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

## Step 8 — nginx reverse proxy

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

## Step 9 — TLS certificate

```bash
sudo certbot --nginx -d analysis.heidy.tools
```

Certbot validates the domain, issues a Let's Encrypt cert, and rewrites the nginx config to redirect HTTP → HTTPS on port 443.

Test auto-renewal:

```bash
sudo certbot renew --dry-run
```

---

## Step 10 — Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'   # ports 80 and 443
sudo ufw enable
sudo ufw status
```

Port 8080 must **not** be in the allow list — nginx proxies to it internally.

---

## Step 11 — Verify

```bash
curl -I https://analysis.heidy.tools/api/me
# Expected: HTTP/2 401

curl https://analysis.heidy.tools/api/health
# Expected: JSON with uptime, DB status, worker status
```

Open `https://analysis.heidy.tools` in a browser — login modal over HTTPS.

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
npm ci --omit=dev
npx prisma migrate deploy
npm run build
sudo systemctl restart pf-logger
```

`npm ci --omit=dev` installs only production dependencies. Prisma migrations are applied before the build — if a migration fails, the restart is skipped and the old version stays running.

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
npm ci --omit=dev
npx prisma migrate deploy
npm run build
sudo systemctl restart pf-logger
sudo journalctl -u pf-logger -f   # watch logs to confirm clean start
```

---

## Database backups

The admin API exposes `GET /api/admin/backup` which streams a `pg_dump` of the PostgreSQL database. This is accessible only to superadmin users.

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
