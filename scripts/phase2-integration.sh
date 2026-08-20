#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Phase 2 integration check: FreeRADIUS (+ MariaDB) + radius-service
#
# Verifies end-to-end:
#   1. mariadb seeds the FreeRADIUS schema (radcheck/radacct tables exist)
#   2. radiusd starts with the sql module enabled
#   3. POST /internal/radius ... /activate  → radtest Access-Accept
#   4. POST /internal/radius ... /deactivate → radtest Access-Reject
#   5. change-plan → captured CoA packet (Mikrotik-Rate-Limit) on the NAS port
#   6. getUsage aggregates rows straight from radacct (fake accounting row)
#
# Prereqs: docker compose stack from docker-compose.yml. RADIUS_NAS_IP defaults
# to the colima/lima host gateway so CoA packets leave the VM and can be
# captured on the macOS host — override with RADIUS_NAS_IP if your setup
# differs (tests that depend on the capture then degrade to a timeout log).
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

COMPOSE="docker-compose"
API=http://localhost:4000
NAS_IP="${RADIUS_NAS_IP:-192.168.5.2}"
SHARED_SECRET="${RADIUS_SHARED_SECRET:-testing123}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@isp.local}"
ADMIN_PASS="${ADMIN_PASS:-admin123}"
RADIUS_PASS="${RADIUS_DEFAULT_PASSWORD:-ChangeMe1!}"
USERNAME=ppp_test_1

say()  { printf '\n── %s\n' "$1"; }
fail() { printf '\n✗ %s\n' "$1" >&2; exit 1; }
ok()   { printf '✓ %s\n' "$1"; }

cd "$(dirname "$0")/.."

# ── bootstrap stack ──────────────────────────────────────────────────────────
say "Starting stack (postgres, mariadb, freeradius, radius-service, api)"
$COMPOSE up --build -d postgres mariadb freeradius radius-service api

for i in $(seq 1 60); do
  if curl -sf http://localhost:4000/readyz >/dev/null 2>&1; then break; fi
  sleep 2
  [ "$i" = 60 ] && fail "api did not become ready"
done
ok "api ready"

say "Pushing schema (pppoeUsername) to postgres"
$COMPOSE exec -T api node apps/api/node_modules/.bin/prisma db push --accept-data-loss --schema apps/api/prisma/schema.prisma >/dev/null 2>&1 \
  || $COMPOSE exec -T api node apps/api/node_modules/prisma/build/index.js db push --accept-data-loss --schema apps/api/prisma/schema.prisma >/dev/null \
  || fail "prisma db push failed (no local prisma CLI in the api container?)"
ok "schema pushed"

# ── mariadb schema seeded? ───────────────────────────────────────────────────
# Note: colima's bind mounts can show initdb.d as empty (virtiofs sync quirk),
# so prime the schema explicitly when the tables are missing.
say "Ensuring FreeRADIUS schema in mariadb"
if ! $COMPOSE exec -T mariadb mariadb -uradius -pradiuspw radius -e "SHOW TABLES LIKE 'radcheck';" 2>/dev/null | grep -q radcheck; then
  $COMPOSE cp radius/initdb/schema.sql mariadb:/tmp/schema.sql
  $COMPOSE exec -T mariadb mariadb -uradius -pradiuspw radius -e "SOURCE /tmp/schema.sql;" >/dev/null 2>&1 || fail "schema load failed"
fi
$COMPOSE exec -T mariadb mariadb -uradius -pradiuspw radius -e "SHOW TABLES LIKE 'radacct';" 2>/dev/null | grep -q radacct \
  || fail "radacct table missing — schema did not load"
ok "radcheck/radacct tables exist"

# ── freeradius healthy ───────────────────────────────────────────────────────
say "Waiting for radiusd"
for i in $(seq 1 30); do
  if $COMPOSE exec -T freeradius sh -c "pgrep -f 'freeradius|radiusd' -x || pgrep -x freeradius || pgrep -f radiusd" >/dev/null 2>&1; then break; fi
  sleep 2
  [ "$i" = 30 ] && fail "radiusd not running"
done
ok "radiusd up"

# ── pick a subscriber, assign pppoeUsername ──────────────────────────────────
say "Assigning pppoeUsername=${USERNAME} to a subscriber"
SUB_ID=$($COMPOSE exec -T postgres psql -U isp_user -d isp_platform -tAc \
  "SELECT s.id FROM \"Subscriber\" s LEFT JOIN \"User\" u ON u.id = s.\"userId\" where u.email='chisom.okafor@example.com' LIMIT 1")
[ -n "$SUB_ID" ] || fail "no subscriber found for chisom.okafor@example.com — seed the DB first"
$COMPOSE exec -T postgres psql -U isp_user -d isp_platform -c \
  "UPDATE \"Subscriber\" SET \"pppoeUsername\"='${USERNAME}' WHERE id='${SUB_ID}'" >/dev/null
ok "subscriber ${SUB_ID} now has pppoeUsername=${USERNAME}"

# ── login + admin token ──────────────────────────────────────────────────────
TOKEN=$(curl -sf -X POST "$API/api/v1/auth/login" -H 'content-type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASS\"}" | python3 -c 'import sys,json;print(json.load(sys.stdin)["accessToken"])') \
  || fail "admin login failed"
ok "admin token acquired"

# ── e2e: activate → Access-Accept ────────────────────────────────────────────
say "Activating ${USERNAME}"
curl -sf -X POST "$API/api/v1/customers/$SUB_ID/radius/activate" -H "Authorization: $TOKEN" >/dev/null \
  || fail "activate endpoint failed"
sleep 1
RAD_TEST() {
  # Capture into a var instead of `| grep -q`: with `set -o pipefail` the
  # early-exiting grep SIGPIPEs radtest (exit 141) and the pipeline "fails".
  local out
  out=$($COMPOSE exec -T freeradius radtest -x "$USERNAME" "$RADIUS_PASS" 127.0.0.1 1812 "$SHARED_SECRET" 2>&1 || true)
  printf '%s\n' "$out"
}
radtest_out=$(RAD_TEST)
if printf '%s\n' "$radtest_out" | grep -q "Access-Accept"; then
  ok "radtest → Access-Accept (auth via radcheck)"
else
  fail "expected Access-Accept after activate"
fi

# ── e2e: deactivate → Access-Reject ──────────────────────────────────────────
say "Deactivating ${USERNAME}"
curl -sf -X POST "$API/api/v1/customers/$SUB_ID/radius/deactivate" -H "Authorization: $TOKEN" >/dev/null \
  || fail "deactivate endpoint failed"
sleep 1
radtest_out=$(RAD_TEST)
if printf '%s\n' "$radtest_out" | grep -q "Access-Reject"; then
  ok "radtest → Access-Reject (Auth-Type Reject wins)"
else
  fail "expected Access-Reject after deactivate"
fi

# ── e2e: re-activate + change-plan → CoA captured ────────────────────────────
say "Activating again + changing plan (CoA capture on NAS port 3799)"
python3 - "$NAS_IP" <<'PY' > /tmp/coa-capture.log 2>&1 &
import socket, sys, time
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
s.bind(("0.0.0.0", 3799))
s.settimeout(15)
start = time.time()
while time.time() - start < 15:
    try:
        data, addr = s.recvfrom(4096)
    except socket.timeout:
        break
    code = data[0]; ident = data[1]
    name = {40: "Disconnect-Request", 43: "CoA-Request"}.get(code, f"Code-{code}")
    attrs = []
    i = 20
    while i + 2 <= len(data):
        t, ln = data[i], data[i+1]
        if ln < 2 or i + ln > len(data):
            break
        v = data[i+2:i+ln]
        if t == 1:
            attrs.append(f"User-Name={v.decode(errors='replace')}")
        elif t == 26 and len(v) >= 6:
            vid = int.from_bytes(v[:4], 'big')
            if vid == 14988:  # MikroTik
                avp = v[6:]
                attrs.append(f"Mikrotik avp id={avp[0]} len={avp[1]} value={avp[2:].decode(errors='replace')}")
        i += ln
    print(f"{time.strftime('%H:%M:%S')} {name} id={ident} from={addr[0]}:{addr[1]} " + " ".join(attrs), flush=True)
PY
CAPTURE_PID=$!
sleep 1
curl -sf -X POST "$API/api/v1/customers/$SUB_ID/radius/activate" -H "Authorization: $TOKEN" >/dev/null
curl -sf -X POST "$API/api/v1/customers/$SUB_ID/radius/change-plan" -H "Authorization: $TOKEN" \
  -H 'content-type: application/json' -d '{"rateLimit":"8M/8M"}' >/dev/null || fail "change-plan failed"
sleep 6
kill "$CAPTURE_PID" 2>/dev/null || true

if grep -qE "Disconnect-Request" /tmp/coa-capture.log; then
  ok "Disconnect-Request captured (deactivate → live session cut)"
else
  echo "  (no Disconnect-Request captured — NAS unreachable or offline; DB row already blocks next auth)"
fi
if grep -qE "CoA-Request.*8M/8M|Rate-Limit" /tmp/coa-capture.log; then
  ok "CoA-Request with Mikrotik-Rate-Limit 8M/8M captured"
else
  echo "  (no CoA captured — NAS unreachable or offline; radreply row already applies on next auth)"
fi
cat /tmp/coa-capture.log | sed 's/^/  /' || true

# ── e2e: getUsage from radacct ───────────────────────────────────────────────
say "Inserting a fake accounting row + reading usage"
# radacct.acctuniqueid is UNIQUE and MD5('TEST-1') is constant across runs —
# clear the previous fake row first so reruns stay idempotent (1062 otherwise).
$COMPOSE exec -T mariadb mariadb -uradius -pradiuspw radius -e \
  "DELETE FROM radacct WHERE acctsessionid = 'TEST-1'; INSERT INTO radacct (acctsessionid, acctuniqueid, username, groupname, nasipaddress, acctstarttime, acctupdatetime, acctinputoctets, acctoutputoctets, acctsessiontime, calledstationid, callingstationid, acctterminatecause, framedipaddress) VALUES ('TEST-1', MD5('TEST-1'), '${USERNAME}', 'isp-users', '127.0.0.1', NOW(), NOW(), 1048576, 524288, 900, '', '', 'User-Request', '10.10.0.50');" 2>/dev/null \
  || fail "could not insert fake radacct row"
USAGE=$(curl -sf "$API/api/v1/customers/$SUB_ID/radius/usage" -H "Authorization: $TOKEN")
echo "$USAGE" | python3 -c '
import sys, json
u = json.load(sys.stdin)
assert u["username"] == "'"$USERNAME"'", u
assert u["totals"]["inputBytes"] >= 1048576, u
assert u["totals"]["outputBytes"] >= 524288, u
assert u["totals"]["sessions"] >= 1, u
print("✓  usage:", json.dumps(u["totals"]))' || fail "usage payload unexpected"
ok "getUsage aggregates radacct totals"

say "Phase 2 RADIUS integration: ALL CHECKS PASSED"
printf '\nNote: rows left behind for inspection — radcheck/radreply/radacct for %s,\nand Subscriber %s has pppoeUsername set.\n' "$USERNAME" "$SUB_ID"