# Hosting the live demo

One script turns a fresh Ubuntu 24.04 server into a public Kola demo with HTTPS.
It runs the same regtest stack as `pnpm start` (test money only), so nothing here
touches real bitcoin.

## What you need

- A server with **Ubuntu 24.04, x86_64, 2 vCPU and 4 GB RAM** (e.g. Hetzner CPX22).
  Measured after seeding: the whole regtest stack (bitcoind, 7 LND nodes, the relay)
  uses about 0.4 GB; with the API and Caddy, under 1 GB. Building the web app briefly
  needs about 1 GB more. 2 GB works but leaves little headroom. Any provider works.
- SSH access as root (or a user with `sudo`).
- No domain needed: the script uses `kola.<server-ip>.sslip.io`, which points at
  the server automatically. To use your own domain, point its A record at the
  server and pass it as an argument.

## Install

```bash
ssh root@<server-ip>
curl -fsSL https://raw.githubusercontent.com/lsgnjms/kola/main/infra/deploy/setup.sh | sudo bash
# or, with your own domain:
curl -fsSL https://raw.githubusercontent.com/lsgnjms/kola/main/infra/deploy/setup.sh | sudo bash -s kola.example.com
```

The first run takes about 10 minutes (Docker images, funding the test wallets,
opening channels). It ends by printing the live URL.

## What it sets up

| Piece | Where | Notes |
|---|---|---|
| Regtest stack | Docker, `infra/docker-compose.yml` | Every port bound to `127.0.0.1` |
| `kola-seed.service` | systemd | Starts the stack and re-runs `seed` on every boot (containers get new IPs). Stops the nodes cleanly on shutdown |
| `kola-api.service` | systemd, user `kola` | Loopback only, sandboxed: can write `/opt/kola/data` and nothing else |
| Caddy | `/etc/caddy/Caddyfile` | HTTPS certificate, serves the web app, proxies `/api` and `/relay`, sets security headers (strict CSP, HSTS) |
| `kola-demo-reset.timer` | systemd | Resets the shared demo daily at 03:00 UTC and frees the spare wallets |
| Firewall | ufw | SSH, 80 and 443 only |
| `.env` | `/opt/kola/.env`, mode 600 | Coordinator keys are generated on first start in `/opt/kola/data` and never leave the server |

## Day to day

```bash
journalctl -u kola-api -f                   # API logs (no invoices, keys or names)
sudo systemctl start kola-demo-reset        # reset the demo now
sudo bash /opt/kola/infra/deploy/setup.sh   # update to the latest main
sudo reboot                                 # safe: the stack stops cleanly and re-seeds on boot
```

**Free-text assistant (optional):** add `ANTHROPIC_API_KEY=...` to `/opt/kola/.env`,
then `sudo systemctl restart kola-api`. Without it, the quick questions still work.

## Before sharing the link

- Open it on a phone, tap **Khady**, start a round, and pay with all three demo people
  (switch in Settings). The pot should arrive within seconds.
- Check **Record** shows "all records verified" (the relay works through `/relay`).
- Reset afterwards: `sudo systemctl start kola-demo-reset`.

## Limits of the shared demo

- Everyone shares the same three demo people. If two judges use Khady at the
  same time, they see each other's rounds. The daily reset puts it back.
- Three spare wallets are available for brand-new accounts. When they are taken,
  new accounts see a "no wallet available" message until the next reset.
