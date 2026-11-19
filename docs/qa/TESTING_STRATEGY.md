# Sarvlekh (HostelOS) — QA & Testing Strategy

**Date**: November 2026  
**Test Suite**: 183 Tests (100% Pass Rate across 13 Suites)  
**Execution Time**: ~3.5 seconds  

---

## 1. Testing Philosophy

1. **Zero External Dependencies**: The test runner uses the native Node.js test harness (`node:test`, `node:assert/strict`). There are no heavy Jest, Mocha, or Playwright packages to install, compile, or maintain.
2. **Deterministic Business Invariants**: Financial, electricity, and inventory rules are tested against mathematical edge cases:
   - Pro-rata rent on 28/30/31-day calendar months.
   - Fractional electricity sharing across mid-month arrivals and departures.
   - Idempotent automation runs where repeating an execution produces zero duplicate records.
3. **Defense-in-Depth**: Validation is tested at three distinct tiers:
   - Client-side UX validation (`js/domain.js`, `js/ui-*.js`)
   - Serverless API authorization (`api/admin.js`, `api/public.js`)
   - Database integrity & row-level security (`supabase/schema.sql`, PostgreSQL RPCs)

---

## 2. Test Suite Matrix

```
tests/
├── api.test.js               (20 tests) — Serverless /api/admin privileged authorization & rate limits
├── concurrency.test.js       (3 tests)  — Multi-user concurrent load & P50/P95 latency ceilings
├── csp.test.js               (5 tests)  — Content-Security-Policy rules & script injection checks
├── domain.test.js            (88 tests) — Core business rules (billing, mess, electricity, laundry)
├── hardening.test.js         (7 tests)  — Atomic RPCs, document guards, vault encryption
├── hardening_extended.test.js(16 tests) — Invariants, reversals, reports, meter refunds & rollback, OCR, webhooks, push admin
├── multitenant.test.js       (7 tests)  — Cross-organization isolation & role privilege limits
├── public.test.js            (10 tests) — Public QR self-service endpoints, webhooks & CDN caching
├── release.test.js           (3 tests)  — Release packaging & version stamping
├── routing.test.js           (5 tests)  — Client-side hashless routing & service worker shell
├── subdomain.test.js         (6 tests)  — Custom domains & reserved name sanitization
├── validation.test.js        (3 tests)  — Phone & email parsing standards
└── wa.test.js                (10 tests) — WhatsApp gateway integrations & slow-send throttling
Total: 183 tests
```

---

## 3. Concurrency & Performance Benchmarks

Executed via `tests/concurrency.test.js` against the local application shell:

| Concurrency Level | Endpoint | Requests | P50 Target / Measured | P95 Target / Measured | Errors |
|---|---|---|---|---|---|
| **5 Concurrent Users** | Application Shell (`/`) | 50 | <100ms / **18ms** | <250ms / **38ms** | **0** |
| **10 Concurrent Users** | Script Bundle (`/js/core.js`) | 80 | <100ms / **14ms** | <250ms / **26ms** | **0** |
| **25 Concurrent Users** | Public Portal (`/visit.html`)| 100 | <150ms / **21ms** | <300ms / **44ms** | **0** |

All measured latencies operate comfortably within performance thresholds.

---

## 4. Edge-Case Coverage Register

- **Negative & Zero Invoices**: `addInvoice` asserts positivity; throws `AppError` on `<= 0`.
- **Payment Reversals**: `reversePayment` restores invoice balances and un-allocates unearned credits.
- **Deposit Over-Refund**: `checkout` rejects deductions exceeding remaining deposit and resident credit.
- **Duplicate Payment Claims**: `recordPayment` detects previously settled `claimId` and returns existing payment without duplication.
- **Meter Reading Correction**: `correctReading` records `origCurr`, `correctedCurr`, user identity, timestamp, and reason; updates existing bills without invoice duplication.
- **Meter Deletion Protection**: `deleteReading` blocks deletion if any associated bills have already been paid.
- **Payment Webhook Replay**: `processVerifiedPaymentWebhook` acknowledges replays with `replay: true` without duplicate ledger insertion.
- **OCR Pattern Decoding**: 7-segment digit grid matching validated across all digits `0–9`.
