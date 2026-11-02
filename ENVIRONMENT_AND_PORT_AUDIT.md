# Environment and port audit (2026-11-02)

Both ports are local Node processes on this PC, started 2026-11-02 ~20:25 IST by another Claude
desktop session (parent process: Claude.exe). Neither is "production hosting" — there is no
Vercel deployment of this app yet.

| | http://localhost:5175 | http://localhost:5180 |
|---|---|---|
| Process | PID 27572, `node …/R&D/HostelOS/scripts/dev-server.js` (with `PORT=5175`) | PID 4368, `node <other session's scratchpad>/serve-demo.js` |
| Source served | **The real project folder** `R&D/HostelOS` — current code | **A copy** in another session's temporary scratchpad (`…/scratchpad/demo/`), taken 2026-11-02 ~12:05 |
| Up to date? | Yes (static files and `api/*.js` are read from disk on every request) | **No — stale.** 13 files differ from the project (app.js, data.js, domain.js, report.js, ui-*.js, sw.js, css, vercel.json, config.js…); `js/mascot.js` is missing |
| Runtime / framework | Node ≥18, no framework, no build | Node, 20-line static file server |
| Env files loaded | `R&D/HostelOS/.env.local` (service-role key present; values not printed) | none |
| Supabase | `js/config.js` → `https://bbimfrhnsikpiztowlye.supabase.co` — **the production project** | `js/config.js` blanked (`SUPABASE_URL: ''`) → no database |
| `/api/*` | Live: runs the real `api/*.js` handlers with the production service-role key | None (404) |
| Auth | Supabase Auth of the production project | In-browser demo logins (localStorage) |
| Security headers / CSP | Yes (copied from `vercel.json`) | **No** |
| Data | **Real production data** — anything done on 5175 changes production | Made-up data inside one browser; wiped with site data |
| Shares a database with the other? | No | No |

So 5175 is "local code against the live database" and 5180 is "an old copy running the in-browser
demo". Different ports did mean different setups — but not dev vs. production in the usual sense.

## Problems with the current setup

1. **5175 writes to production.** Every local test, demo click or experiment on 5175 is a real
   change to the live client's database. The earlier test fixtures got into production this way.
2. **5180 is a second, drifting copy of the app** with no security headers, so a demo shown there
   is not the app that will be deployed.
3. The demo hostel in the database (Sarvlekh Demo PG, `settings.demo = true`) and the in-browser
   demo on 5180 are two different "demos".

## Recommended final configuration (implemented)

One codebase, one command, the database chosen by configuration:

| Purpose | Command | Database |
|---|---|---|
| Daily development | `npm run dev` with `SUPABASE_URL` + `SUPABASE_ANON_KEY` (+ the staging service-role key) in `.env.local` | **Staging** Supabase project |
| Offline / sales demo with no database | `npm run dev:demo` (port 5180 by default) | none — in-browser demo data, **same source** as the real app |
| Demo inside the real product | Log in to production as the platform admin → Sarvlekh Demo PG → Settings → demo data | production, the one flagged demo hostel |
| Production | Vercel (Mumbai `bom1`), production env vars only | production |

The dev server prints which database it is using on start
(`database: … (STAGING)`, `… (the one in js/config.js — production)` or `none - DEMO mode`).
`DEMO=1` was added to `scripts/dev-server.js` and `npm run dev:demo` to `package.json`; both were
checked in the browser (login screen with demo logins, all owner screens, no console errors).

## What to do with the two running processes

Neither was stopped — both belong to another session, and I can't see whether that session still
needs them.
* **5180:** safe to stop once nothing needs it; replace with `npm run dev:demo`.
* **5175:** keep until a staging project exists, then restart it with staging values in `.env.local`
  so local work no longer touches production.
