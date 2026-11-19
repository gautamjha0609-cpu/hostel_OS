# Sarvlekh (HostelOS) — Bugs, Vulnerabilities & Risk Assessment

**Audit Date**: November 2026  
**Status**: All Identified Critical Bugs Mitigated & Verified  

---

## 1. Vulnerability & Defect Register

### BUG-01: Silent Double Invoicing on Meter Reading Edits
- **Severity**: **Fatal Functional Bug**
- **Location**: `js/ui-owner.js:A.meteredit`
- **Mechanism**: The original `A.meteredit` implementation called `Store.remove(m.id)` followed by `addReading(...)`. Because `addReading` creates deterministic invoices based on the reading ID (`inv-el-${m.id}-${s.resId}`), removing the old reading and generating a new reading with a newly minted UUID created a fresh set of invoices while leaving the old invoices dangling in the resident ledger. Residents were thus billed twice for electricity for the same calendar period.
- **Remediation**: Implemented `correctReading({ meterId, curr, prev, reason })` in `js/domain.js`. Rather than deleting the reading, it maintains the record's primary ID, preserves `origCurr` and `origPrev`, records an immutable audit log (`alog('meter_correction', ...)`), and updates the amounts of the existing invoice documents without creating duplicate charges.

### BUG-02: Client-Side Duplicate Payment Claim Approval
- **Severity**: **Fatal Functional Bug**
- **Location**: `js/domain.js:recordPayment`, `js/ui-owner.js:A.claimok`
- **Mechanism**: While PostgreSQL enforced idempotency keys in atomic RPCs, the client-side `recordPayment` method did not verify whether a `claimId` had already been settled before running FIFO invoice allocation. In network lag or double-tap scenarios, two calls to `claimok` produced two distinct payment records, settling the resident's invoices twice and allocating the second amount as unearned resident credit.
- **Remediation**: Hardened `recordPayment()` to inspect `Store.all('pay')`. If `claimId` is present and matches an existing active payment, the method immediately returns the existing payment object without inserting a secondary ledger transaction.

### BUG-03: Zero & Negative Invoice Injection
- **Severity**: **Fatal Functional Bug / Ledger Corruption**
- **Location**: `js/domain.js:addInvoice`
- **Mechanism**: `addInvoice` directly rounded `o.amount` (`round2(o.amount)`) without enforcing positivity. Calling `addInvoice({ amount: -500 })` inserted negative charges into the ledger, corrupting total dues calculations.
- **Remediation**: Added explicit positivity assertions in `addInvoice`:
  ```javascript
  const amt = round2(o.amount);
  if (!isFinite(amt) || isNaN(amt) || amt <= 0) throw new AppError('Invoice amount must be positive');
  if (amt > 10000000) throw new AppError('Invoice amount cannot exceed ₹10,000,000');
  ```

### BUG-04: Double Resident Checkout & Deduction Overflow
- **Severity**: **Minor Robustness Risk / State Corruption**
- **Location**: `js/domain.js:checkout`
- **Mechanism**: If `checkout()` was called on an already checked-out resident (`r.status === 'left'`), it created duplicate `dep` deposit settlement records and reset notes. Furthermore, deductions were not bounded by the resident's held deposit plus credit, permitting arbitrary negative refund balances.
- **Remediation**: Guarded `checkout()` to reject invocation if `r.status === 'left'` and enforce `if (deductions > maxRefund) throw new AppError('Deductions cannot exceed the remaining deposit and credit')`.

### BUG-05: Missing Web Push Handlers in Service Worker
- **Severity**: **Fatal Functional Bug / Feature Disconnect**
- **Location**: `sw.js`
- **Mechanism**: Although `sw.js` was registered and cached application shell assets, it contained neither a `push` event listener nor a `notificationclick` handler. Any push notifications dispatched to browser endpoints were silently dropped by the browser runtime.
- **Remediation**: Added standards-compliant `push` and `notificationclick` event listeners to `sw.js` with focus matching, window opening, and deep-link routing.

### BUG-06: Destructive Meter Deletion with Settled Invoices
- **Severity**: **Fatal Functional Bug / Audit Violation**
- **Location**: `js/ui-owner.js:A.meterdel`
- **Mechanism**: The original `A.meterdel` deleted the meter reading document and only removed unpaid invoices. If an invoice had already been partially or fully paid, the parent meter record was wiped, leaving orphaned payment receipts and orphan invoice records with no source of calculation.
- **Remediation**: Implemented `deleteReading({ meterId, reason })` which checks if any associated invoices have `paid > 0`. If any payments have been recorded against the reading, deletion is strictly forbidden (`"Cannot delete reading: X resident bill(s) have already been paid. Reverse the payments first."`).

### BUG-07: Hard Deletion of Verified Transactions
- **Severity**: **Financial Integrity Defect**
- **Location**: `js/domain.js`
- **Mechanism**: The system lacked an auditable payment reversal workflow. Admins attempting to correct bounced cheques or mistaken payment entries had no recourse other than manually adjusting credit.
- **Remediation**: Added `reversePayment(payId, reason)` which flags the transaction with `reversed: true`, restores unpaid balances on previously settled invoices, reverses unearned resident credits, and logs an indelible reversal record.

### BUG-08: Partial Invoice Deletion on Multi-Resident Reading Deletion (Atomicity Failure)
- **Severity**: **Fatal Functional Bug / Data Corruption**
- **Location**: `js/domain.js:deleteReading`
- **Mechanism**: When iterating over room resident shares in `deleteReading`, `Store.remove(inv.id)` was called on unpaid invoices *before* checking whether subsequent shares had already been paid. If Resident 1 had not paid but Resident 2 had paid, Resident 1's invoice was permanently destroyed from the store, followed by an exception thrown for Resident 2, leaving the database corrupted with an orphaned partial bill deletion.
- **Remediation**: Enforced strict two-phase atomicity: all resident shares are checked first; if any invoice has `paid > 0`, the operation throws immediately without deleting any invoice.

### BUG-09: Financial Revenue Leakage from Reversed Payments
- **Severity**: **Financial Integrity Defect**
- **Location**: `js/domain.js:payments`, `js/report.js:Report.compute`, `js/ui-owner.js:A.respays`
- **Mechanism**: Even though `reversePayment` flagged payments with `reversed: true`, `payments()`, `resPays()`, and `Report.compute()` continued to sum reversed payments into gross collected revenue and cash flow metrics, falsely inflating the hostel's reported income.
- **Remediation**: Excluded `reversed: true` records from `payments()` and financial reports (`js/report.js:D.pays`), marked them clearly with bad badges in `A.respays` and `A.receipt`, and provided owner-facing UI controls (`A.payreverse`).

### BUG-10: Downward Meter Reading Correction Swallowed Excess Payments
- **Severity**: **Fatal Functional Bug / Accounting Corruption**
- **Location**: `js/domain.js:correctReading`
- **Mechanism**: When a paid electricity invoice was adjusted downward after an OCR or reading misread correction (`s.amount < inv.paid`), the excess money paid by the resident was silently retained on the invoice (`inv.paid` remained unchanged while `amount` decreased), depriving the resident of their rightful refund.
- **Remediation**: Added excess refund allocation in `correctReading`: `excess = round2(inv.paid - s.amount)`, which caps `inv.paid = s.amount` and credits `excess` directly to `r.credit`.

### BUG-11: Unauthenticated Public Webhook Endpoint Vulnerability
- **Severity**: **Critical Security Vulnerability**
- **Location**: `api/public.js:webhook`
- **Mechanism**: When `PAYMENT_WEBHOOK_SECRET` was unconfigured, the endpoint skipped signature validation entirely and allowed unauthenticated HTTP POST requests from the public internet to mark invoices as settled via service-role RPC.
- **Remediation**: Enforced 503 HTTP rejection if `PAYMENT_WEBHOOK_SECRET` is unset, and enforced constant-time HMAC-SHA256 signature checking (`timingSafeEqual`) on all incoming webhook requests.

### BUG-12: Disconnected Service Worker Local Push & Missing UI Workflows
- **Severity**: **Feature Disconnect & Incomplete Workflows**
- **Location**: `sw.js`, `js/app.js`, `js/ui-owner.js`, `js/ui-resident.js`
- **Mechanism**: The service worker lacked a `message` event listener to receive `PUSH_LOCAL` dispatches from `Pwa.dispatchPush()`. Furthermore, push subscription enablement was never accessible from the UI, and rental agreement creation/viewing was never integrated into resident/owner screens.
- **Remediation**: Added `message` event handler to `sw.js`, integrated the push notification status and toggle button in `A.notifs`, added `agrCard` and printable agreement view modals in both owner and resident apps, and provided camera-based meter scanning (`A.meterscan`).

### BUG-13: Optional Number Input Validation Failure in formModal
- **Severity**: **Fatal Functional Bug / UI Form Failure**
- **Location**: `js/core.js:formModal`
- **Mechanism**: `formValues` assigns `NaN` when a number input is left empty. In `modalSubmit`, `if (typeof v === 'number' && (!isFinite(v) || isNaN(v)))` checked `isNaN(v)` unconditionally without verifying whether the field was empty and non-required. This caused all optional number inputs (such as skipping unchanged rooms in `A.readings`) to fail validation with `"{f} must be a valid number."`, preventing form submission.
- **Remediation**: Guarded number validation by checking the input's raw value: only when `raw !== ''` are `isNaN` and range boundaries (`min`/`max`) evaluated. If `raw === ''` and `f.required` is false, the submission proceeds smoothly.

### BUG-14: Missing Rental Agreement Document Header & Inconsistent Resident Printing
- **Severity**: **UI / Formatting Defect**
- **Location**: `js/ui-owner.js:A.agrview`, `tests/browser_e2e_runner.js`
- **Mechanism**: `#agrdoc` header rendered only the hostel brand name (`b style="font-size:18px"`). When a hostel name was present, the document body completely omitted the text "Hostel / PG Rental Agreement", leaving printed agreements without formal document identification and failing verification assertions.
- **Remediation**: Added an explicit document heading `<div style="text-transform:uppercase;font-size:12px;letter-spacing:1px;font-weight:600;margin-top:4px" class="muted">HOSTEL / PG RENTAL AGREEMENT</div>` inside `#agrdoc`, ensuring standard legal clarity on print and screen.

### BUG-15: Meter Photo Attachment Dropped on Camera Reading Save
- **Severity**: **Audit Trail Data Loss**
- **Location**: `js/ui-owner.js:A.meterscan`, `A.meterview`
- **Mechanism**: In `A.meterscan`, `v.photo` was captured via file input but omitted when calling `addReading({ roomId: v.roomId, curr, date: today(), qrCode: v.qrCode })`. Meter photos were never saved to the reading record or displayed in the inspection view.
- **Remediation**: Passed `photo: photoName` to `addReading`, added instant thumbnail preview (`#mprev`) with filename and size, and displayed `m.photo` in `A.meterview`.

### BUG-16: Meter OCR Verification Benchmark Assertion Inversion
- **Severity**: **Test Harness Defect**
- **Location**: `tests/meter_ocr_verification.js`
- **Mechanism**: The test harness expected `'METER NO 201: 03120.8 KWH'` to produce `20103120.8` (the naive concatenation bug), causing a false `(WARN - SERIAL/UNIT MIXUP)` warning when `parseMeterOcrText()` correctly isolated `3120.8`.
- **Remediation**: Updated the expected benchmark reading to `3120.8`, expanded the benchmark suite across real Indian digital meter models (Genus, Secure, L&T, HPL, Schneider), and added dual-tariff kWh prioritization and analog meter rejection.

---

## 2. Security & Operational Risks

| Risk Category | Description | Mitigation Implemented |
|---|---|---|
| **Multi-Tenant Cross-Access** | Tampered requests modifying client or hostel IDs | Serverless functions enforce `assertAdmin` and `hostelAccess`; RLS enforces `full_hostels()`. |
| **Fraudulent Meter Submission** | Entering arbitrary lower readings or photo manipulation | `validateMeterReadingFraud` detects readings < previous, surges (>1500 units), QR mismatches. |
| **Fake Payment Confirmations** | Resident submitting fake UTR claiming instant settlement | Claims remain in `'pending'` status; confirmed only via provider webhook or owner review. |
| **Document Exposure** | Public accessibility of sensitive Aadhaar / photo files | Private Supabase bucket `docs` protected by storage RLS; signed URLs expire after 10 minutes. |
| **Service Role Secret Leakage** | Exposing Supabase service-role key to client browsers | Service-role key isolated exclusively to serverless functions (`api/admin.js`, `api/public.js`). |
