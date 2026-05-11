# Deployment Guide — analysis.heidy.tools

Deploy on a VPS with nginx reverse proxy + Let's Encrypt TLS.

**Assumptions:** Ubuntu 22.04/24.04, root or sudo access, `heidy.tools` DNS managed somewhere you can add records.

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
sudo apt install -y python3 python3-pip nginx certbot python3-certbot-nginx ufw git
```

The app uses only Python stdlib — no pip packages needed.

---

## Step 3 — Copy the app and database to the server

**Copy everything including the database in one shot** — this preserves all your existing data:

```bash
scp -r /path/to/pf-loggger user@<VPS-IP>:/opt/pf-loggger
```

This transfers `serve.py`, `index.html`, and critically `action_logs.db` (your existing SQLite database with all drops, penalties, timing data, etc.) to the server. Do not skip the database or copy the code separately without it.

If you use git to manage the code (and therefore can't commit the DB), transfer the database separately after cloning:

```bash
# Clone code
git clone <your-repo> /opt/pf-loggger   # run this ON the server

# Then from your LOCAL machine, copy just the database
scp /path/to/pf-loggger/action_logs.db user@<VPS-IP>:/opt/pf-loggger/action_logs.db
```

Verify it arrived and looks right:

```bash
# On the server
ls -lh /opt/pf-loggger/action_logs.db    # should show the file size you expect
sqlite3 /opt/pf-loggger/action_logs.db "SELECT COUNT(*) FROM drops;"
```

If `sqlite3` isn't installed: `sudo apt install -y sqlite3`.

Set ownership so the service user can read and write the database:

```bash
sudo chown -R www-data:www-data /opt/pf-loggger
```

---

## Step 4 — Create a systemd service

```bash
sudo nano /etc/systemd/system/pf-loggger.service
```

Paste:

```ini
[Unit]
Description=PurpleFox Action Log Exporter
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/pf-loggger
ExecStart=/usr/bin/python3 serve.py
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
sudo systemctl enable pf-loggger
sudo systemctl start pf-loggger
sudo systemctl status pf-loggger   # should show "active (running)"
```

View logs any time:

```bash
sudo journalctl -u pf-loggger -f
```

---

## Step 5 — Configure nginx as reverse proxy

```bash
sudo nano /etc/nginx/sites-available/analysis.heidy.tools
```

Paste:

```nginx
server {
    listen 80;
    server_name analysis.heidy.tools;

    location /api/login {
        limit_req zone=login burst=3 nodelay;
        proxy_pass http://127.0.0.1:8765;
    }

    location / {
        proxy_pass         http://127.0.0.1:8765;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }
}
```

Also add the rate-limit zone to the http block in `/etc/nginx/nginx.conf` (inside `http { ... }`):

```nginx
limit_req_zone $binary_remote_addr zone=login:10m rate=5r/m;
```

Enable the site:

```bash
sudo ln -s /etc/nginx/sites-available/analysis.heidy.tools /etc/nginx/sites-enabled/
sudo nginx -t          # should print "syntax is ok"
sudo systemctl reload nginx
```

---

## Step 6 — TLS certificate (HTTPS)

```bash
sudo certbot --nginx -d analysis.heidy.tools
```

Certbot verifies domain ownership, obtains a Let's Encrypt cert, and rewrites the nginx config to redirect HTTP → HTTPS and serve on port 443.

Test auto-renewal:

```bash
sudo certbot renew --dry-run
```

---

## Step 7 — Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'    # ports 80 and 443
sudo ufw enable
sudo ufw status
```

Port 8765 should **not** be in the allow list — nginx proxies to it internally.

---

## Step 8 — Verify

```bash
curl -I https://analysis.heidy.tools/api/me
# Expected: HTTP/2 401
```

Open `https://analysis.heidy.tools` in a browser — login modal over HTTPS.

---

## Before going live — security checklist

- [ ] Change default passwords (`admin/admin` and `hj/hj`) to something strong
- [ ] Move `USERS`, `ADMINS`, `CARDE_API_TOKEN`, and `SUPABASE_ANON_KEY` out of `serve.py` into environment variables; set them in the systemd unit with `Environment=` lines:
  ```ini
  Environment="CARDE_API_TOKEN=your_token_here"
  Environment="ADMIN_PASSWORD=strongpassword"
  ```
  Then read them in `serve.py` via `os.environ.get(...)`.
- [ ] Restrict nginx access by IP if this is internal-team-only (negates need for strong passwords entirely):
  ```nginx
  allow 1.2.3.4;   # your IP
  deny all;
  ```
