# Deployment checklist

Three pieces: **broadcast API** (VPS), **admin** (Netlify), **overlay** (Netlify). Hero PNG/WebM assets ship from git (`apps/overlay-web/public/heroes/`).

## 1. Broadcast API (Ubuntu / VPS)

```bash
cd ~/bpc-broadcast
git pull
npm ci
npm run build --workspace=@bpc/shared-types
npm run build --workspace=@bpc/state-manager
npm run build --workspace=broadcast-api
pm2 restart bpc-broadcast-api
```

**`apps/broadcast-api/.env` (required)**

| Variable | Notes |
|----------|--------|
| `NODE_ENV` | `production` |
| `PORT` | e.g. `8080` |
| `BROADCAST_SECRET` | Long random string; same value as overlay `VITE_SOCKET_TOKEN` |
| `CORS_ORIGINS` | Comma-separated: every admin + overlay Netlify URL and custom domain |
| `LEAGUE_ID` | Must match `league_*` CSV filenames |
| `STEAM_WEB_API_KEY` | For fetch league stats |
| `STATE_BACKEND` | `redis` recommended in production |

**League stats on disk:** `apps/broadcast-api/data/league-stats/` (or `LEAGUE_STATS_DIR`). After deploy: admin → **fetch league stats** or **reload CSV**.

**Verify**

```bash
curl -s https://broadcast.yourdomain.com/health/live
# Expect: "build": "2026-05-30" and applyPlayerMapping route when on latest main
```

Nginx: proxy `/` and `/socket.io/` to the API — see [`../nginx/bpc-broadcast.sample.conf`](../nginx/bpc-broadcast.sample.conf).

PM2 cwd should be `apps/broadcast-api` — see [`../pm2/ecosystem.config.cjs`](../pm2/ecosystem.config.cjs).

---

## 2. Admin (Netlify) — site A

Use **repo root** as base (reads root `netlify.toml`).

| Setting | Value |
|---------|--------|
| Build command | `npm ci && npm run build:admin` |
| Publish directory | `apps/admin-web/dist` |
| Node version | `22` |

**Environment variables (optional)**

| Variable | Example |
|----------|---------|
| `VITE_ADMIN_API_ORIGIN` | `https://broadcast.yourdomain.com` |

Producers still set API origin + bearer in the **API link** panel (saved in browser). Env vars are only defaults.

---

## 3. Overlay (Netlify) — site B (separate Netlify site)

**Option A — base directory `apps/overlay-web`** (uses `apps/overlay-web/netlify.toml`):

| Setting | Value |
|---------|--------|
| Base directory | `apps/overlay-web` |
| Build command | `cd ../.. && npm ci && npm run build:overlay` |
| Publish directory | `dist` |

**Option B — repo root**

| Setting | Value |
|---------|--------|
| Build command | `npm ci && npm run build:overlay` |
| Publish directory | `apps/overlay-web/dist` |

**Environment variables (required at build time)**

| Variable | Example |
|----------|---------|
| `VITE_BROADCAST_API_ORIGIN` | `https://broadcast.yourdomain.com` |
| `VITE_SOCKET_TOKEN` | Same as `BROADCAST_SECRET` |

Redeploy overlay after changing these.

**OBS browser sources (1920×1080, transparent)**

| Route | Use |
|-------|-----|
| `/draft` | Draft + pick stats |
| `/startingsoon` | Game start countdown |
| `/herostats` | Hero / player stats cards |
| `/matchup` | Matchup |
| `/playerstats` | Player stats |
| `/lowerthird` | Lower third |
| `/sponsors` | Sponsors |

SPA routing: `public/_redirects` → `/* /index.html 200` (copied to `dist` on build).

---

## 4. Pre-push verification (local)

```bash
npm ci
npm run build:deploy
```

Confirm:

- `apps/admin-web/dist/index.html` exists
- `apps/overlay-web/dist/index.html` exists
- `apps/broadcast-api/dist/index.js` exists

Do **not** commit `dist/` (gitignored); Netlify and VPS build on deploy.

---

## 5. GSI (caster PC)

Copy [`GSI.cfg`](GSI.cfg) into Dota `cfg/` and set URL to your API (e.g. `https://broadcast.yourdomain.com/gsi`). See repo `infra/docs/GSI.cfg`.

---

## 6. Common issues

| Symptom | Fix |
|---------|-----|
| Netlify “publish directory does not exist” | Set build command; root admin uses `apps/admin-web/dist` |
| Overlay socket fails | `CORS_ORIGINS` + matching `VITE_SOCKET_TOKEN` / `BROADCAST_SECRET` |
| 404 on apply player mapping | Pull latest API, rebuild, `pm2 restart` |
| No lane stats | Re-fetch league stats; reload CSV on server |
| Missing hero portraits on overlay | Commit `apps/overlay-web/public/heroes/` or run download scripts before push |
