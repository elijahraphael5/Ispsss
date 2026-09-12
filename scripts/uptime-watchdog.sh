#!/usr/bin/env sh
# Uptime watchdog for the ISP platform.
#
# Checks the public entrypoints every run, alerts via webhook on a state
# transition (down / recovered), and optionally restarts stopped stack
# containers (self-heal). Designed for a 1-2 minute cron on the Docker host.
#
# Install (cron, every 2 minutes):
#   */2 * * * * ADMIN_URL=https://admin.hikonnectng.com \
#     ALERT_WEBHOOK_URL=https://hooks.slack.com/services/... \
#     COMPOSE_PROJECT=wjrlh3ijc8qu5ohzlfearx3f SELF_HEAL=1 \
#     /opt/isp/scripts/uptime-watchdog.sh >> /var/log/isp-watchdog.log 2>&1
#
# Exit code: 0 when all checks pass, 1 otherwise (cron will mail on failure).
set -u

ADMIN_URL="${ADMIN_URL:-https://admin.hikonnectng.com}"
CUSTOMER_URL="${CUSTOMER_URL:-https://my.hikonnectng.com}"
API_URL="${API_URL:-https://api.hikonnectng.com/healthz}"
ALERT_WEBHOOK_URL="${ALERT_WEBHOOK_URL:-}"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-}"
SELF_HEAL="${SELF_HEAL:-0}"
STATE_DIR="${STATE_DIR:-/tmp/isp-uptime-watchdog}"
TIMEOUT="${TIMEOUT:-15}"

mkdir -p "$STATE_DIR"
state_file="$STATE_DIR/state"

failures=""

check() {
  name="$1"
  url="$2"
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time "$TIMEOUT" "$url" 2>/dev/null || echo 000)
  if [ "$code" -ge 200 ] && [ "$code" -lt 400 ]; then
    echo "ok:   $name ($code)"
    return 0
  fi
  echo "FAIL: $name ($code)"
  failures="${failures}${failures:+, }${name}(${code})"
  return 1
}

notify() {
  [ -n "$ALERT_WEBHOOK_URL" ] || return 0
  # Works for both Slack (text) and Discord (content).
  payload=$(printf '{"text":"%s","content":"%s"}' "$1" "$1")
  curl -s -o /dev/null --max-time 10 -H 'Content-Type: application/json' \
    -d "$payload" "$ALERT_WEBHOOK_URL" || echo "watchdog: webhook alert failed"
}

self_heal() {
  [ "$SELF_HEAL" = "1" ] || return 0
  [ -n "$COMPOSE_PROJECT" ] || return 0
  command -v docker >/dev/null 2>&1 || return 0
  # Skip while a deploy is running — Coolify will bring the stack up itself.
  if pgrep -f "docker compose.*${COMPOSE_PROJECT}" >/dev/null 2>&1; then
    echo "watchdog: deploy in progress, skipping self-heal"
    return 0
  fi
  stopped=$(docker ps -aq \
    -f "label=com.docker.compose.project=${COMPOSE_PROJECT}" \
    -f status=exited -f status=created -f status=dead)
  if [ -n "$stopped" ]; then
    echo "watchdog: starting stopped containers: $(echo "$stopped" | tr '\n' ' ')"
    # shellcheck disable=SC2086
    docker start $stopped >/dev/null || true
  fi
}

check admin "$ADMIN_URL" || true
check customer "$CUSTOMER_URL" || true
check api "$API_URL" || true

prev="ok"
[ -f "$state_file" ] && prev=$(cat "$state_file")

if [ -n "$failures" ]; then
  echo "watchdog: DOWN ->${failures}"
  self_heal
  if [ "$prev" != "fail" ]; then
    notify "ISP stack DOWN:${failures} ($(date -u '+%Y-%m-%d %H:%M UTC'))"
  fi
  echo fail > "$state_file"
  exit 1
fi

echo "watchdog: all checks passed"
if [ "$prev" = "fail" ]; then
  notify "ISP stack recovered ($(date -u '+%Y-%m-%d %H:%M UTC'))"
fi
echo ok > "$state_file"
exit 0
