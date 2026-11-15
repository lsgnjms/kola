#!/usr/bin/env bash
# Kola on a fresh Ubuntu 24.04 server (x86_64, 2 vCPU / 4 GB recommended).
#
#   curl -fsSL https://raw.githubusercontent.com/lsgnjms/kola/main/infra/deploy/setup.sh | sudo bash
#       → https://kola.<your-ip>.sslip.io (no domain needed)
#   curl -fsSL …/setup.sh | sudo bash -s kola.example.com
#       → your own domain (point its A record at the server first)
#
# Safe to re-run: it updates the code, rebuilds the web app and restarts the API.
# Regtest only. The demo wallets hold test money and are custodial; never use real funds.
set -euo pipefail

REPO_URL="${KOLA_REPO_URL:-https://github.com/lsgnjms/kola.git}"
BRANCH="${KOLA_BRANCH:-main}"
APP_DIR=/opt/kola
APP_USER=kola

say() { printf '\n\033[1;32m▸ %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Run as root: sudo bash $0"
grep -q 'VERSION_ID="24.04"' /etc/os-release || echo "Warning: tested on Ubuntu 24.04 only."

# --- Domain -----------------------------------------------------------------
PUBLIC_IP="$(ip -4 route get 1.1.1.1 | awk '{for (i = 1; i <= NF; i++) if ($i == "src") print $(i + 1)}')"
DOMAIN="${1:-kola.${PUBLIC_IP//./-}.sslip.io}"
say "Setting up Kola at https://${DOMAIN}"

# --- Packages ---------------------------------------------------------------
say "Installing Docker, Node 22, Caddy and the firewall"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -yq ca-certificates curl git ufw docker.io docker-compose-v2 caddy
if ! command -v node >/dev/null || [[ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -yq nodejs
fi
corepack enable
systemctl enable --now docker

# --- Swap: LND nodes are happier with headroom on small servers ----------------
if ! swapon --show | grep -q .; then
  say "Adding 2 GB of swap"
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# --- Firewall: SSH and HTTPS only. Every Kola service binds 127.0.0.1. ----------
say "Firewall: allowing SSH, HTTP and HTTPS only"
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

# --- App user and code ----------------------------------------------------------
id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /bin/bash "$APP_USER"
usermod -aG docker "$APP_USER"
as_app() { runuser -u "$APP_USER" -- "$@"; }

say "Fetching the code (${BRANCH})"
if [[ -d "$APP_DIR/.git" ]]; then
  as_app git -C "$APP_DIR" fetch -q origin "$BRANCH"
  as_app git -C "$APP_DIR" checkout -q "$BRANCH"
  as_app git -C "$APP_DIR" reset -q --hard "origin/$BRANCH"
else
  install -d -o "$APP_USER" -g "$APP_USER" "$APP_DIR"
  as_app git clone -q --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi
install -d -o "$APP_USER" -g "$APP_USER" -m 700 "$APP_DIR/data"

say "Installing dependencies"
cd "$APP_DIR"
as_app env COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm install --frozen-lockfile

# --- Configuration (.env stays on the server; secrets are generated on first API start) ---
if [[ ! -f .env ]]; then
  as_app cp .env.example .env
  chmod 600 .env
fi
set_env() { # key value: replace or append
  if grep -q "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else echo "$1=$2" >> .env; fi
}
set_env PUBLIC_API_URLS "https://${DOMAIN}/api"
set_env CORS_ORIGINS "https://${DOMAIN}"
set_env DEMO_MODE true
set_env BITCOIN_NETWORK regtest

# --- Regtest stack, seed, web build --------------------------------------------
say "Starting the test network and preparing wallets (first run takes a few minutes)"
DEPLOY="$APP_DIR/infra/deploy"
install -m 644 "$DEPLOY/kola-seed.service" "$DEPLOY/kola-api.service" \
  "$DEPLOY/kola-demo-reset.service" "$DEPLOY/kola-demo-reset.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable kola-seed.service kola-api.service kola-demo-reset.timer >/dev/null
systemctl restart kola-seed.service

say "Building the web app"
as_app pnpm --filter @kola/web build

say "Starting the API"
systemctl restart kola-api.service
systemctl start kola-demo-reset.timer

# --- HTTPS --------------------------------------------------------------------
say "Configuring HTTPS (Caddy gets a certificate automatically)"
cat > /etc/default/kola <<EOF
KOLA_DOMAIN=${DOMAIN}
KOLA_DIR=${APP_DIR}
EOF
install -d /etc/systemd/system/caddy.service.d
cat > /etc/systemd/system/caddy.service.d/kola.conf <<'EOF'
[Service]
EnvironmentFile=/etc/default/kola
EOF
install -m 644 "$DEPLOY/Caddyfile" /etc/caddy/Caddyfile
# Caddy serves the built files directly.
chmod o+x /opt "$APP_DIR" "$APP_DIR/apps" "$APP_DIR/apps/web"
chmod -R o+rX "$APP_DIR/apps/web/dist"
systemctl daemon-reload
systemctl restart caddy

# --- Check ----------------------------------------------------------------------
say "Checking"
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:3000/health" >/dev/null 2>&1; then break; fi
  sleep 2
done
curl -fsS "http://127.0.0.1:3000/health" >/dev/null || die "The API did not start. See: journalctl -u kola-api -n 50"

cat <<EOF

────────────────────────────────────────────────────────────
  Kola is live:  https://${DOMAIN}
  (the HTTPS certificate can take a minute on the first visit)

  Demo people: Khady, Ousmane, Mariama (PIN 123456).
  The demo resets daily at 03:00 UTC, or now with:
      sudo systemctl start kola-demo-reset

  Logs:     journalctl -u kola-api -f
  Update:   sudo bash ${APP_DIR}/infra/deploy/setup.sh ${1:-}
  Optional: add ANTHROPIC_API_KEY to ${APP_DIR}/.env for free-text
            questions, then: sudo systemctl restart kola-api
────────────────────────────────────────────────────────────
EOF
