# Sarvlekh (HostelOS) — Testing Baseline Report

**Audit Date**: November 2026  
**Test Harness**: Node.js Native Test Runner (`node:test`, `node:assert/strict`)  
**Node Version Requirement**: Node 18+  
**Dependencies**: 0 External npm packages (native standard library only)  

---

## 1. Initial State Baseline (Before Remediation)

When the initial testing baseline was established by executing `npm test` across all existing suites:

```bash
> node --test tests/*.test.js
```

### Initial Run Summary
- **Total Tests**: 167
- **Passed**: 164
- **Failed**: 3
- **Duration**: ~3.68s

### Failing Tests Discovered in Baseline
The three failing tests were located in `tests/concurrency.test.js`:
1. `✖ performance: 5 concurrent virtual users fetching application shell` (50 !== 0 errors)
2. `✖ performance: 10 concurrent virtual users fetching core script bundles` (80 !== 0 errors)
3. `✖ performance: 25 concurrent virtual users fetching public portal routes` (100 !== 0 errors)

### Root Cause Analysis
`tests/concurrency.test.js` was written with a hardcoded expectation that a demo server instance was already running in a background terminal on `http://localhost:5177`. During normal CI execution or standalone `npm test` runs, port 5177 was not listening, causing immediate `ECONNREFUSED` connection drops for all concurrent requests.

### Remediation Applied
In `tests/concurrency.test.js`, native `before()` and `after()` hooks were integrated:
- `before()` checks if port 5177 is active. If not, it programmatically spawns `scripts/dev-server.js --demo --port 5177` as a detached child process, polls for readiness, and binds it to the test context.
- `after()` cleanly sends a kill signal to the child process once benchmarks complete.

**Verification Result**: `tests/concurrency.test.js` now runs completely self-contained in ~500ms with zero manual steps.

---

## 2. Test Suite Breakdown & Coverage

The repository maintains specialized test suites covering individual layers:

| Test Suite | Purpose | Tests | Status |
|---|---|---|---|
| `tests/api.test.js` | Serverless `/api/admin` permissions, user creation, privilege scoping, rate limiting | 20 | **PASS** |
| `tests/concurrency.test.js` | Concurrent load, P50/P95 latency ceilings under multi-user bursts | 3 | **PASS** |
| `tests/csp.test.js` | Content-Security-Policy rules, absence of inline event handlers, base URI | 5 | **PASS** |
| `tests/domain.test.js` | Core PG business logic: check-in, FIFO payment, advance rent, mess, laundry, attendance, electricity | 88 | **PASS** |
| `tests/multitenant.test.js` | Cross-organization isolation, manager hostel confinement, role privilege ceilings | 7 | **PASS** |
| `tests/hardening.test.js` | Atomic RPCs, document guards, 1.5MB upload ceiling, offline vault encryption | 7 | **PASS** |
| `tests/public.test.js` | Public endpoints: gate QR, resident registration QR, CDN-cached hostel advert pages | 10 | **PASS** |
| `tests/release.test.js` | Release builder script, commit version stamping, asset manifest verification | 3 | **PASS** |
| `tests/routing.test.js` | Client-side pushState routes, service worker shell mapping, hashless URL migration | 5 | **PASS** |
| `tests/subdomain.test.js` | Custom domain rewrites, reserved subdomain blacklisting, slug format validation | 6 | **PASS** |
| `tests/validation.test.js` | Phone number parsing (Indian mobile format: 10 digits, prefix 6-9), email validation | 3 | **PASS** |
| `tests/wa.test.js` | WhatsApp gateway integration (WAHA, Evolution, Meta Cloud API), slow-send throttling | 10 | **PASS** |
| `tests/hardening_extended.test.js` | Master Hardening Suite: Negative amounts, claim idempotency, payment reversals & reports, meter registry, downward reading refund, atomic rollback, OCR, agreements, webhooks, push admin actions | 16 | **PASS** |

---

## 3. Post-Remediation Verification Record

Execution of the entire consolidated test suite across all 13 test files:

```bash
> node --test tests/*.test.js
```

```
ℹ tests 199
ℹ suites 0
ℹ pass 199
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 3973.53
```

**Result**: 199 of 199 tests pass completely with zero regressions. The test suite evolved through three milestones:
1. Initial baseline: 167 tests.
2. Production hardening: expanded to 183 tests (adding 16 tests in `tests/hardening_extended.test.js` covering multi-resident meter deletion atomicity, payment reversals, downward meter correction refunds, webhook timing-safe HMAC checks, and push admin actions).
3. Configurable business rules engine: expanded to 199 tests (adding 16 tests in `tests/configurable_business_rules.test.js` covering property templates, multi-cycle billing, mid-month check-in policies, checkout settlement priorities, electricity slab tiers, and staff authorization guards). All 199 tests execute cleanly and deterministically.
