# Session status — 24 November 2026

## Live deployment

- **Site:** https://layerup.host
- **Render service:** `n8n-from-scratch` (Docker, free plan), ID `srv-dc2o51brjlhs73da5veg`
- **Render URL:** https://n8n-from-scratch.onrender.com
- **GitHub:** https://github.com/Apurvomkar/n8n-from-scratch (branch `main`)
- **Database:** Render Postgres `n8n-db`, external URL in `DATABASE_URL`
- **Health check:** https://layerup.host/health → `{"status":"ok","workflows":3,"scheduled":0}`

## DNS (Hostinger)

| Type | Name | Value |
| --- | --- | --- |
| A | `@` | `216.24.57.1` |
| CNAME | `www` | `n8n-from-scratch.onrender.com` |

Both domains verified in Render with TLS certificates issued.

## Secrets (keep safe)

- `API_KEY` — bearer token required for all `/api` routes. Paste it into the
  editor's **API key** button. `/health` and webhooks remain public.
- `ENCRYPTION_KEY` — encrypts credential secrets at rest. Required to restore
  a backup.

## What is implemented

1. Graph workflow engine (branches, loops with iteration limits, back-edge detection)
2. Node registry: triggers, set/code/log/noOp, IF/switch/merge, HTTP/delay,
   Slack/email/SQLite integrations
3. `{{ ... }}` expressions; sandboxed Code node via `node:vm` with timeout
4. Express API: workflow CRUD, run, webhooks, cron scheduler, execution history
5. SQLite (default) and Postgres (`DATABASE_URL`) via a shared store interface
6. AES-256-GCM credential store with metadata-only API responses
7. React Flow editor: drag/drop nodes, wiring, config panel, credential picker,
   undo/redo, JSON import/export, live results and execution history
8. Bearer-token API authentication
9. Docker + Render deployment, `render.yaml`, backup/restore scripts

## Verification

- 22/22 tests pass; backend typecheck clean; UI production build clean
- Live: no API key → 401, correct key → 200, health/root → 200
- `npm run db:backup` tested locally and against production Postgres

## Outstanding action

- **Render free Postgres expires around 24 December 2026.** Before then,
  upgrade `n8n-db` to a paid plan (no code change), or migrate via the steps in
  `DEPLOY.md` ("Postgres expiry plan"). Keep `ENCRYPTION_KEY` unchanged.

## Local state

- Working tree clean; last commit `600a288`; branch `main` tracks `origin/main`
- Dev servers stopped (ports 3000 and 5173 free)

## Start / stop the live site

```powershell
npm run live:status   # running / suspended
npm run live:stop     # suspend https://layerup.host
npm run live:start    # resume it
```

Render API key is stored in `data\render-api-key.txt` (gitignored); service ID
is `srv-dc2o51brjlhs73da5veg`. Suspended/resumed states were tested successfully.

## Start / stop the local web page

From `D:\Open Code\n8n-from-scratch`:

```powershell
npm run web:start    # starts API (:3000) + editor (:5173) and opens the browser
npm run web:stop     # stops both
```

Run from the project folder. Or use `.\start.ps1` / `.\stop.ps1` directly
(`.\start.ps1 -NoBrowser` starts without opening the browser). Logs go to
`logs\`, and the running PIDs are recorded in `data\web-state.json` (both
gitignored). The live site at https://layerup.host is unaffected.
