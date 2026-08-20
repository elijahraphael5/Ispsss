#!/bin/sh
set -e

# ── Template RADIUS_* env vars into clients.conf ──────────────────────────────
NAS_IP="${RADIUS_NAS_IP:-192.168.5.2}"
SECRET="${RADIUS_SHARED_SECRET:-testing123}"
if [ -n "$NAS_IP" ] && [ "$NAS_IP" != "127.0.0.1" ]; then
  # Keep the stock localhost client (for radtest) + add the MikroTik NAS client.
  sed -i "s/@@RADIUS_NAS_IP@@/${NAS_IP}/g; s/@@RADIUS_SHARED_SECRET@@/${SECRET}/g" /etc/raddb/clients.conf
else
  # NAS == localhost: drop the templated block entirely (duplicate client
  # definition would make radiusd refuse to start).
  sed -i '/^client mikrotik {/,/^}/d' /etc/raddb/clients.conf
  sed -i "s/@@RADIUS_SHARED_SECRET@@/${SECRET}/g" /etc/raddb/clients.conf
fi

# ── Template DB env vars into the sql module config ───────────────────────────
DB_HOST="${RADIUS_DB_HOST:-mariadb}"
DB_PORT="${RADIUS_DB_PORT:-3306}"
DB_USER="${RADIUS_DB_USER:-radius}"
DB_PASS="${RADIUS_DB_PASSWORD:-radiuspw}"
DB_NAME="${RADIUS_DB_NAME:-radius}"
sed -i "s/@@DB_HOST@@/${DB_HOST}/g; s/@@DB_PORT@@/${DB_PORT}/g; s/@@DB_USER@@/${DB_USER}/g; s/@@DB_PASS@@/${DB_PASS}/g; s/@@DB_NAME@@/${DB_NAME}/g" /etc/raddb/mods-available/sql

if command -v freeradius >/dev/null 2>&1; then
  exec freeradius -f -l stdout "$@"
fi
exec radiusd -f -l stdout "$@"