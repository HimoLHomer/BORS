#!/usr/bin/env bash
# Update BÖRS on the server to the latest version on GitHub.
#   sudo bash /opt/bors/deploy/oracle/update.sh
set -euo pipefail
APP_DIR=/opt/bors
if [[ $EUID -ne 0 ]]; then
  echo "Run with sudo." >&2
  exit 1
fi
/etc/cron.daily/bors-backup || true
sudo -u bors -H env ELECTRON_SKIP_BINARY_DOWNLOAD=1 bash -c "cd '$APP_DIR' && git pull --ff-only && npm ci --no-audit --no-fund && npm run build"
systemctl restart bors
sleep 3
curl -fsS http://127.0.0.1:3000/api/auth/status >/dev/null && echo "Updated and running." || {
  echo "BÖRS did not come back. Check: journalctl -u bors -n 50" >&2
  exit 1
}
