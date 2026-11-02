# Sarvlekh (HostelOS) — Production Readiness Report

Audit date: 2026-11-02 · Scope: `R&D/HostelOS` (static PWA + 3 Vercel functions + Supabase project `hostels`, ap-south-1)
A full copy of the folder was taken before any change (the folder is not a git repository).

---

## 1. Executive summary

The codebase is in good shape for its size: no build step, no npm dependencies, row-level
security on every table, a strict Content-Security-Policy, bounded and timed-out server calls,
deterministic IDs that make automation idempotent, and 128 passing tests at the start.

The audit found **one High-severity authorization flaw that is live in the database today**
(a hostel-scoped manager can make themselves manager of every hostel in their client) and two
related API weaknesses, plus a cost bug and a latency problem that would have shown up on Vercel.
The API-side fixes are done and tested. **The database fix is written and verified but not yet
applied** — applying it needs your approval.

There is also no Vercel project for this app yet, the local/dev setup writes to the same
Supabase project that production would use, and a backup has never been restored end to end.

**Verdict: CONDITIONALLY READY** — see §11 for the exact list.

## 2. Application inventory

| Area | What it is |
|---|---|
| Frontend | Plain JS PWA, no framework, no build (`index.html`, `js/*.js`, `css/`). Hindi + English. Offline-first local store + outbox + delta sync. Service worker caches the shell. |
| Public pages | `site.html` (hostel advert page, `/h/<slug>`), `join.html` (resident self-registration QR), `visit.html` (visitor gate QR), `pay.html` (UPI pay link). |
| Backend | 3 Vercel Node functions: `api/admin.js` (logins, passwords, clean-up, backups, Drive), `api/public.js` (QR pages, public page), `api/wa.js` (optional WhatsApp gateway — shelved). Shared `api/_lib.js`. No dependencies. |
| Database / auth / storage | Supabase: Postgres (`orgs, hostels, profiles, members, docs, wa_gateways, drive_link`), Supabase Auth (user ID → `<id>@login.hostelos.app` email), private Storage buckets `docs` (ID papers) and `backups`. |
| Scheduled work | One Vercel cron, daily 21:30 UTC → `/api/admin?cron=sweep` (delete expired papers, weekly per-hostel backup). |
| Integrations | WhatsApp via `wa.me` links (no API), UPI via `upi://` links (no gateway), optional Google Drive backup copy, OpenStreetMap / BigDataCloud reverse-geocoding from the browser. |
| Roles | super admin · owner · manager · accountant · cook · housekeeping · laundry · guard · staff · resident, plus per-member `perms`/`deny` and per-block scoping. Multi-tenant: client (org) → hostels. |
| Data today | 4 clients, 4 hostels, 9 records, 5 memberships, 12 MB database (11.3 MB is Supabase's own tables). |

## 3. Testing report

| Suite | Before | After | Notes |
|---|---|---|---|
| `npm test` (node:test, no network) | 128 / 128 pass | **131 / 131 pass** | +3 new tests: cross-client hostel attach, password-reset authority, public page gates + CDN caching. 1 existing test updated for the GET change. |
| RLS exploit test on live schema (rolled back) | escalation **succeeded** | escalation **blocked**, legitimate edits still work | Run inside a transaction that always rolls back. Nothing persisted. |
| Supabase security advisor | 0 errors; 20 "definer function callable" warnings, 1 "leaked-password protection off" | same | All 20 functions were read and each checks `is_super()` / `full_hostels()` itself — intended. |
| Supabase performance advisor | 7 "unused index" infos | same | Meaningless at 9 rows; indexes match the sync/RLS query patterns. Kept. |
| Browser smoke test (live local server, 375 px and desktop) | — | pass | `site`, `/h/<slug>`, `join`, `visit`, `pay` render, no horizontal overflow, correct refusals for a wrong QR key and a page that is switched off. Admin console (Clients, Users, Usage & health) loads with no console errors. Framing is refused (CSP `frame-ancestors 'none'` + `X-Frame-Options`). |
| Lint / type check / build | n/a | n/a | No linter, no TypeScript, no build step in this project. |
| Dependency audit | n/a | n/a | Zero npm dependencies; one vendored file (`vendor/qrcode.js`). |

**Not tested** (and why):
* Owner/manager/staff/resident screens end to end in a browser: needs logging in as those
  users on the real Supabase project; I do not type passwords into a production login. Business
  logic for these screens is covered by `tests/domain.test.js` (billing, advances, penalties,
  ledger, attendance, deterministic IDs, demo data).
* Load testing: `scripts/loadtest.js` exists, but it should run against a separate test
  project, not the one production will use.
* Backup **restore**: never run against a separate project (see §10).
* Real Vercel behaviour (CDN caching, cron delivery, region): there is no Vercel project yet.

## 4. Bugs and issues

| # | Severity | Module | Root cause | Fix | Verified |
|---|---|---|---|---|---|
| 1 | **High** | DB `members` RLS / grants | `authenticated` had UPDATE on every column of `members`; the policy only checked the org. A manager of ONE hostel could rewrite any member row in the client to `user_id = self, hostel_id = null, role = manager` and gain every hostel. Demonstrated on the live schema (rolled back). | `supabase/2026-11-02_members_lockdown.sql`: only `role, perms, deny, block, active` updatable; hostel-scoped admins can edit only their own hostels' members. Also appended to `schema.sql`. | Fix proven in a rolled-back transaction. **Applied to production by the owner on 2026-11-02** (policy text confirmed). Verified on production with `supabase/verify_members_lockdown.sql`: column grants correct, all SECURITY DEFINER functions pin `search_path` and are closed to anon, runtime tests a–h all PASS (rolled back). |
| 2 | High | `api/admin.js` set_password / set_active | Authority was checked with `some()`: owner of client B could reset the password of a person who is *also* a manager in client A, then log in as them there. Peers could reset another manager; the super admin's login was not excluded. | Caller must cover **every** membership of the target; only an owner (or super) resets a manager; a super admin's login can't be reset by anyone else. | New test, pass |
| 3 | Medium | `api/admin.js` create_user / add_member | `hostel_id` was not checked to belong to `org_id`. RLS ignores such a row, but `api/wa.js` (`hostelAccess`) would have honoured it. | `assertAdmin` now loads the hostel and requires `hostel.org_id === org_id` (for super admin too). | New test, pass |
| 4 | Medium (cost) | `api/public.js` + `js/site.js` | Public page was fetched with **POST**. Vercel's CDN never caches POST, so `s-maxage=300` did nothing: every reader cost a function call + 2 DB reads. | Page uses GET (`/api/public/site?s=…`); POST still accepted for phones holding the old page. | New test, pass; checked on local server |
| 5 | Medium (latency) | `vercel.json` | Functions would run in Vercel's default region `iad1` (US East) while the database is in Mumbai. Each API call makes 2–5 sequential DB round trips. | `"regions": ["bom1"]` (Hobby allows one region of choice) and `maxDuration: 10` for `api/*.js`, matching the code's own 8 s timeouts. | Config only; confirm after first deploy |
| 6 | Medium | Operations | Local dev and the test fixtures write to the same Supabase project production will use (4 `@test.local` auth users and a "Rival Hostels Ltd" client exist there now). | Documented in `ENVIRONMENT_VARIABLES.md`; not deleted (needs your OK). | — |
| 7 | Low | Auth | Admin password was changed on request in chat today, so it now sits in a chat log. | Change it again from the app. | — |

## 5. Security report

Checked and found sound: SQL/PostgREST injection (all ids validated as uuid, slugs regex-checked,
values URL-encoded), XSS (shared `esc()`/`li()` escape by default; strict CSP blocks inline
script anyway), clickjacking (verified), CORS (functions set none, so browsers refuse
cross-origin reads), secrets (service-role key only in env; nothing secret in served files;
`.env*` excluded from git and Vercel upload; dev server refuses dot-files), cron auth (constant-
time compare), setup key (constant-time, rate-limited), Drive OAuth state (HMAC + expiry), file
uploads (one-time signed URLs, path pinned to the application's own folder, 3 MB + MIME limit
enforced by the bucket), storage RLS (owner/manager of that hostel only), tenant isolation in
RLS (`my_access()` joins hostel to org, so a cross-org membership grants nothing), and every
SECURITY DEFINER function checks its caller.

Remaining risks:
* **Default password = mobile number** for new logins. Anyone who knows a person's user ID and
  phone can log in. Consider making staff/owners change it on first login. (Business decision,
  not changed.)
* **Leaked-password protection is off** in Supabase Auth. Turn it on if your plan includes it.
* Rate limits in `api/*` are in-memory per warm instance — they stop casual abuse, not a
  distributed attack. Sign-in brute force is limited by Supabase Auth's own limits (check them
  in the dashboard).
* Any non-resident staff role can **create** (not read or change) invoice rows; this is how
  laundry staff bill extra pieces. A cook could therefore add a bogus charge. Low impact,
  visible to the owner; tighten later by role if needed.
* `api/wa.js` lets an owner point the server at any `https` URL (their own gateway). Low SSRF
  risk on Vercel; the feature is shelved.

## 6. Database report

* Schema: primary key `(hostel_id, id)` on `docs`, a trigger forbids moving a record between
  hostels or changing its kind, `updated_at` maintained by trigger for delta sync.
* Indexes: `docs_sync (hostel_id, updated_at)` serves the only hot query (delta sync);
  `docs_kind`, `docs_res`, `docs_room`, `docs_day` serve RLS and clean-up. No new indexes added —
  there is no measured slow query at 9 rows, and adding indexes blindly costs writes.
* Connections: no pooled connections to manage — the browser and the functions use Supabase's
  HTTP API (PostgREST), so serverless cold starts cannot exhaust Postgres connections.
* Writes: batched (one upsert per outbox flush); sync is one GET returning only changed rows.
* Policies use `(select fn())` wrappers so helper functions run once per query, not per row.

## 7. Free-tier and cost report

Limits below are what the project's own README and earlier load estimate assume. **Re-check
them on the providers' pricing pages before launch** — the docs search available to me did not
return the plan pages, so I have not re-verified them today.

| Provider | Used for | Key limits to watch | What happens at the limit |
|---|---|---|---|
| Vercel Hobby | Static files, 3 functions, 1 daily cron | Function invocations/duration, bandwidth, 1 region, daily-only cron. **Hobby is intended for personal, non-commercial use** — confirm in Vercel's fair-use terms; a paid SaaS normally needs Pro. | Deployments paused / upgrade required |
| Supabase Free | Postgres (500 MB), Auth, Storage (1 GB), egress | DB size, egress, storage; **free projects pause after a period of inactivity**; **no automatic backups** (the app makes its own weekly ones) | Read-only / paused project |
| Google Drive | Optional backup copy | User's own Drive quota | Copy fails, Supabase backup unaffected |
| WhatsApp / UPI | `wa.me` and `upi://` links | None (no API) | — |

Earlier estimate for ~100 residents per hostel: about 2,100 REST requests/day and 30–60 MB
egress/month per hostel; comfortable at 30–50 hostels on Supabase Free (estimate, not measured).

| Resource | Current implementation | Problem | Optimization | Expected benefit |
|---|---|---|---|---|
| Serverless | Public page fetched by POST | CDN can't cache POST | GET + `s-maxage=300` | Repeat readers within 5 min cost 0 function calls and 0 DB reads (was 1 + 2 each) |
| Serverless | Default region `iad1` | DB in Mumbai, 2–5 round trips per call | `regions: ["bom1"]` | Removes an intercontinental hop per DB call (not measured — no deployment yet) |
| Serverless | No explicit max duration | A hung call could run to the platform maximum | `maxDuration: 10` | Bounded cost per invocation |
| API / DB | Delta sync, adaptive polling (staff 1→5 min, residents 3→10 min, paused when hidden) | Already optimised | None needed | — |
| Storage | Papers compressed in browser to ~100–150 KB, deleted 30 days after checkout; 4 backups kept per hostel | Already optimised | None needed | — |
| Frontend | 15 files, 568 KB raw / **182 KB gzip** app shell, cached by the service worker; Hindi strings, reports and Excel export load on demand | Acceptable | None | — |

## 8. Performance report

* App shell: 567,587 B raw, 181,693 B gzip (measured). After the first visit it is served from
  the service-worker cache.
* Public page API on the local server (this PC → Supabase Mumbai): 0.51 s cold, 0.17–0.19 s warm
  (measured, 3 runs). On Vercel with the CDN, a cached hit should not reach the function at all.
* README records the per-resident index cutting a 120-resident render from 4.9 ms to 0.3 ms.
* Core Web Vitals not measured (no deployed URL).

## 9. Vercel compatibility report

| Check | Status |
|---|---|
| Framework / build | None needed. Framework preset **Other**, no build command, output directory = project root. |
| Root directory | `R&D/HostelOS` if the repository root is above it. |
| Functions | `api/*.js` CommonJS, Node ≥ 18, no dependencies; `_lib.js` is not routed (underscore). |
| No server state relied on | In-memory caches (15 s login cache, rate-limit buckets, Google token) are optimisations only. |
| No local filesystem writes | Correct — backups go to Supabase Storage. |
| Long work | Sweep and backups are time-boxed (~6.5 s) and resume the next day. |
| Rewrites | `/h/:slug` → `site.html`, `/api/public/:sub` → `/api/public?sub=`. |
| Headers | CSP, nosniff, frame denial, referrer policy, HSTS, cache rules — in `vercel.json`. |
| Cron | Daily, fits Hobby. Requires `CRON_SECRET`. |
| Region | `bom1` (added). |
| Env vars | Documented in `ENVIRONMENT_VARIABLES.md`. |
| Deployed? | **No Vercel project exists for this app yet.** |

## 10. Remaining risks

1. ~~Database fix #1~~ applied and verified on production 2026-11-02 (all 11 runtime checks PASS).
2. No separate staging database; tests and local work share the production project.
3. Backup restore never tested on a separate project. `scripts/restore.js` can now target staging (`SUPABASE_URL` in `.env.local`) and create the client/hostel rows (`--with-hostel`); tested against a local mock only.
3a. **ID papers are not in any backup.** The weekly backup holds records only; files in the Storage bucket `docs` (Aadhaar, photos, police papers) have no second copy. Supabase database backups do not include Storage objects either. Decide how to copy that bucket (e.g. a periodic download by the super admin) before relying on it.
4. Role-specific screens not clicked through in a browser (covered by unit tests only).
5. Vercel Hobby commercial-use terms and current free-tier limits not re-verified today.
6. Supabase Free pauses idle projects and has no provider backups or SLA.
7. Weak default passwords (mobile number).

## 11. Deployment checklist

Before the first production deploy:

1. ~~Apply and verify `supabase/2026-11-02_members_lockdown.sql`~~ (done and verified 2026-11-02). Re-run `supabase/verify_members_lockdown.sql` after any future change to `members` policies or grants.
2. Create a second Supabase project for staging (Mumbai region). In its SQL editor run `supabase/schema.sql` (it already contains the lock-down). Put its `SUPABASE_URL`, `SUPABASE_ANON_KEY` and service-role key in `.env.local`; `npm run dev` then prints `database: … (STAGING)` and serves the whole app against it without editing `js/config.js`. Create one test login per role (owner, manager, staff, resident) there and click through each role on mobile and desktop.
3. Vercel plan: **Pro** for a paid service. Hobby is for personal, non-commercial projects; Pro is $20/month per member with usage credit included (check current terms on vercel.com/pricing before signing up).
4. Push the folder to a private GitHub repository (`.env*` stays out — already ignored).
5. Vercel → New Project → import the repo → Framework **Other**, Root Directory `R&D/HostelOS` (if applicable), no build command, output directory empty/default.
6. Environment Variables (Production only): `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`. Preview: the staging project's key and `SUPABASE_URL`.
7. Deploy a **Preview** first; run the smoke tests below on the preview URL against staging.
8. Promote to Production. Add the custom domain (Vercel → Domains) and set `PUBLIC_SITE_BASE` in `js/config.js` to it, then run `npm run release` and redeploy so phones pick up the new version.
9. Add the production domain to Supabase → Auth → URL configuration.
10. Change the admin password (it appeared in chat). Delete the `@test.local` users and test clients from the production project once you no longer need them.
11. Test a restore: Supabase (production) → Storage → `backups` → download one file; with staging values in `.env.local` run `node scripts/restore.js <file> --yes --with-hostel` (it prints the target project first); log in on staging as super admin, attach a test owner to the restored hostel and check residents, bills and payments match.

Post-deploy smoke tests (read-only, a few minutes):
* `/` loads, log in as super admin, Clients / Users / Usage pages open, no console errors.
* `curl -I https://<domain>/api/public/site?s=<slug>` twice — second response shows `x-vercel-cache: HIT` for a hostel whose page is on.
* Wrong QR key on `join.html` / `visit.html` shows "not valid any more".
* Vercel → Cron Jobs → run the sweep once; response JSON shows `removed` and `backup`.
* Vercel → Functions shows region `bom1`.

Rollback: Vercel → Deployments → previous deployment → **Promote to Production** (instant).
Database: the lock-down migration is permissions-only; to undo it, re-run the old
`members_admin_update` policy and `grant update on public.members to authenticated` from the
earlier part of `schema.sql`. No data changes to undo.

## 12. Final verdict

**CONDITIONALLY READY** — deployment requires the actions in §11, above all applying the
`members` lock-down (item 1), creating the Vercel project with `SUPABASE_SERVICE_ROLE_KEY` and
`CRON_SECRET`, and a tested backup restore.

### Files changed in this audit
* `api/admin.js` — `assertAdmin` (hostel must belong to client), `assertCanManageUser` (authority over every membership).
* `api/public.js` — public page accepts GET (CDN-cacheable).
* `js/site.js` — fetches the public page with GET.
* `vercel.json` — `regions: ["bom1"]`, `functions."api/*.js".maxDuration: 10`.
* `supabase/2026-11-02_members_lockdown.sql` (new) and the same block appended to `supabase/schema.sql`.
* `tests/api.test.js`, `tests/public.test.js`, `tests/csp.test.js` — new and updated tests.
* `ENVIRONMENT_VARIABLES.md`, `PRODUCTION_READINESS_REPORT.md` (new).
* `supabase/verify_members_lockdown.sql` (new) — read-only checks + always-rolled-back runtime test.
* `scripts/dev-server.js` — `SUPABASE_URL` + `SUPABASE_ANON_KEY` in `.env.local` switch the local app to a staging project.
* `scripts/restore.js` — targets `SUPABASE_URL` when set, prints the target, `--with-hostel` for an empty project.
