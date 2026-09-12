# Incident: stack-wide container stop — 2026-09-12

- **Status:** resolved; root cause **undetermined** (pending host-side evidence)
- **Impact:** `admin.hikonnectng.com`, `my.hikonnectng.com` and `api.hikonnectng.com`
  returned Traefik `503 no available server` for ~2 hours.
- **Host / resource:** `vmi2722077`, Coolify docker-compose resource
  `wjrlh3ijc8qu5ohzlfearx3f` (project `isp-platform`).

## Timeline (UTC)

| Time | Event |
|---|---|
| 11:04–11:07 | Coolify deployment finished successfully (log: Success, 40m03s). |
| 11:08:58–11:12:22 | Every container in the stack exited (nginx, api, auth/payments/billing/support/customer/radius services, admin, customer, mariadb, postgres, redis). |
| ~13:0x | Stack restarted manually with `docker start`; sites recovered. |

## Evidence collected

- Docker daemon log (`journalctl -u docker`): `hasBeenManuallyStopped=true` on every
  container, `exitStatus 137` on most (SIGKILL after the 30s grace period).
- Host had 4.9 GiB free RAM at the time — not an OOM kill.
- Coolify deployment history around the event: one entry, status **Success**; no
  failed/rejected deployment.
- All 13 containers stopped within ~3.5 minutes of each other, including
  postgres/mariadb/redis — not an application-level fault.

## Root cause

**Undetermined.** What is known: the stop was issued through the Docker API.
`hasBeenManuallyStopped=true` is only set for explicit stop requests (`docker stop`,
`docker compose stop/down`, or an API call such as Coolify's), not for crashes. The 30s
grace period followed by SIGKILL is consistent with an explicit
`docker stop --time=30`-style call.

Ruled out:

- OOM kill (4.9 GiB free RAM).
- Container/application crash (all services including databases stopped together).
- Failed or rejected deployment (deploy log Success, only one deployment).

Not yet determined (requires host/Coolify evidence — see checks below):

- whether Coolify itself issued the stop (deploy-job cleanup, UI/API action, scheduled
  task, notification/healthcheck automation).
- whether an external webhook/API token or a person/tool on the host issued it.

No repo-side mechanism was found that stops the stack: `docker-compose.yaml` defines no
scheduled tasks, and there is no Coolify setting in the repo that stops a compose stack
on a failing healthcheck. The `freeradius` service was crash-looping at the time
(separate bug, since fixed by `fix-freeradius-schema-bootstrap`) — no evidence it can
stop sibling services, but confirm in the Coolify logs.

### Part 1 checks still to run (host / Coolify)

```sh
# Coolify activity/audit: UI -> Activity, filter resource wjrlh3ijc8qu5ohzlfearx3f,
# 2026-09-12 11:00-11:20 UTC. Also check the resource's Scheduled Tasks tab.

docker logs --since 2026-09-12T11:00:00 --until 2026-09-12T11:20:00 coolify           2>&1 | grep -iE "stop|wjrlh3ijc8qu5ohzlfearx3f"
docker logs --since 2026-09-12T11:00:00 --until 2026-09-12T11:20:00 coolify-realtime  2>&1 | grep -iE "stop|wjrlh3ijc8qu5ohzlfearx3f"
docker logs --since 2026-09-12T11:00:00 --until 2026-09-12T11:20:00 coolify-sentinel  2>&1 | grep -iE "stop|wjrlh3ijc8qu5ohzlfearx3f"

# Docker daemon: exact stop reason / caller
journalctl -u docker --since "2026-09-12 11:00" --until "2026-09-12 11:20" \
  | grep -iE "wjrlh3ijc8qu5ohzlfearx3f|hasBeenManuallyStopped|stop"

# Host activity
last -x | head -40
crontab -l; sudo crontab -l
systemctl list-timers --all
grep -rE "docker stop|compose (down|stop)" /root/.bash_history /home/*/.bash_history 2>/dev/null

# GitHub: repo -> Settings -> Webhooks -> Recent Deliveries (was a stop/deploy triggered?)
# Coolify: UI -> Keys & Tokens (tokens that could call the stop API)
```

## Restart policy analysis (why no policy change was made)

All long-running services already use `restart: always`; only the one-shot `init`
service is `restart: "no"`.

Docker semantics relevant to this incident:

- An explicit `docker stop` / `compose stop` / `compose down` sets
  `hasBeenManuallyStopped=true`. The restart policy is **not** applied after an explicit
  stop — the container stays down until it is started again or the Docker daemon
  restarts. This is exactly what happened here.
- On Docker daemon restart, `always` restarts even containers that were manually
  stopped; `unless-stopped` does **not**. Switching to `unless-stopped` would therefore
  weaken recovery, not strengthen it.
- Conclusion: no restart policy can recover from an externally issued stop command.
  Recovery needs an external watchdog (added below) or a Docker daemon restart.

## Resilience changes made

1. **Healthchecks added** (`docker-compose.yaml`) so Docker/Coolify can report accurate
   service status instead of stale "Success":
   - `api` → `GET /readyz` (checks the database) via Node `fetch`
   - `admin`, `customer` → `GET /` on port 3000 via Node `fetch`
   - `nginx` → `GET /nginx-health` (new location in `infra/nginx/nginx.conf`, returns
     200 without touching upstreams)
   All have `start_period` to avoid boot flapping.
2. **Uptime watchdog** (`scripts/uptime-watchdog.sh`): checks admin/customer/api every
   run, posts a webhook alert on the first failure and on recovery (state-deduplicated),
   and with `SELF_HEAL=1` restarts stopped containers of the compose project (skipped
   while a deploy is running). Install on the host:
   ```sh
   # /etc/cron.d/isp-watchdog
   */2 * * * * root ADMIN_URL=https://admin.hikonnectng.com \
     ALERT_WEBHOOK_URL=<slack-or-discord-webhook> \
     COMPOSE_PROJECT=wjrlh3ijc8qu5ohzlfearx3f SELF_HEAL=1 \
     /opt/isp/scripts/uptime-watchdog.sh >> /var/log/isp-watchdog.log 2>&1
   ```
3. **Coolify notifications** (host-side, verify in your Coolify version): Coolify →
   Settings → Notifications — add a channel (Email/Discord/Slack/Telegram) and enable
   container-status and deployment-failure events. This is the simplest built-in
   "someone gets told" mechanism and complements the watchdog.

## Runbook: stack down (503 `no available server`)

1. Check container state:
   ```sh
   docker ps -a --format '{{.Names}}\t{{.Status}}' | grep wjrlh3ijc8qu5ohzlfearx3f
   ```
2. If containers exist but are `Exited`/`Created` (stopped, not removed) — the incident
   scenario — start them again:
   ```sh
   docker start $(docker ps -aq -f label=com.docker.compose.project=wjrlh3ijc8qu5ohzlfearx3f \
     -f status=exited -f status=created)
   ```
   or just run `SELF_HEAL=1 scripts/uptime-watchdog.sh`.
3. If containers are missing, redeploy from Coolify.
4. Verify: `curl -fsS https://api.hikonnectng.com/healthz` returns 200 and the three
   domains load.

## Follow-ups

- Complete the Part 1 host checks above and update this document with the trigger (or
  record definitively that it is undeterminable).
- Configure the Coolify notification channel (host-side action).
- Consider Coolify's own "container status changed" monitoring as a second alert path.
