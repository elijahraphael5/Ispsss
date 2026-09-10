#!/usr/bin/env sh
set -euo pipefail

# Dumps the ISP Postgres DB and the FreeRADIUS MariaDB (radacct) with retention.
# Prereqs: pg_dump (postgresql-client) and mysqldump (mariadb-client) on PATH.
# Override via env or a sourced .env: DATABASE_URL, RADIUS_DB_*, BACKUP_DIR, KEEP_DAYS.
# Example: BACKUP_DIR=/var/backups/isp DATABASE_URL=postgresql://... ./scripts/backup.sh

BACKUP_DIR="${BACKUP_DIR:-./backups}"
KEEP_DAYS="${KEEP_DAYS:-7}"
STAMP="$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"

# --- Postgres (isp_platform) ---
PG_URL="${DATABASE_URL:-postgresql://isp_user:change_me@localhost:5432/isp_platform}"
pg_dump "$PG_URL" -Fc -f "$BACKUP_DIR/postgres_$STAMP.dump"

# --- FreeRADIUS accounting DB (MariaDB) ---
RDB_HOST="${RADIUS_DB_HOST:-localhost}"
RDB_PORT="${RADIUS_DB_PORT:-3306}"
RDB_USER="${RADIUS_DB_USER:-radius}"
RDB_PASS="${RADIUS_DB_PASSWORD:-radiuspw}"
RDB_NAME="${RADIUS_DB_NAME:-radius}"
mysqldump -h "$RDB_HOST" -P "$RDB_PORT" -u "$RDB_USER" -p"$RDB_PASS" "$RDB_NAME" > "$BACKUP_DIR/radius_$STAMP.sql"

# --- Retention ---
find "$BACKUP_DIR" -type f -mtime "+$KEEP_DAYS" -delete

echo "Backups written to $BACKUP_DIR (retention: $KEEP_DAYS days)"
