# Code quality audit (2026-11-02)

Scope: every file that ships or runs — `js/` (21 files), `api/` (4), the 5 HTML pages, `sw.js`,
`scripts/` (4), `supabase/` SQL, `tests/` (5), `vercel.json`, `package.json`.
About 12,000 lines of hand-written JS; no framework, no build, **zero npm dependencies**, one
vendored library (`vendor/qrcode.js`, Kazuhiko Arase, MIT, loaded only on QR screens).

## Method

* **Reachability scan** (script kept outside the repo): every top-level `function`, `const`/`let`
  and every `A.<action>` handler, counted against every JS and HTML file. Because this app is
  plain scripts sharing one global scope and actions are wired by `data-act="name"` strings, the
  scan treats both identifiers and quoted strings as uses, and every candidate was then checked
  by hand (including the tests, which load `domain.js` directly).
* **Duplicate scan:** identical one-line helper bodies across files, then manual review of the
  shared patterns (escaping, money, dates, API calls, permission checks).
* **Pattern scan for AI-typical mistakes:** TODO/FIXME, swallowed errors, hardcoded ids and test
  values, `console.log`, fake fallbacks, timezone handling, money rounding.
* No TypeScript and no linter exist in this project, so "type check" and "lint" do not apply;
  `node --check` was run on every changed file.

## Findings and fixes

| # | Kind | Where | Finding | Action |
|---|---|---|---|---|
| 1 | **Bug (security-relevant)** | `js/ui-ops.js` `A.staffremove` | Removing a staff member disabled their login with `.catch(() => {})`. If that call failed (offline, or a manager without authority over that login — now refused by the stricter API), the record said "removed" while **the login still worked**, and nobody was told. The sibling `A.staffactive` already reported the error. | Error is now shown: "Their login is still active: …" (with Hindi). |
| 2 | Dead code | `js/core.js` `nowTime`, `ring` · `js/domain.js` `pvKind`, `attPeriodName` · `js/ui-settings.js` `setPath` | Defined, never called anywhere (app, HTML or tests). Leftovers of replaced implementations. | Removed (5 functions). |
| 3 | Duplicate | `js/domain.js` `newJoinKey` = `js/ui-ops.js` `newVisitKey` | Byte-for-byte the same QR-key generator in two files. | One `newQrKey()` in `domain.js`; 3 call sites updated. |
| 4 | Accessibility | Owner home, card header "Open" link | 17 px tall tap target (WCAG 2.2 minimum is 24 px). | Padding with matching negative margin → 25 px, no layout change. |
| 5 | Duplicate (kept) | `join.js`, `site.js`, `visit.js`, `pay.js` each define `esc`; `join.js`/`visit.js` share `fail` and `val` | These four pages are deliberately standalone (they never load the app's `core.js`, so a QR page stays tiny on a cheap phone). A shared file would add a request to every QR scan for a 1-line helper. | Kept on purpose; documented here. |
| 6 | Reported false positives | `superOnly`, `resOnly`, `resMod`, `meterField`, `blockField` | Used through object spread (`...superOnly`), which the scan missed. `sitePhotos`, `siteLive`, `penaltyList`, `auditStock` are used by the tests. | Kept. |

## Checked and found sound

* **No TODO/FIXME/HACK**, no `console.log` left in shipped code, no hardcoded uuids, no test phone
  numbers or fake fallback data in the production path. The demo data generator is only reachable
  in demo mode or for the hostel flagged `settings.demo`.
* **Swallowed errors (25 `.catch(() => {})`):** all reviewed. Apart from #1 they are best-effort
  steps that are retried or harmless — outbox flushes (retried on the next sync), language and QR
  library loading (fall back to English / retried), service-worker registration, clean-up deletes
  after a failed create in `api/admin.js` (the original error is re-thrown).
* **Dates:** calendar dates are built from the phone's local date (`iso(new Date())`), never from
  `toISOString()` (which would roll to the previous day before 05:30 IST); the server uses an
  explicit IST offset. **Money:** `round2` everywhere, the stock ledger in whole paise.
* **Escaping:** one `esc()` and an escaping `li()` helper in the app; the strict CSP blocks inline
  script as a second line of defence.
* **Server/client contracts:** the three API files validate every id as a uuid and every action
  name against a whitelist; the browser only ever sends JSON bodies those handlers expect.

## Architecture notes (no change made)

* Responsibilities are already split sensibly: `core.js` (helpers, UI primitives), `data.js`
  (storage, sync, Supabase calls), `domain.js` (business rules, no DOM), `ui-*.js` (screens),
  `api/` (privileged server actions), `supabase/schema.sql` (authorization).
* Large files (`domain.js` 1,634 lines, `ui-owner.js` 1,102) are big but cohesive; splitting them
  would add script requests without changing behaviour.
* No circular dependency problem: scripts load in a fixed order from `index.html`.

## Verification

* `npm test`: **131 / 131 pass** after every change.
* `node --check` on every edited file.
* Browser (in-browser demo build of the same source, 360 / 768 / 1024 px): all 19 owner screens
  plus the resident, cook, housekeeping, laundry, guard and super-admin screens render with no
  JS errors, no `undefined`/`NaN` text and no horizontal overflow.
