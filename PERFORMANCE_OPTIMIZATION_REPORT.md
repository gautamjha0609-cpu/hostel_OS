# Performance optimization report (2026-11-02)

Lab numbers only (Lighthouse and local measurements). There is no deployment yet, so there is no
real-user (field) data. Route-by-route scores are in `LIGHTHOUSE_AUDIT_REPORT.md`.

## Frontend

| Item | Measured | Notes |
|---|---|---|
| App shell (HTML + CSS + 15 scripts) | 568 KB raw, **182 KB gzip** | Served gzip/brotli by Vercel; cached by the service worker after the first visit |
| Loaded only when needed | Hindi dictionary (89 KB), QR library (55 KB), reports/Excel, super-admin console | already lazy (`loadScript`) |
| Public QR / pay / hostel pages | do not load the app at all — one small script each | already standalone |
| Images | login art is WebP; hostel photos are owner-pasted links (Google Drive thumbnails), lazy-loaded below the fold | |
| Fonts | system fonts only, no web-font download | |
| Layout shift | CLS 0 on the app; QR pages had 0.015–0.047 from an unsized logo → **fixed** (`width`/`height` set) | |
| Long lists | rendered in pages ("Show more"); per-resident index cuts a 120-resident render from 4.9 ms to 0.3 ms | existing |

**Not changed, by decision:** on a throttled mobile profile the login screen's LCP is ~2.2–2.7 s
because the whole signed-in app (owner screens included) is parsed before the first screen is
drawn. Getting mobile Performance from the high 90s to a steady 100 needs splitting the owner,
operations and settings screens into on-demand scripts (or a build step with minification).
That touches script loading for every screen of a working app and was judged not worth the risk
inside an audit; it is the first thing to do if mobile scores matter more than they do now.
Desktop Performance is 100 on every route.

## Backend and caching

| Item | Before | After |
|---|---|---|
| Public hostel page API | POST → never cached by the CDN; every reader = 1 function call + 2 DB reads | **GET + `s-maxage=300`**: repeat readers within 5 min are served from the CDN (no function, no DB) |
| Private responses | — | every `/api/admin` and `/api/wa` answer and every refusal sends `Cache-Control: no-store`; only a successful public-page answer is cacheable, and it holds no private data (name, address, phone, the owner's page settings) |
| Function region | Vercel default `iad1` (US) while the DB is in Mumbai | **`bom1`** in `vercel.json` |
| Function duration | platform default | `maxDuration: 10` for `api/*.js` (code already gives up on Supabase after 8 s) |
| Login check per call | cached 15 s per warm instance | unchanged |
| Database connections | none to manage: browser and functions use Supabase's HTTP API (PostgREST), so no pool can be exhausted | unchanged |
| Sync | delta sync, one GET returning only changed rows; polling backs off (staff 1→5 min, residents 3→10 min) and stops while the app is hidden | unchanged |

Measured locally (this PC → Supabase Mumbai, before deployment): public page API 0.51 s cold,
0.17–0.19 s warm.

## Database

9 rows of real tables today; indexes match the queries that exist (`docs (hostel_id, updated_at)`
for sync, partial indexes for RLS lookups). Supabase's "unused index" notices are expected at this
size and were not acted on. No N+1 patterns in `api/`: memberships and profile load in parallel,
backups page through 1,000 rows at a time inside a time budget.

## Not verified

* CDN cache hits, region and cold starts on real Vercel — needs a deployment (smoke test listed in
  `PRODUCTION_READINESS_REPORT.md` §11).
* INP — a lab Lighthouse navigation run does not measure it; TBT (its lab proxy) is 0–40 ms.
