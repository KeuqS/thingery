# Deploy Thingery on a VPS

Target: any fresh Ubuntu 24.04 / Debian 12 VPS (2 GB RAM / 20 GB SSD is enough to start).
Result: `https://thingery.dev` serving the MCP endpoint, website, and discovery files,
with automatic HTTPS and nightly database backups.

Total time: ~15 minutes.

## 1. VPS initialization

```bash
ssh root@<VPS_IP>

# security basics
adduser --disabled-password thingery
usermod -aG sudo thingery
rsync --archive --chown=thingery:thingery ~/.ssh /home/thingery

# firewall: SSH + web only
apt update && apt install -y ufw
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp
ufw --force enable

# 2 GB swap as OOM insurance
fallocate -l 2G /swapfile && chmod 600 /swapfile
mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab

# Docker (official script)
curl -fsSL https://get.docker.com | sh
```

## 2. DNS (at Infomaniak)

Point the domain at the server before starting Caddy (it needs to solve the ACME challenge):

| Type | Name | Value |
|---|---|---|
| A | `thingery.dev` | `<VPS_IP>` |
| AAAA | `thingery.dev` | `<VPS_IPV6>` (if the VPS has one) |
| CNAME | `www` | `thingery.dev` |

## 3. First deploy

```bash
sudo su - thingery
sudo apt install -y git
git clone https://github.com/thingery/thingery.git /opt/thingery  # or: sudo mkdir /opt/thingery && sudo chown thingery /opt/thingery
cd /opt/thingery

cp .env.example .env
nano .env   # set POSTGRES_PASSWORD (required!), EMBED_API_KEY (optional), PUBLIC_BASE_URL=https://thingery.dev

docker compose -f docker-compose.prod.yml up -d --build

# apply the schema (idempotent — safe to re-run)
docker compose -f docker-compose.prod.yml exec -T db psql -U thingery -d thingery < db/schema.sql
```

Verify:

```bash
curl https://thingery.dev/healthz          # {"ok":true,...}
curl https://thingery.dev/llms.txt | head
```

## 4. Nightly backups (do not skip)

The Item Graph is the asset. Local dumps at minimum, object storage better:

```bash
sudo crontab -e
# add:
0 3 * * * docker exec $(docker ps -qf name=db) pg_dump -U thingery thingery | gzip > /var/backups/thingery-$(date +\%F).sql.gz && find /var/backups -name 'thingery-*.sql.gz' -mtime +14 -delete
0 4 * * * docker cp $(docker ps -qf name=app):/app/uploads /var/backups/img.tmp && tar czf /var/backups/thingery-images-$(date +\%F).tar.gz -C /var/backups/img.tmp . && rm -rf /var/backups/img.tmp && find /var/backups -name 'thingery-images-*.tar.gz' -mtime +14 -delete
```

The second job backs up uploaded item images. Test a restore once (into a scratch database / empty uploads dir) before you trust it.

## 5. Updating

Deploys are automated via the `deploy.yml` workflow (on push to `main`) once you set the
repo variables/secrets: `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, and `DEPLOY_ENABLED=true`.
Manual equivalent:

```bash
cd /opt/thingery && git pull && docker compose -f docker-compose.prod.yml up -d --build
```

## 6. Scaling later

- Bigger VPS: resize, reboot, done.
- Managed database: change `DATABASE_URL`, done.
- Watch disk: `df -h` — images are URLs (not blobs), so the DB stays small for a long time.
