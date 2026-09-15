#!/bin/sh
set -e

# ── Template the shared secret into clients.conf ──────────────────────────────
# NAS entries themselves come from the MariaDB `nas` table (read_clients = yes)
# and are managed from the admin NOC page — see radius/README.md.
SECRET="${RADIUS_SHARED_SECRET:-testing123}"
# Use envsubst/awk instead of sed to avoid breaking on /, &, | in secrets
if command -v envsubst >/dev/null 2>&1; then
  export RADIUS_SHARED_SECRET="$SECRET"
  envsubst '${RADIUS_SHARED_SECRET}' < /etc/raddb/clients.conf > /tmp/clients.conf.tmp && mv /tmp/clients.conf.tmp /etc/raddb/clients.conf
  # Fallback if template uses @@RADIUS_SHARED_SECRET@@ placeholder
  if grep -q "@@RADIUS_SHARED_SECRET@@" /etc/raddb/clients.conf 2>/dev/null; then
    awk -v s="$SECRET" '{ gsub(/@@RADIUS_SHARED_SECRET@@/, s); print }' /etc/raddb/clients.conf > /tmp/clients.conf.tmp && mv /tmp/clients.conf.tmp /etc/raddb/clients.conf
  fi
else
  awk -v s="$SECRET" '{ gsub(/@@RADIUS_SHARED_SECRET@@/, s); print }' /etc/raddb/clients.conf > /tmp/clients.conf.tmp && mv /tmp/clients.conf.tmp /etc/raddb/clients.conf
fi

# ── Template DB env vars into the sql module config ───────────────────────────
DB_HOST="${RADIUS_DB_HOST:-mariadb}"
DB_PORT="${RADIUS_DB_PORT:-3306}"
DB_USER="${RADIUS_DB_USER:-radius}"
DB_PASS="${RADIUS_DB_PASSWORD:-radiuspw}"
DB_NAME="${RADIUS_DB_NAME:-radius}"
if command -v envsubst >/dev/null 2>&1; then
  export RADIUS_DB_HOST="$DB_HOST" RADIUS_DB_PORT="$DB_PORT" RADIUS_DB_USER="$DB_USER" RADIUS_DB_PASSWORD="$DB_PASS" RADIUS_DB_NAME="$DB_NAME"
  # sql module uses @@DB_*@@ placeholders — use awk to avoid sed escaping issues
  awk -v h="$DB_HOST" -v p="$DB_PORT" -v u="$DB_USER" -v pw="$DB_PASS" -v n="$DB_NAME" '{ gsub(/@@DB_HOST@@/, h); gsub(/@@DB_PORT@@/, p); gsub(/@@DB_USER@@/, u); gsub(/@@DB_PASS@@/, pw); gsub(/@@DB_NAME@@/, n); print }' /etc/raddb/mods-available/sql > /tmp/sql.tmp && mv /tmp/sql.tmp /etc/raddb/mods-available/sql
else
  awk -v h="$DB_HOST" -v p="$DB_PORT" -v u="$DB_USER" -v pw="$DB_PASS" -v n="$DB_NAME" '{ gsub(/@@DB_HOST@@/, h); gsub(/@@DB_PORT@@/, p); gsub(/@@DB_USER@@/, u); gsub(/@@DB_PASS@@/, pw); gsub(/@@DB_NAME@@/, n); print }' /etc/raddb/mods-available/sql > /tmp/sql.tmp && mv /tmp/sql.tmp /etc/raddb/mods-available/sql
fi

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
