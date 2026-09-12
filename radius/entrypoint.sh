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

# ── Bootstrap the FreeRADIUS SQL schema (idempotent) ──────────────────────────
# A fresh MariaDB volume normally runs radius/initdb/schema.sql, but if that
# step is skipped or aborted mid-init the sql module fails to instantiate
# (Table 'radius.nas' doesn't exist) and this container crash-loops. Apply the
# schema here as the radius user (it has ALL privileges on the radius database),
# guarded by a probe for the `nas` table.
SQL_CLIENT="$(command -v mariadb || command -v mysql || true)"
if [ -z "$SQL_CLIENT" ]; then
  echo "freeradius entrypoint: no mariadb/mysql client installed" >&2
  exit 1
fi

SCHEMA_FILE=/etc/freeradius/mods-config/sql/main/mysql/schema.sql
if [ ! -f "$SCHEMA_FILE" ]; then
  echo "freeradius entrypoint: schema file not found at $SCHEMA_FILE" >&2
  exit 1
fi

sql() {
  MYSQL_PWD="$DB_PASS" "$SQL_CLIENT" -h"$DB_HOST" -P"$DB_PORT" -u"$DB_USER" "$@"
}

until sql -e "SELECT 1" >/dev/null 2>&1; do
  echo "freeradius entrypoint: waiting for mariadb at ${DB_HOST}:${DB_PORT}..."
  sleep 2
done

if ! sql "$DB_NAME" -e "SELECT 1 FROM nas LIMIT 1" >/dev/null 2>&1; then
  echo "freeradius entrypoint: applying schema.sql to ${DB_NAME} db..."
  sql "$DB_NAME" < "$SCHEMA_FILE"
  echo "freeradius entrypoint: schema applied."
fi

if command -v freeradius >/dev/null 2>&1; then
  exec freeradius -f -l stdout "$@"
fi
exec radiusd -f -l stdout "$@"
