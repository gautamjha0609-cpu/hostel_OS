# Final release readiness report (2026-11-02)

**Verdict: CONDITIONALLY READY** — the code on `production-readiness` is in good shape and its
authorization holds on the live database, but it is **not deployed**, there is **no staging
environment**, real-database workflows per role have **not** been exercised, and the test data
cleanup is **awaiting approval**. Passing tests are not the same as a verified production system;
the blockers below are real.

Scope of this report: `R&D/HostelOS` at commit `bc8f46c` (pushed), plus the documentation added
after it. Details live in the linked reports; this page is the summary.

---

## 1. Completed and verified

Each item was executed and its result observed today.

| Area | What | Evidence |
|---|---|---|
| Authorization (live DB) | `members` lock-down applied by the owner; policy text, column grants (only `active, block, deny, perms, role`), all 25 SECURITY DEFINER functions (`search_path` pinned, not executable by anon) | owner's screenshots of `verify_members_lockdown.sql` parts 1–3 |
| Authorization (runtime) | 11/11 checks PASS: owner and own-hostel manager can edit staff; manager cannot touch another hostel, edit own membership, or change `user_id`/`org_id`/`hostel_id`; cook, other client's manager and anonymous refused | part 4, rolled back, synthetic data |
| API authorization | cross-client hostel attach refused; password reset/disable needs authority over every membership; super admin's login protected | `tests/api.test.js` (20 pass) |
| Automated tests | **131 / 131 pass** (domain 87, api 20, public 10, wa 9, csp 5), on the project and on a fresh copy of only the committed files | `npm test` |
| Code audit | 1 real bug fixed (staff removal hid a failed login disable), 5 dead functions removed, 1 duplicate merged, no TODOs / `console.log` / hardcoded ids / fake data | `CODE_QUALITY_AUDIT.md` |
| Screens, every role | 19 owner screens at 360/768/1024 px; resident, cook, housekeeping, laundry, guard, super admin screens: no JS errors, no `undefined`/`NaN`, no overflow; owner-only screens show nothing to other roles | in-browser demo build of the same source |
| Public page | public hostel page at 360/390/430/768/1024/1440 px: no overflow, body text ≥ 12 px | measured |
| Lighthouse | 78 / 78 runs completed (0 failed), medians and every individual run recorded; environments A/B, no database | `LIGHTHOUSE_AUDIT_REPORT.md` |
| Environments | 5175 = real code against **production**; 5180 = stale copy, no DB; one dev server now covers real / staging / demo | `ENVIRONMENT_AND_PORT_AUDIT.md` |
| GitHub | `production-readiness` pushed to the public repo without force; local = remote = `bc8f46c`, ahead/behind 0/0; no `.env*`, client-identifying files or service keys in the repo | `git rev-parse`, `git ls-remote`, GitHub contents API |
| Secret scan | committed files: only the public `anon` JWT (by design) | `GITHUB_RELEASE_REPORT.md` |
| Backup before cleanup | JSON export of all 6 public tables identical to live row-for-row, references resolve, 6 auth users listed; copied outside the repo, hash matched | `DATA_CLEANUP_PLAN.md` → Final review |
| Data inventory | the one real client (named in the local-only inventory); Sarvlekh Demo PG = the only `settings.demo` hostel; 2 clients + 4 `@test.local` logins = one seed transaction of test fixtures | `DATABASE_INVENTORY.md` |

## 2. Completed but not independently verified

| Item | Why not verified |
|---|---|
| `vercel.json` region `bom1`, `maxDuration: 10`, CDN caching of the public page | needs a Vercel deployment |
| Cleanup script `2026-11-02_remove_test_fixtures.sql` | reviewed statically only; not run anywhere (no staging, and no writes to production allowed) |
| Rollback script `2026-11-02_rollback_test_fixtures.sql` | generated from the backup; not run anywhere |
| `restore.js --with-hostel` against staging | tested only against a local mock server |
| Contrast / label / font fixes on screens Lighthouse did not open | fixed globally (one accent colour, one avatar rule); checked on the audited routes only |
| Hindi strings for the new messages | one string added; Hindi UI not reviewed screen by screen |
| JSON backup restore | completeness verified; an actual restore needs a non-production project |

## 3. Pending your approval

| Item | File | Note |
|---|---|---|
| Delete the test fixtures (2 clients, 2 hostels, 9 records, 4 memberships, 4 `@test.local` logins) | `DATA_CLEANUP_PLAN.md`, `supabase/cleanup/2026-11-02_remove_test_fixtures.sql` (local only) | The real client, Sarvlekh Demo PG and the admin are excluded by literal ids, cascade analysis and a before/after fingerprint that aborts the transaction on any difference. No undo after commit except the rollback script (logins return without passwords). |
| Remove 2 backup files of the fixture hostels in Storage | manual, after the above | |
| Stop the stale `localhost:5180` and move 5175 to staging | `ENVIRONMENT_AND_PORT_AUDIT.md` | processes belong to another session; untouched |

## 4. Remaining production blockers

1. **No staging Supabase project.** All local work on port 5175 still writes to production, and
   per-role workflows (create resident, take payment, upload ID papers, restore a backup) have
   not been run against a real database anywhere.
2. **Not deployed.** No Vercel project exists; region, cron, CDN cache and env vars are unverified.
3. **Vercel plan.** Hobby is for non-commercial use; a paid SaaS needs Pro.
4. **ID papers have no backup.** The weekly backup holds records only; Storage files have no copy.
5. **Backup restore never performed** end to end.
6. **Admin password** was set from chat today — change it in the app.
7. **Supabase Auth settings not verified** from this session: public sign-ups should be off;
   leaked-password protection is a Pro feature.
8. **Weak default passwords** (mobile number) for new logins — business decision, unchanged.

## 5. Recommended next steps (in order)

1. Change the admin password. 2. Create the staging project and point `.env.local` at it.
3. Run the per-role workflows and a backup restore on staging. 4. Approve (or not) the cleanup.
5. Create the Vercel Pro project, set `SUPABASE_SERVICE_ROLE_KEY` and `CRON_SECRET`, deploy a
Preview, run the smoke tests in `PRODUCTION_READINESS_REPORT.md` §11, then promote.
6. Decide how to copy the `docs` Storage bucket. 7. Optional: split the owner screens into
on-demand scripts to lift mobile Performance from the high 90s.

## Lighthouse summary

78 of 78 planned runs completed (13 routes x mobile/desktop x 3), no failed runs; medians and
every run in `LIGHTHOUSE_AUDIT_REPORT.md`. Environments: a production-like local server with no
database (public pages, login) and the same server on in-browser demo data (signed-in screens).
Neither the production-connected port 5175 nor any database was used.

| | Mobile | Desktop |
|---|---|---|
| Performance | 96-98 on the app, 100 on public pages | **100 on all 13 routes** |
| Accessibility | 100 on 11 routes; Cook 96, Admin 95 | same |
| Best Practices | 100 on 10 routes; public page 96 (small labels), Join/Visitor 96 (error from the made-up QR key) | 100 on 11 routes |
| SEO | 100 on 10 routes; Join/Visitor/Pay 63 because they are deliberately `noindex` | same |

**Lighthouse 100 in all four categories is not achieved on every route**, and should not be
claimed. 8 of 13 routes reach it on desktop, none on mobile. The noindex pages must stay below 100
on SEO by design; the remaining fixable gaps (Cook/Admin contrast, public page label size, mobile
script loading) are listed with causes in the Lighthouse report.
