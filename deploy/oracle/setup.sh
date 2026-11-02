#!/usr/bin/env bash
# One-time setup of BÖRS on a fresh Ubuntu 24.04 server (Oracle Cloud Always Free, Arm or x86).
#
#   curl -fsSL https://raw.githubusercontent.com/HimoLHomer/BORS/main/deploy/oracle/setup.sh -o setup.sh
#   sudo bash setup.sh your-name.duckdns.org
#
# Installs Node.js 22, Caddy (automatic HTTPS) and BÖRS as a system service, asks for the login
# password, and opens ports 80/443 in the server firewall. Safe to re-run.
set -euo pipefail

DOMAIN="${1:-}"
if [[ -z "$DOMAIN" ]]; then
  echo "Usage: sudo bash setup.sh <domain>   (e.g. myborse.duckdns.org)" >&2
  exit 1
fi
if [[ $EUID -ne 0 ]]; then
  echo "Run with sudo." >&2
  exit 1
fi

REPO_URL="${BORS_REPO_URL:-https://github.com/HimoLHomer/BORS.git}"
APP_DIR=/opt/bors
DATA_DIR=/var/lib/bors
ENV_FILE=/etc/bors/bors.env

echo "==> Installing packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl gnupg git build-essential python3 sqlite3 iptables-persistent \
  debian-keyring debian-archive-keyring apt-transport-https

if ! command -v node >/dev/null || [[ "$(node -v | cut -d. -f1)" != "v22" ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

if ! command -v caddy >/dev/null; then
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

echo "==> Creating user and folders"
id bors >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin bors
mkdir -p "$DATA_DIR" /etc/bors
chown bors:bors "$DATA_DIR"
chmod 750 "$DATA_DIR"

echo "==> Fetching and building BÖRS"
if [[ -d "$APP_DIR/.git" ]]; then
  git -C "$APP_DIR" pull --ff-only
else
  git clone "$REPO_URL" "$APP_DIR"
fi
chown -R bors:bors "$APP_DIR"
# The desktop app (Electron) is a dev dependency; the server never needs its 100 MB binary.
sudo -u bors -H env ELECTRON_SKIP_BINARY_DOWNLOAD=1 bash -c "cd '$APP_DIR' && npm ci --no-audit --no-fund && npm run build"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "==> Choose the login password (at least 10 characters; input is hidden)"
  HASH="$(sudo -u bors -H bash -c "cd '$APP_DIR' && node scripts/hash-password.mjs" </dev/tty | tail -n1)"
  SECRET="$(head -c 32 /dev/urandom | base64 | tr -d '\n')"
  umask 077
  cat > "$ENV_FILE" <<EOF
NODE_ENV=production
PORT=3000
BORS_LISTEN_HOST=127.0.0.1
BORS_APP_ROOT=$APP_DIR
BORS_DB_PATH=$DATA_DIR/portfolio.db
BORS_PASSWORD_HASH=$HASH
BORS_SESSION_SECRET=$SECRET
EOF
  chown root:bors "$ENV_FILE"
  chmod 640 "$ENV_FILE"
else
  echo "==> Keeping existing $ENV_FILE (delete it to set a new password)"
fi

echo "==> Installing the service"
cat > /etc/systemd/system/bors.service <<EOF
[Unit]
Description=BÖRS portfolio dashboard
After=network-online.target
Wants=network-online.target

[Service]
User=bors
Group=bors
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
ExecStart=/usr/bin/node $APP_DIR/dist/server.cjs
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$DATA_DIR $APP_DIR/data
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
mkdir -p "$APP_DIR/data"
chown bors:bors "$APP_DIR/data"
systemctl daemon-reload
systemctl enable --now bors
systemctl restart bors

echo "==> Configuring HTTPS for $DOMAIN"
cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
  encode gzip
  reverse_proxy 127.0.0.1:3000
}
EOF
systemctl reload caddy || systemctl restart caddy

echo "==> Opening ports 80 and 443 in the server firewall"
# Oracle's Ubuntu images block everything but SSH in iptables (separately from the cloud firewall).
for port in 80 443; do
  if ! iptables -C INPUT -p tcp --dport "$port" -m conntrack --ctstate NEW -j ACCEPT 2>/dev/null; then
    # Insert ahead of the image's catch-all REJECT rule (append if there is none).
    reject_line="$(iptables -L INPUT --line-numbers -n | awk '/REJECT/ {print $1; exit}')"
    if [[ -n "$reject_line" ]]; then
      iptables -I INPUT "$reject_line" -p tcp --dport "$port" -m conntrack --ctstate NEW -j ACCEPT
    else
      iptables -A INPUT -p tcp --dport "$port" -m conntrack --ctstate NEW -j ACCEPT
    fi
  fi
done
netfilter-persistent save

echo "==> Daily database backup (kept 14 days)"
cat > /etc/cron.daily/bors-backup <<EOF
#!/bin/sh
mkdir -p $DATA_DIR/backups
sqlite3 $DATA_DIR/portfolio.db ".backup '$DATA_DIR/backups/portfolio-\$(date +%F).db'"
find $DATA_DIR/backups -name 'portfolio-*.db' -mtime +14 -delete
chown -R bors:bors $DATA_DIR/backups
EOF
chmod 755 /etc/cron.daily/bors-backup

sleep 3
if curl -fsS http://127.0.0.1:3000/api/auth/status >/dev/null; then
  echo
  echo "Done. Open https://$DOMAIN (the first HTTPS certificate can take a minute)."
else
  echo "BÖRS did not answer yet. Check: journalctl -u bors -n 50" >&2
  exit 1
fi
