# Lighthouse audit report (2026-11-02)

**Lab data only.** No real-user (field / CrUX) data exists — the app is not deployed. Lab scores
depend on the emulated device, throttling and this PC's load; treat ±2 points as noise.

## What was measured

| | |
|---|---|
| Code | commit `bc8f46c` on `production-readiness` (the last source edit, 22:07:48, precedes the run; the commit at 22:11 contains exactly that code; working tree clean) |
| Tool | Lighthouse 12 (Node API) driving the installed Chrome through puppeteer-core 23 |
| Categories | Performance, Accessibility, Best Practices, SEO |
| Devices | **mobile** = Lighthouse default (Moto G Power, 412 px, simulated slow 4G, 4× CPU slowdown); **desktop** = Lighthouse desktop preset (1350×940, no throttling) |
| Runs | **3 per route per device**, fresh Chrome profile per run; median reported, every run listed |
| Planned / completed | 13 routes × 2 devices × 3 runs = **78 planned, 78 completed, 0 failed** (see table check below) |
| Tablet | not a Lighthouse preset; covered by viewport testing at 768 and 1024 px (see `REGRESSION_TEST_REPORT.md`) |

### Environments (no run used port 5175 or wrote to any database)

| Env | Server | What it is | Database |
|---|---|---|---|
| **A** | `localhost:5190` | Production-like static server (scratchpad script): serves the repo read-only with the exact `vercel.json` headers (CSP, cache rules), the `/h/:slug` rewrite and gzip — how Vercel serves it. No `/api` functions. | **None contacted.** `js/config.js` still names the production project, but with no saved session the app shows the login screen without any network call to Supabase, and Lighthouse never submits a form. The QR pages' `/api/public` calls get a 404 from this server. |
| **B** | `localhost:5191` | Same server with `DEMO=1`: `js/config.js` blanked, so the app runs on its built-in demo data in the browser. Signed-in screens were reached by the app's own "tap to try" demo logins before each audit (storage kept for the audit). The public hostel page was switched on from the demo owner's Settings first. | **None** — demo data lives in the test browser's localStorage only |

The old `localhost:5175` (production-connected dev server) and `localhost:5180` (stale copy) were not used.

## Results

Run-count check from the result file: `ROWS 26 | SUCCESSFUL RUNS 78 | FAILED RUNS 0`.

Env A = production-like server, no database. Env B = same with in-browser demo data. Values in brackets are the three individual runs; the number before them is the median.

### Mobile (Moto G Power emulation, slow 4G, 4x CPU throttling)

| Route | Env | Perf (median) | Perf runs | A11y | Best Pr. | SEO | LCP ms | CLS | TBT ms |
|---|---|---:|---|---:|---:|---:|---:|---:|---:|
| Login | A | 96 | 96/96/96 | 100 | 100 | 100 | 2699 (2647/2699/2745) | 0 | 39 (71/39/37) |
| Public hostel page (demo) | B | 100 | 100/100/100 | 100 | 96 | 100 | 1189 (1267/1189/1114) | 0 | 0 (0/0/0) |
| Join QR form | A | 100 | 100/100/100 | 100 | 96 | 63 | 1364 (1210/1364/1405) | 0 | 0 (0/0/0) |
| Visitor QR form | A | 100 | 100/100/100 | 100 | 96 | 63 | 1175 (1060/1203/1175) | 0 | 0 (0/0/0) |
| UPI pay page | A | 100 | 100/100/100 | 100 | 100 | 63 | 1357 (1057/1357/1363) | 0 | 0 (0/0/0) |
| Owner home | B | 98 | 98/98/97 | 100 | 100 | 100 | 2180 (2171/2180/2298) | 0 | 77 (52/77/86) |
| Owner residents | B | 98 | 98/98/97 | 100 | 100 | 100 | 2244 (2188/2244/2273) | 0 | 75 (68/75/109) |
| Owner payments | B | 98 | 98/98/98 | 100 | 100 | 100 | 2198 (2198/2211/2181) | 0 | 62 (80/61/62) |
| Owner reports | B | 98 | 98/98/98 | 100 | 100 | 100 | 2187 (2187/2198/2179) | 0 | 62 (73/59/62) |
| Owner settings | B | 98 | 98/98/98 | 100 | 100 | 100 | 2222 (2318/2198/2222) | 0 | 88 (61/92/88) |
| Resident home | B | 98 | 98/98/98 | 100 | 100 | 100 | 2186 (2185/2186/2189) | 0 | 29 (18/31/29) |
| Cook mess | B | 98 | 98/98/98 | 96 | 100 | 100 | 2190 (2190/2207/2177) | 0 | 30 (30/42/19) |
| Admin console | B | 97 | 97/97/97 | 95 | 100 | 100 | 2330 (2330/2321/2349) | 0 | 8 (14/8/5) |

### Desktop (1350x940, no throttling)

| Route | Env | Perf (median) | Perf runs | A11y | Best Pr. | SEO | LCP ms | CLS | TBT ms |
|---|---|---:|---|---:|---:|---:|---:|---:|---:|
| Login | A | 100 | 100/100/100 | 100 | 100 | 100 | 548 (548/553/548) | 0 | 0 (0/0/0) |
| Public hostel page (demo) | B | 100 | 100/100/100 | 100 | 100 | 100 | 277 (266/277/280) | 0 | 0 (0/0/0) |
| Join QR form | A | 100 | 100/100/100 | 100 | 96 | 63 | 339 (332/339/341) | 0.015 | 0 (0/0/0) |
| Visitor QR form | A | 100 | 100/100/100 | 100 | 96 | 63 | 305 (326/302/305) | 0.015 | 0 (0/0/0) |
| UPI pay page | A | 100 | 100/100/100 | 100 | 100 | 63 | 384 (385/380/384) | 0 | 0 (0/0/0) |
| Owner home | B | 100 | 100/100/100 | 100 | 100 | 100 | 524 (538/479/524) | 0 | 0 (0/0/0) |
| Owner residents | B | 100 | 100/100/100 | 100 | 100 | 100 | 505 (519/505/505) | 0 | 0 (0/0/0) |
| Owner payments | B | 100 | 100/100/100 | 100 | 100 | 100 | 516 (484/520/516) | 0 | 0 (0/0/0) |
| Owner reports | B | 100 | 100/100/100 | 100 | 100 | 100 | 503 (536/503/494) | 0 | 0 (0/0/0) |
| Owner settings | B | 100 | 100/100/100 | 100 | 100 | 100 | 506 (525/506/496) | 0 | 0 (0/0/0) |
| Resident home | B | 100 | 100/100/100 | 100 | 100 | 100 | 528 (540/528/510) | 0 | 0 (0/0/0) |
| Cook mess | B | 100 | 100/100/100 | 96 | 100 | 100 | 500 (473/518/500) | 0 | 0 (0/0/0) |
| Admin console | B | 100 | 100/100/100 | 95 | 100 | 100 | 544 (544/555/544) | 0 | 0 (0/0/0) |


## Summary

| | Mobile | Desktop |
|---|---|---|
| Routes with 100 in **all four** categories | 0 of 13 | 8 of 13 |
| Performance 100 | 4 of 13 (public pages) | **13 of 13** |
| Accessibility 100 | 11 of 13 | 11 of 13 |
| Best Practices 100 | 10 of 13 | 11 of 13 |
| SEO 100 | 10 of 13 | 10 of 13 |

**A Lighthouse 100 in every category on every route is not achieved.** The remaining gaps:

| Page(s) | Device | Metric, score | Cause | Fix | Expected impact |
|---|---|---|---|---|---|
| Join, Visitor, UPI pay | both | SEO 63 | `is-crawlable`: these pages carry `<meta name="robots" content="noindex">` | **None — intended.** They are private QR / payment pages and must not appear in Google. Removing `noindex` to score 100 would be wrong. | — |
| Join, Visitor | both | Best Practices 96 | `errors-in-console`: the test used a made-up hostel id and key, so `/api/public` answered with an error (404 on the test server; 403 on Vercel). A real QR scan with a valid key logs no error. | none needed; re-check on a deployed preview with a real QR | 100 with a valid key (expected, not measured) |
| Visitor | mobile (1 of 3 runs) / desktop | CLS 0.015 | the form appears after the key check, shifting the footer | reserve the form's height while loading | small; score already 100 |
| Public hostel page | mobile | Best Practices 96 | `font-size`: body text is now 12 px, but the many small labels (`calc(12 * --u)` ≈ 10.3 px) keep legible text under Lighthouse's 60 % | raise those labels to ≥ 12 px on phones (e.g. `max(12px, calc(12 * var(--u)))`) | expected 100 |
| Cook (mess), Admin console | both | Accessibility 96 / 95 | `color-contrast` on elements of those screens not covered by the global accent fix; `label-content-name-mismatch` on a button there | per-element fix after listing the nodes (not done: found in the final run, after the code was frozen and pushed) | expected 100 |
| Admin console | mobile | Performance 97 | also `offscreen-images` | lazy-load below-the-fold images there | +1–2 |
| All signed-in screens and login | mobile | Performance 96–98 | the full app (≈182 KB gzip, 15 scripts, owner screens included) is parsed before the first screen; LCP ≈ 2.2–2.7 s under 4× CPU throttling | load owner / operations / settings screens on demand, or add a minifying build step | expected 98–100; real architecture change |

Fixed during the audit (baseline → final, mobile): login Accessibility 94 → 100, owner screens
96 → 100, UPI pay page 92 → 100, public hostel page Accessibility and SEO → 100, CLS on the QR
pages 0.039–0.047 → 0 (mobile).

## Not measured

* Field data (real users) — no deployment.
* INP — not measurable in a navigation run; TBT (lab proxy) is 0–88 ms.
* Tablet as a Lighthouse device — Lighthouse has no tablet preset; tablet layouts were checked by
  viewport (768, 1024 px) without errors or overflow.
* Lighthouse on the deployed Vercel site (real gzip/brotli, CDN, HTTP/2, region).
