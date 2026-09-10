#!/bin/sh
set -e

# ── Template the shared secret into clients.conf ──────────────────────────────
# NAS entries themselves come from the MariaDB `nas` table (read_clients = yes)
# and are managed from the admin NOC page — see radius/README.md.
SECRET="${RADIUS_SHARED_SECRET:-testing123}"
sed -i "s/@@RADIUS_SHARED_SECRET@@/${SECRET}/g" /etc/raddb/clients.conf

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
