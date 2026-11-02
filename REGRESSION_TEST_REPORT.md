# Regression test report (2026-11-02)

Everything below was executed today; nothing is estimated. "Not tested" is listed at the end.

## 1. Automated tests — `npm test`

| Suite | Tests | Result | Covers |
|---|---:|---|---|
| `tests/domain.test.js` | 87 | pass | Rent/electricity/laundry billing, advances and penalties, balances, stock ledger (paise, no double booking, catch-up), attendance, housekeeping, deterministic ids, demo data, xlsx export, install prompt, message text |
| `tests/api.test.js` | 20 | pass | `/api/admin` authorization: login required, owner/manager/cook/super rights, hostel-scoped managers, owner creation, whitelisted membership fields, rollback of half-made logins, **cross-client hostel attach refused**, **password reset needs authority over every membership** |
| `tests/public.test.js` | 10 | pass | Visitor and join QR (keys, file paths, sizes), nightly sweep auth and batching, **public hostel page gates and CDN-cacheable GET** |
| `tests/wa.test.js` | 9 | pass | WhatsApp gateway rights, key never revealed, demo hostel never sends |
| `tests/csp.test.js` | 5 | pass | No inline handlers, absolute paths on the public page, install code only in the app |
| **Total** | **131** | **131 pass, 0 fail** | run after every change in this audit |

## 2. Authorization on the live database

`supabase/verify_members_lockdown.sql`, run by the owner on production (rolled back, synthetic data):

| Check | Result |
|---|---|
| Policy `members_admin_update`: `UPDATE`, role `authenticated`, `qual` and `with_check` both scoped | pass |
| Browser-updatable `members` columns: only `active, block, deny, perms, role`; none for `anon` | pass |
| All 25 SECURITY DEFINER functions pin `search_path`, none executable by `anon` | pass |
| a. Owner updates staff permissions | PASS |
| b. Manager updates staff of own hostel | PASS |
| c. Manager cannot touch another hostel's staff | PASS |
| d. Manager cannot edit own membership | PASS |
| e1–e3. `user_id`, `org_id`, `hostel_id` cannot be changed | PASS |
| f. Cook cannot update anyone | PASS |
| g. Other client's manager cannot update | PASS |
| h. Anonymous caller refused | PASS |

These ran on production, not staging: no staging project exists yet. They create and roll back
their own data, so nothing was left behind.

## 3. Browser regression — every screen, every role

Same source served by `npm run dev:demo` (in-browser demo data, no database, nothing external).
Each route was opened and checked for: JS errors, unhandled promise rejections, `undefined` /
`NaN` / `[object Object]` on screen, horizontal overflow.

| Role | Screens | 360 px | 768 px | 1024 px |
|---|---|---|---|---|
| Owner (2 PGs) | 19: home, approvals, rooms, residents, payments, electricity, expenses, mess, kitchen, housekeeping, laundry, attendance, gate, complaints, staff, notices, reports, automation, settings | pass | pass | pass |
| Resident | 6: home, meals, cleaning, laundry, help, profile | — | — | pass |
| Cook | 2: mess, kitchen | — | — | pass |
| Housekeeping | 1 | — | — | pass |
| Laundry | 1 | — | — | pass |
| Security guard | 2: attendance, gate | — | — | pass |
| Super admin | 3: clients, users, usage | — | — | pass |

Role boundaries in the UI: for every non-owner role, the owner-only screens (payments, staff,
reports, expenses, admin) were opened by URL and showed no owner data.

Production-connected local app (`localhost:5175`, read-only checks earlier today): public page,
join QR, visitor QR, pay page and the admin console screens load at 375 px and desktop; wrong QR
keys and a switched-off public page are refused; framing is blocked.

## 4. Fixed during this audit and re-verified

| Issue | Verified by |
|---|---|
| Staff removal hid a failure to disable the login | code review + test suite (UI path) |
| Duplicate QR-key generator | test suite; owner QR screens open |
| 17 px "Open" link | measured 25 px after the change |
| Dead functions removed | test suite + all screens above opened with no errors |

## Not tested (and why)

* Real-database workflows per role (create resident, take a payment, etc.) against **staging** —
  no staging project exists yet; doing them on production would create real records.
* File upload of ID papers and backup download — need a real project.
* Concurrent edits from two devices — the outbox/upsert design is covered by unit tests only.
* Touch gestures on a physical tablet — checked by viewport emulation only.
* Payments and WhatsApp are links (`upi://`, `wa.me`) — no gateway exists to test.
