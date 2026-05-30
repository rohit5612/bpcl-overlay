## BPC Broadcast System

Isolated monorepo for Dota 2 **YouTube** OBS overlays and a **producer** dashboard. Tournament site `dotatourney.onrender.com` stays separate — no shared coupling.

### Dev (no Redis, no Postgres)

1. `cp apps/broadcast-api/env.example .env` and set `BROADCAST_SECRET` (8+ chars).
2. `npm install`
3. `npm run heroes:download-cdn-portraits` and `heroes:download-cdn-webms` (commit `apps/overlay-web/public/heroes/` for Netlify — no CDN download on deploy)
4. Terminal A: `npm run dev:bpc-api`
5. Terminal B: optional `VITE_SOCKET_TOKEN=<secret> npm run dev:overlay`
6. Terminal C: optional `npm run dev:admin`

Upload roster CSV from [`data/roster/players_roster_prepared.csv`](data/roster/players_roster_prepared.csv) in admin. Team logos live in `apps/overlay-web/public/teams/`.

Point admin “API origin” at `http://127.0.0.1:8080` and paste the same bearer secret. Overlay dev: set `VITE_BROADCAST_API_ORIGIN` + `VITE_SOCKET_TOKEN` in `apps/overlay-web/.env` (production overlay requires handshake token unless `NODE_ENV=development` on API).

Routes: overlay browser sources load paths `/draft`, `/game`, `/lowerthird`, `/playerstats`, `/herostats`, `/matchup`, `/pause`, `/startingsoon`, `/postgame`, `/sponsors`.

### Build

```bash
npm run build:deploy
```

(or `npm run build --workspaces --if-present`)

### Deploy (production)

Full checklist: **[`infra/docs/DEPLOY.md`](infra/docs/DEPLOY.md)**

| Component | Host | Notes |
|-----------|------|--------|
| **broadcast-api** | VPS + PM2 | `npm run build --workspace=broadcast-api`, nginx + `/socket.io/` |
| **admin-web** | Netlify site A | Root `netlify.toml` → `apps/admin-web/dist` |
| **overlay-web** | Netlify site B | `npm run build:overlay` → `apps/overlay-web/dist`, set `VITE_*` env |

Netlify **admin**: build `npm ci && npm run build:admin`, publish `apps/admin-web/dist`.

Netlify **overlay**: separate site; build `npm run build:overlay`, publish `apps/overlay-web/dist`; env `VITE_BROADCAST_API_ORIGIN` + `VITE_SOCKET_TOKEN` (must match API `BROADCAST_SECRET`).

Game start timer OBS source: `https://<overlay>/startingsoon` — control from admin **Game start timer** panel.

Also: [`infra/nginx/bpc-broadcast.sample.conf`](infra/nginx/bpc-broadcast.sample.conf), [`infra/pm2/ecosystem.config.cjs`](infra/pm2/ecosystem.config.cjs), [`infra/docs/OBS.md`](infra/docs/OBS.md).

### Stack

Express + Socket.io (`broadcast-api`), React + Vite + Tailwind + Framer Motion (`overlay-web`, `admin-web`), shared Zod schemas (`packages/shared-types`), Redis/memory state adapters (`packages/state-manager`).

