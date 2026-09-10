# RADIUS stack

FreeRADIUS 3 + MariaDB accounting/auth, used by `radius-service` and managed from
the admin NOC page (`/noc` → **NAS** / **Profiles** tabs).

## NAS clients are SQL-backed

FreeRADIUS reads its NAS (router) list from the MariaDB `nas` table — the admin
NOC page writes to that same table, so routers can be added/edited without
touching CLI config.

Config in this repo:

- `conf/mods-available/sql` sets `read_clients = yes` (FreeRADIUS queries `nas`
  for the client entry matching the router's source IP).
- `conf/clients.conf` intentionally has **no static NAS block** — only
  `localhost` (radtest inside the container) and `docker` (172.16.0.0/12, lets
  containers on the compose network run the RADIUS auth probe).
- `entrypoint.sh` templates `RADIUS_SHARED_SECRET` into `clients.conf` and the
  DB credentials into `mods-available/sql`.

### Migration checklist (file-based → SQL clients)

If FreeRADIUS was previously using the static `client mikrotik` block, do this
**before/with** deploying the new config or routers will be rejected:

1. Add the router to the `nas` table with the same IP and secret — either via
   the admin NOC page (**NAS → Add NAS**) or SQL:
   ```sql
   INSERT INTO nas (nasname, shortname, type, ports, secret, description)
   VALUES ('<router-public-ip>', 'mikrotik', 'mikrotik', 1812, '<shared-secret>', 'Main NAS');
   ```
2. Redeploy the `freeradius` service so `read_clients = yes` takes effect
   (`docker compose ... up -d --build freeradius`).
3. Verify from inside the FreeRADIUS container:
   ```sh
   radtest <pppoe-user> <password> 127.0.0.1 1812 <RADIUS_SHARED_SECRET>
   ```
   → `Access-Accept` after the customer is activated, `Access-Reject` after
   deactivation.
4. The NOC page's **Test** button probes the router's UDP 1812/1813 ports and
   sends an Access-Request to the RADIUS server to confirm it is responding
   (probe user from `RADIUS_PROBE_USER` / `RADIUS_PROBE_PASSWORD`; an
   Access-Reject still proves the server and shared secret are working).

### CoA / Disconnect

`coa.service.ts` sends CoA/Disconnect to `RADIUS_NAS_IP:RADIUS_NAS_PORT` using
`RADIUS_SHARED_SECRET` (via `radclient`). Keep the NAS row's secret equal to
`RADIUS_SHARED_SECRET`, otherwise live plan changes won't reach the router
(DB-level changes still apply on the next auth/accounting round).
