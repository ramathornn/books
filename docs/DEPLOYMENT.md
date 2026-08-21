# Self-hosting Books — zero-to-deployed guide

A painstaking, copy-paste-friendly walkthrough for standing up your **own** production
instance of this app on a fresh cloud server, with your own domain and HTTPS — even if
you've never deployed a web app before.

It uses **DigitalOcean** as the primary example (simplest), with **AWS EC2** notes where
they differ, and an optional **Cloudflare** section. Every command runs as plain shell;
nothing here is specific to the original author's infrastructure.

> **What you'll end up with:** the app running 24/7 on a server you control, reachable at
> `https://your-domain.com`, behind a reverse proxy with an auto-renewing TLS certificate,
> a firewall, and SSH-key-only login.

**Replace these placeholders throughout:**

| Placeholder | Meaning |
|---|---|
| `your-domain.com` | the domain you'll point at the app |
| `YOUR_SERVER_IP` | your server's public IPv4 address |
| `you@example.com` | your email (for the TLS cert + admin login) |

---

## 0. What it costs & what you need

**Roughly $6–12/month** for a small server, plus ~$10–15/year for a domain. Everything
else below (Cloudflare, Let's Encrypt) has a free tier that's plenty.

Create accounts ahead of time (all optional except the first two):

1. **A domain registrar** — Namecheap, Cloudflare Registrar, Porkbun, Google Domains, etc.
2. **A cloud provider** — [DigitalOcean](https://www.digitalocean.com/) or AWS.
3. *(Optional)* **Cloudflare** — free CDN/DNS/DDoS protection in front of your server.
4. *(Optional)* **Stripe** — to accept card payments on invoices.
5. *(Optional)* **Mailgun** — to send invoice/estimate emails.
6. *(Optional)* **Anthropic** — for AI receipt OCR ("scan a receipt").
7. *(Optional)* **Plaid** — to auto-pull bank transactions (CSV import works without it).

The app runs fine with **none** of the optional services — they just unlock those features.

---

## 1. Buy a domain

In your registrar, search for and buy a domain (e.g. `your-domain.com`). That's it for now —
we'll point its DNS at the server in Step 4, once the server exists.

---

## 2. Create the server

You want **Ubuntu 24.04 LTS**, at least **2 GB RAM** (the production build is memory-hungry;
1 GB will OOM during `next build` unless you add swap — see Troubleshooting).

### DigitalOcean (recommended)

1. **Create → Droplets**.
2. Region: pick one near you/your users.
3. Image: **Ubuntu 24.04 (LTS) x64**.
4. Size: **Basic → Regular → 2 GB / 1 CPU** ($12/mo) is comfortable. The $6 (1 GB) plan
   works if you add swap.
5. Authentication: **SSH key** (strongly preferred over password). If you don't have one:
   ```bash
   # on your laptop
   ssh-keygen -t ed25519 -C "you@example.com"
   cat ~/.ssh/id_ed25519.pub      # paste this into DigitalOcean's "New SSH Key" box
   ```
6. Create the droplet. Copy its **public IPv4** — that's `YOUR_SERVER_IP`.

### AWS EC2 (alternative)

1. Launch an instance, AMI **Ubuntu Server 24.04 LTS**, type **t3.small** (2 GB).
2. Create/download a key pair (`.pem`); you'll SSH with `-i your-key.pem`.
3. **Security Group inbound rules:** allow `22` (SSH, ideally from your IP only), `80`
   (HTTP), `443` (HTTPS).
4. Allocate an **Elastic IP** and associate it so the address survives reboots — that's
   `YOUR_SERVER_IP`.

---

## 3. First login & lock the box down

SSH in (DigitalOcean logs you in as `root`; AWS as `ubuntu`):

```bash
ssh root@YOUR_SERVER_IP            # DigitalOcean
# ssh -i your-key.pem ubuntu@YOUR_SERVER_IP   # AWS
```

### 3a. Create a non-root user (skip on AWS — `ubuntu` already is one)

```bash
adduser deploy                     # set a password when prompted
usermod -aG sudo deploy
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy   # copy your SSH key over
```

From now on, log in as `deploy` and use `sudo`:

```bash
ssh deploy@YOUR_SERVER_IP
```

### 3b. Firewall (UFW)

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80
sudo ufw allow 443
sudo ufw --force enable
sudo ufw status                    # should list 22/80/443
```

### 3c. Harden SSH (key-only login)

Once you've confirmed key login works as `deploy`:

```bash
sudo sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sudo sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo systemctl restart ssh
```

### 3d. Automatic security updates + brute-force protection (recommended)

```bash
sudo apt update && sudo apt -y upgrade
sudo apt -y install unattended-upgrades fail2ban
sudo systemctl enable --now fail2ban
```

---

## 4. Point your domain at the server (DNS)

You have two paths. **Pick ONE.**

### Path A — Plain DNS (registrar or DigitalOcean DNS)

Add an **A record** at your DNS host:

| Type | Name | Value | TTL |
|---|---|---|---|
| A | `@` (or `your-domain.com`) | `YOUR_SERVER_IP` | Automatic |
| A | `www` | `YOUR_SERVER_IP` | Automatic |

Wait a few minutes, then verify from your laptop:

```bash
dig +short your-domain.com         # should print YOUR_SERVER_IP
```

You'll get TLS via **Let's Encrypt** in Step 9.

### Path B — Cloudflare (optional, adds CDN + DDoS protection)

1. Add your site to Cloudflare; it gives you two **nameservers**.
2. At your **registrar**, replace the domain's nameservers with Cloudflare's. (Propagation
   can take up to a few hours.)
3. In Cloudflare **DNS**, add the same A records as above. Start with the **grey cloud
   (DNS-only)** so Let's Encrypt's HTTP challenge in Step 9 succeeds.
4. After TLS works, you may flip the records to the **orange cloud (Proxied)** and set
   **SSL/TLS mode → Full (strict)** so Cloudflare trusts your origin cert. Leave it grey if
   you'd rather keep it simple.

> If you proxy through Cloudflare, your server's real IP stays hidden and you get free DDoS
> mitigation — but the HTTP-01 cert challenge must run while DNS is grey, or use a
> Cloudflare Origin Certificate instead of Let's Encrypt.

---

## 5. Install the runtime

As `deploy` on the server:

```bash
# Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt -y install nodejs

# Docker (for Postgres + Redis)
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker deploy        # log out/in afterwards so this takes effect

# Reverse proxy + TLS tooling + process manager
sudo apt -y install apache2 certbot python3-certbot-apache git
sudo npm install -g pm2

# Enable the Apache modules the app needs (reverse proxy + websockets + TLS)
sudo a2enmod proxy proxy_http proxy_wstunnel ssl rewrite headers
sudo systemctl restart apache2
```

Log out and back in so the `docker` group applies (`docker ps` should work without `sudo`).

---

## 6. Get the code + start the databases

```bash
sudo mkdir -p /var/www/accounting
sudo chown -R deploy:deploy /var/www/accounting
git clone https://github.com/YOUR_GITHUB/YOUR_REPO.git /var/www/accounting
cd /var/www/accounting

# Start Postgres 16 + Redis 7 in Docker (defined in docker-compose.yml)
docker compose up -d
docker compose ps                     # both should be "healthy"
```

This brings up Postgres on `localhost:5432` (user/pass/db all `books`) and Redis on
`localhost:6379`, with data persisted in Docker volumes.

> **Harden the DB for production:** the compose defaults use `books`/`books`. For a public
> server, edit `docker-compose.yml` to a strong `POSTGRES_PASSWORD`, and set `DATABASE_URL`
> to match. The ports are only bound to the server; the firewall (Step 3b) doesn't expose
> 5432/6379 publicly, but a strong password is still good practice.

---

## 7. Configure `.env`

The app reads its config from `app/.env`. Start from the example and fill it in:

```bash
cd /var/www/accounting/app
cp .env.example .env
```

**Generate the secrets** (run each and paste the output into the matching line):

```bash
openssl rand -base64 32      # -> NEXTAUTH_SECRET
openssl rand -hex 32         # -> TAX_SIN_KEY        (must be 64 hex chars)
openssl rand -hex 32         # -> ENCRYPTION_KEY     (must be 64 hex chars)
openssl rand -hex 24         # -> FILES_API_TOKEN
openssl rand -hex 24         # -> AUDIT_API_KEY
openssl rand -hex 24         # -> FX_REVAL_SECRET
openssl rand -hex 24         # -> PLAID_SYNC_SECRET
```

Then edit `.env` (`nano .env`). At minimum, for a working production install set:

```bash
DATABASE_URL="postgresql://books:books@localhost:5432/books"
REDIS_URL="redis://localhost:6379"
NEXTAUTH_URL="https://your-domain.com"
NEXT_PUBLIC_APP_URL="https://your-domain.com"
NEXTAUTH_SECRET="<paste base64 secret>"
NODE_ENV="production"

# Security keys (the app throws if a feature that needs one runs without it)
TAX_SIN_KEY="<paste 64-hex>"        # encrypts SINs in the tax module
ENCRYPTION_KEY="<paste 64-hex>"     # encrypts stored bank-connection tokens
FILES_API_TOKEN="<paste hex>"       # bearer token for headless file/banking API
AUDIT_API_KEY="<paste hex>"         # bearer token for /api/audit-snapshot
FX_REVAL_SECRET="<paste hex>"       # auth for the FX-revaluation cron
PLAID_SYNC_SECRET="<paste hex>"     # auth for the daily bank-sync cron
```

See the **[full environment reference](#environment-variable-reference)** at the bottom for
every optional variable (Stripe, email, OCR, Plaid, file-storage paths).

> **`NEXTAUTH_URL` must exactly match the URL you visit** (scheme + host, no trailing slash),
> or login will fail with NextAuth errors.

---

## 8. Build, migrate, and seed your admin

```bash
cd /var/www/accounting/app
npm ci
npx prisma generate
npx prisma db push          # creates all tables (additive, safe to re-run)

# Create your first admin user. Set credentials via env so nothing personal is hardcoded:
SEED_ADMIN_EMAIL="you@example.com" SEED_ADMIN_PASSWORD="a-strong-password" npm run seed

npm run build               # production bundle (see Troubleshooting if it OOMs)
```

Start it under pm2 and make it survive reboots:

```bash
pm2 start npm --name books -- start      # runs `next start` (port 3000 by default)
pm2 save
pm2 startup                              # run the command it prints (sets up the boot service)
```

Quick local check on the server:

```bash
curl -I http://localhost:3000/login      # expect HTTP 200
```

---

## 9. Reverse proxy + HTTPS

Point Apache at the app and let Certbot issue a TLS certificate.

Create `/etc/apache2/sites-available/your-domain.com.conf`:

```apache
<VirtualHost *:80>
    ServerName your-domain.com
    ServerAlias www.your-domain.com

    ProxyPreserveHost On
    # WebSocket passthrough (Next.js needs this)
    RewriteEngine On
    RewriteCond %{HTTP:Upgrade} websocket [NC]
    RewriteCond %{HTTP:Connection} upgrade [NC]
    RewriteRule ^/?(.*) "ws://127.0.0.1:3000/$1" [P,L]

    ProxyPass / http://127.0.0.1:3000/
    ProxyPassReverse / http://127.0.0.1:3000/
</VirtualHost>
```

Enable it and get the cert:

```bash
sudo a2ensite your-domain.com
sudo a2dissite 000-default            # optional: drop the default page
sudo systemctl reload apache2

# Issues the cert AND rewrites the vhost to serve HTTPS on 443 with auto-renewal
sudo certbot --apache -d your-domain.com -d www.your-domain.com -m you@example.com --agree-tos
```

Certbot installs a renewal timer automatically. Confirm with `sudo certbot renew --dry-run`.

> **Using Cloudflare's orange-cloud proxy?** Either keep DNS grey while running the certbot
> command above, or skip Let's Encrypt and install a **Cloudflare Origin Certificate** on the
> server instead, then set Cloudflare SSL/TLS to **Full (strict)**.

---

## 10. Log in 🎉

Open `https://your-domain.com` and sign in with the admin email/password from Step 8. Then go
to **Settings → Business Profile** to set your company name, address, and logo — these flow
through invoices, PDFs, emails, and the login page.

---

## Updating the app later

From your laptop, this repo ships a `scripts/deploy.example.sh`. Copy it to `scripts/deploy.sh`,
set `SSH_TARGET`, `REMOTE_DIR`, and `PM2_APP` to your values, then:

```bash
cd app
./scripts/deploy.sh              # rsync code + build + restart
./scripts/deploy.sh --schema     # also run `prisma db push` for new tables/columns
```

It rsyncs `app/` (excluding `.env`, `node_modules`, `.next`), reinstalls deps, regenerates
Prisma, optionally pushes schema, rebuilds, restarts pm2, and health-checks `/login`.

**Always back up the database before a `--schema` deploy** (see below).

---

## Backups

Dump the Postgres database from inside its container (use the container's own `pg_dump` so the
version always matches):

```bash
docker exec books-postgres pg_dump -U books books | gzip > ~/books-backup-$(date +%F).sql.gz
```

Automate it with cron (daily at 3am, keep 14 days):

```bash
( crontab -l 2>/dev/null; echo '0 3 * * * docker exec books-postgres pg_dump -U books books | gzip > ~/books-backup-$(date +\%F).sql.gz && find ~ -name "books-backup-*.sql.gz" -mtime +14 -delete' ) | crontab -
```

Restore:

```bash
gzip -dc ~/books-backup-YYYY-MM-DD.sql.gz | docker exec -i books-postgres psql -U books books
```

---

## Security checklist

- [ ] SSH is **key-only**, root login disabled (Step 3c)
- [ ] UFW allows **only** 22/80/443 (Step 3b)
- [ ] Strong, unique `POSTGRES_PASSWORD` (not the `books` default) for a public box
- [ ] All secrets in `.env` generated with `openssl rand` — never reused, never committed
- [ ] `.env` is git-ignored (it already is) and not world-readable: `chmod 600 app/.env`
- [ ] Automatic security updates + fail2ban enabled (Step 3d)
- [ ] HTTPS enforced (certbot redirects 80→443 automatically)
- [ ] Database backups running and **test-restored at least once**
- [ ] *(If used)* Stripe/Plaid keys are **live** keys only in production, kept out of git

---

## Environment variable reference

`*` = required for a normal production install. Everything else is optional and only enables
the named feature.

### Core

| Variable | Req | What it does |
|---|:---:|---|
| `DATABASE_URL` | * | Postgres connection string. |
| `REDIS_URL` | * | Redis connection (sessions/cache). |
| `NEXTAUTH_URL` | * | Public app URL; must match what you browse to. |
| `NEXT_PUBLIC_APP_URL` | * | Public URL exposed to the browser (links, Plaid redirect). Defaults to `NEXTAUTH_URL`. |
| `NEXTAUTH_SECRET` | * | Session signing secret. `openssl rand -base64 32`. |
| `NODE_ENV` | | `production` in prod. |

### Security keys (generate with `openssl rand`)

| Variable | Req | What it does |
|---|:---:|---|
| `TAX_SIN_KEY` | * | AES-256-GCM key (64 hex chars) encrypting SINs in the tax module. |
| `ENCRYPTION_KEY` | * | AES-256-GCM key (64 hex chars) encrypting stored bank-connection tokens. |
| `FILES_API_TOKEN` | * | Bearer token (≥16 chars) for the headless file/banking API endpoints. |
| `AUDIT_API_KEY` | * | Bearer token for `GET /api/audit-snapshot`. |
| `FX_REVAL_SECRET` | * | Shared secret authorizing the FX-revaluation cron. |
| `PLAID_SYNC_SECRET` | * | Shared secret authorizing the daily bank-sync cron. |

### Payments — Stripe (optional)

| Variable | What it does |
|---|---|
| `STRIPE_SECRET_KEY` | Server-side Stripe key (`sk_live_…`). |
| `STRIPE_WEBHOOK_SECRET` | Verifies Stripe webhook calls (`whsec_…`). |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Browser-side key (`pk_live_…`). |

### Email — Mailgun (optional)

| Variable | What it does |
|---|---|
| `MAILGUN_API_KEY` | Mailgun API key for sending invoice/estimate emails. |
| `MAILGUN_DOMAIN` | Your verified Mailgun sending domain. |
| `MAILGUN_REGION` | `us` or `eu`. |
| `EMAIL_FROM` | From-address on outgoing mail, e.g. `billing@your-domain.com`. |

### AI receipt OCR (optional)

| Variable | What it does |
|---|---|
| `ANTHROPIC_API_KEY` | Enables "scan a receipt" OCR via Claude. |

### Bank feeds — Plaid (optional; CSV import works without it)

| Variable | What it does |
|---|---|
| `PLAID_CLIENT_ID` | Plaid client ID. |
| `PLAID_SECRET` | Plaid secret for the chosen environment. |
| `PLAID_ENV` | `sandbox` or `production`. |

### File storage & misc (optional — sensible defaults)

| Variable | Default | What it does |
|---|---|---|
| `UPLOAD_ROOT` | `app/uploads` | Where uploaded files/attachments are stored on disk. |
| `RECEIPTS_ROOT_FOLDER` | `Receipts` | Top-level folder name receipts are filed under. |
| `TAX_FILES_ROOT_FOLDER` | `Tax Slips` | Top-level folder name tax artifacts are filed under. |
| `SUBCONTRACTOR_ACCOUNT_NUMBER` | — | Optional GL account number used when seeding tax accounts. |

### Seed / maintenance scripts (one-time)

| Variable | What it does |
|---|---|
| `SEED_ADMIN_EMAIL` | Admin email created by `npm run seed`. |
| `SEED_ADMIN_PASSWORD` | Admin password for the seeded admin. |
| `OLD_ADMIN_EMAIL` | Used by `scripts/delete-old-admin.ts` to remove a prior admin. |

---

## Troubleshooting

- **`next build` killed / runs out of memory** — on a 1 GB server, add swap before building:
  ```bash
  sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile
  sudo mkswap /swapfile && sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
  ```
- **502 from Apache** — the app isn't running or isn't on port 3000. Check `pm2 status` and
  `pm2 logs books`.
- **Login fails / NextAuth errors** — `NEXTAUTH_URL` doesn't match the URL in your browser, or
  `NEXTAUTH_SECRET` is unset.
- **TLS challenge fails behind Cloudflare** — set the DNS record to grey-cloud (DNS-only) while
  running certbot, or use a Cloudflare Origin Certificate.
- **`prisma db push` errors** — confirm `DATABASE_URL` matches your compose credentials and the
  Postgres container is `healthy` (`docker compose ps`).
- **App throws about a missing key** (`TAX_SIN_KEY must be 32 bytes`, etc.) — that env var is
  unset or the wrong length. Crypto keys must be exactly 64 hex characters.
- **Port 5432/6379 already in use** — another Postgres/Redis is running; stop it or change the
  port mapping in `docker-compose.yml`.
