# Sarvlekh (HostelOS) — Existing System Feature Inventory

**Audit Date**: November 2026  
**Auditor**: Autonomous Master Engineering Team  
**Repository Architecture**: Static PWA (Vanilla JS / CSS3) + Supabase PostgreSQL (RLS) + Vercel Serverless Functions  

---

## 1. Classification Taxonomy

Features are classified according to the production engineering criteria:

| Status | Definition |
|---|---|
| **Fully Working** | Implemented, end-to-end operational, verified by unit/integration test suite |
| **Partially Working** | Core logic implemented but lacks secondary workflows or automation guards |
| **Needs Improvement** | Operates correctly under normal usage but vulnerable to race conditions, missing audit logs, or UI edge-cases |
| **Incomplete** | UI or backend stub exists but full workflow is disconnected |
| **Missing** | Not yet implemented in repository |
| **Broken** | Fails or throws unhandled exceptions during execution |

---

## 2. Module-by-Module Inventory

### 2.1 Property & Space Management

| Feature | Status | Primary Code Reference | Backend / Tables | Evaluation & Notes |
|---|---|---|---|---|
| Multi-Organization & Client SaaS | **Fully Working** | `api/admin.js:create_org`, `js/domain.js` | `public.orgs` | Super admin provisions client orgs, SaaS subscription tiers, fees, paid-till dates. |
| Multi-Hostel & Branch Provisioning | **Fully Working** | `api/admin.js`, `js/data.js` | `public.hostels` | 1..N hostels per client. Scoped managers restricted to assigned hostels. |
| Blocks, Wings & Annexe Splitting | **Fully Working** | `js/domain.js:hostelBlocks`, `js/app.js` | `public.hostels.blocks`, `docs` kind `room` | Block assigned per room; residents and payments automatically inherit block. |
| Floors, Rooms & Beds | **Fully Working** | `js/domain.js:bedsOf`, `vacantBeds`, `occupancy` | `docs` kind `room` | Rooms contain array of beds with statuses (`vac`, `occ`, `mnt`). |
| AC / Non-AC & Room Categories | **Fully Working** | `js/domain.js`, `js/ui-owner.js` | `docs` kind `room.data.ac` | Displayed on room list and public portal. |
| Bed Capacity & Occupancy Invariants | **Fully Working** | `supabase/migrations/2026-11-14_production_hardening.sql:allocate_bed` | `docs` unique index `docs_active_bed_uniq` | Bed allocation enforced atomically via PostgreSQL RPC with row-level locks. |
| Room Transfers & Bed Shifting | **Fully Working** | `js/domain.js:shiftBed` | `docs` kind `room`, `res` | Vacates old bed, occupies new bed, maintains resident billing ledger continuity. |

### 2.2 Tenant & Resident Management

| Feature | Status | Primary Code Reference | Backend / Tables | Evaluation & Notes |
|---|---|---|---|---|
| Public QR Self-Registration | **Fully Working** | `api/public.js:join`, `js/join.js`, `join.html` | `docs` kind `signup` | Prospective residents submit details and ID photos via QR; owner approves. |
| Tenant Onboarding & Bed Allocation | **Fully Working** | `js/domain.js:admitSignup`, `checkIn` | `public.docs` (`res`, `inv`) | Calculates pro-rata 1st month rent and security deposit; occupies bed. |
| KYC & ID Document Storage | **Fully Working** | `js/data.js:Files`, `api/admin.js:sweepFiles` | Supabase Storage bucket `docs` | Browser WebP/JPEG compression; 1.5MB upload ceiling; auto-sweep 30d after checkout. |
| Check-in & Check-out Workflow | **Fully Working** | `js/domain.js:checkIn`, `checkout` | `docs` kind `res`, `dep`, `inv` | Hardened against duplicate invocation and excess deposit deductions. |
| Security Deposit Settlement | **Fully Working** | `js/domain.js:checkout`, `js/ui-owner.js:depok` | `docs` kind `dep`, `pay` | Automatic offset against open dues; remainder queued for refund. |
| Police Verification Reminders | **Fully Working** | `js/domain.js:pvOn`, `pvDue`, `pvPending` | `docs` kind `res.data.pv` | State-specific portal deep-links, overdue chasing, automated reminders. |
| Resident Self-Service Portal | **Fully Working** | `js/ui-resident.js`, `index.html` | `public.docs` (RLS restricted) | Allows residents to view dues, submit UPI claims, skip meals, request tiffins, report issues. |
| Account Invite & Activation | **Fully Working** | `api/admin.js:makeUser`, `api/public.js:activate` | `public.account_invites` | Single-use cryptographically hashed invite tokens for password activation. |

### 2.3 Financial & Ledger Management

| Feature | Status | Primary Code Reference | Backend / Tables | Evaluation & Notes |
|---|---|---|---|---|
| Rent Invoicing & Automation | **Fully Working** | `js/domain.js:monthlyBillsDue`, `runAutomation` | `docs` kind `inv` | Deterministic IDs (`inv-rent-{resId}-{ym}`) prevent duplicate charges. |
| Partial Payments & FIFO Allocation | **Fully Working** | `js/domain.js:recordPayment` | `docs` kind `pay`, `inv` | Oldest unpaid dues settled first; excess converted to advance resident credit. |
| Advance Rent Multi-Month Billing | **Fully Working** | `js/domain.js:advPlan`, `recordAdvance` | `docs` kind `inv`, `pay` | Generates future rent bills upfront with explicit discount waivers. |
| Penalty & Fines Management | **Fully Working** | `js/domain.js:addPenalty`, `waivePenalty` | `docs` kind `inv` (type `penalty`) | Fines recorded with reasons; cancellation writes waiver without deleting. |
| Financial Reversals & Protection | **Fully Working** | `js/domain.js:reversePayment` | `docs` kind `pay`, `inv` | Unwinds invoice allocations and credits safely without hard deletion. |
| UPI Intent & QR Generation | **Fully Working** | `js/pay.js`, `pay.html`, `js/domain.js:upiUri` | Client `upi://` URI | Direct owner VPA routing with zero platform transaction commissions. |
| Payment Claim & UTR Verification | **Fully Working** | `js/domain.js`, `js/ui-owner.js:claimok` | `docs` kind `claim`, `pay` | UTR remains in pending claim status until verified by owner or gateway webhook. |
| Verified Payment Webhook Gateway | **Fully Working** | `api/public.js:webhook`, `js/domain.js:processVerifiedPaymentWebhook` | Vercel `/api/public/webhook` | Supports Razorpay / Cashfree / Setu webhooks with HMAC checking & idempotency. |
| Financial Excel Reports | **Fully Working** | `js/xlsx.js`, `js/report.js` | Client-side ZIP generation | Generates styled .xlsx workbooks with zero npm dependencies. |

### 2.4 Electricity Management

| Feature | Status | Primary Code Reference | Backend / Tables | Evaluation & Notes |
|---|---|---|---|---|
| Meter Registration & Room Binding | **Fully Working** | `js/domain.js:registerMeter`, `getMeterForRoom` | `docs` kind `emeter` | Binds unique physical serial and QR code to hostel room; rejects duplicates. |
| Meter Readings & Pro-Rata Billing | **Fully Working** | `js/domain.js:addReading`, `moveReading` | `docs` kind `meter`, `inv` | Splits units between roommates by active days; enforces non-negative readings. |
| Free Units Sharing Modes | **Fully Working** | `js/domain.js:splitElectricity` | `settings.elec.freeMode` | Supports both resident-based pool and shared room-based allowances. |
| Anomaly & Fraud Detection | **Fully Working** | `js/domain.js:validateMeterReadingFraud` | Client validation logic | Detects readings < previous, consumption surges (>1500 units), QR mismatches. |
| 7-Segment OCR Digit Recognition | **Fully Working** | `js/domain.js:analyzeDigitSegments`, `parseMeterOcrText` | HTML5 Canvas / Grid Analysis | Browser-side 7-segment digital display analysis; zero GPU/API server cost. |
| Auditable Reading Correction | **Fully Working** | `js/domain.js:correctReading`, `deleteReading` | `docs` kind `meter`, `inv`, `log` | Preserves original values, logs user/timestamp/reason, adjusts bills cleanly. |

### 2.5 Mess & Kitchen Operations

| Feature | Status | Primary Code Reference | Backend / Tables | Evaluation & Notes |
|---|---|---|---|---|
| Weekly Rotating Mess Menu | **Fully Working** | `js/domain.js:menuDoc`, `dishesFor` | `docs` kind `menu`, `dish` | Multi-meal configuration (Breakfast, Lunch, Snacks, Dinner). |
| Meal Headcount & Tiffin Requests | **Fully Working** | `js/domain.js:headcount`, `toggleTiffin` | `docs` kind `tiffin`, `leave` | Tracks active residents, leaves, guests, and tiffins for kitchen prep. |
| Meal Skip Cut-Off Times | **Fully Working** | `js/domain.js:cutoffAt`, `toggleSkip` | `docs` kind `skip` | Enforces owner cut-off hour (e.g., 22:00 previous day for breakfast). |
| Inventory Stock Ledger | **Fully Working** | `js/domain.js:ledger`, `postConsumption` | `docs` kind `item`, `mv` | Multi-entry stock accounting (purchase, count, consumption, waste). |
| Atomic Stock Movements | **Fully Working** | `supabase/..._production_hardening.sql:record_stock_movement` | RPC `record_stock_movement` | Row-level locking on inventory items; strictly blocks negative stock. |
| Purchase Requests & Approvals | **Fully Working** | `js/domain.js:createPR`, `receivePR` | `docs` kind `pr`, `exp` | Receiving purchases increments inventory and automatically logs expenses. |
| Real-World Stock Learning | **Fully Working** | `js/domain.js:learnFactor` | `docs` kind `item.data.factor` | Adjusts consumption forecasts from historical purchase-to-use ratios. |

### 2.6 Staff & Operations

| Feature | Status | Primary Code Reference | Backend / Tables | Evaluation & Notes |
|---|---|---|---|---|
| Role-Based Access Control (RBAC) | **Fully Working** | `supabase/schema.sql`, `api/admin.js` | `public.members`, RLS | 9 roles (owner, manager, accountant, cook, hk, laundry, guard, staff, resident). |
| Housekeeping Task Generation | **Fully Working** | `js/domain.js:genHkTasks`, `markMissed` | `docs` kind `hks`, `hkt` | Schedules recurring daily/weekly cleaning; auto-expires missed tasks. |
| Resident Cleaning Feedback | **Fully Working** | `js/domain.js:hkFeedback` | `docs` kind `hkf` | Resident rating & comment logged upon room cleaning completion. |
| Staff Attendance & Geofencing | **Fully Working** | `js/domain.js:punchIn`, `attFence`, `geo.js` | `docs` kind `att` | Validates mobile GPS coordinates against hostel perimeter radius. |
| Visitor Gate Register | **Fully Working** | `api/public.js:visit`, `visit.html`, `js/visit.js` | `docs` kind `gate` | QR-based visitor self-entry; rate-limited and owner-notified. |
| Maintenance Complaints | **Fully Working** | `js/domain.js`, `js/ui-resident.js` | `docs` kind `cmp` | Categorized ticketing (Plumbing, Electrical, Carpentry, Cleaning, Other). |

### 2.7 PWA & Notifications

| Feature | Status | Primary Code Reference | Backend / Tables | Evaluation & Notes |
|---|---|---|---|---|
| Offline Caching & Service Worker | **Fully Working** | `sw.js`, `manifest.webmanifest` | CacheStorage / ServiceWorker | 12h background asset revalidation; offline shell navigation fallback. |
| Encrypted Offline Outbox Vault | **Fully Working** | `js/data.js:CryptoVault` | IndexedDB `vault` store | AES-256-GCM local storage encryption for pending writes on shared devices. |
| Site-Only Push Notification Engine | **Fully Working** | `sw.js:push`, `api/admin.js:save_push_sub`, `js/pwa.js` | ServiceWorker PushManager | Standards-compliant Web Push; permission state detection; polite UI prompt. |
| In-App Notification Center | **Fully Working** | `js/domain.js:notify`, `myNotifs`, `js/app.js` | `docs` kind `ntf` | Unread badge, instant mark-as-read, deep-link navigation. |

### 2.8 Digital Agreements & Legal

| Feature | Status | Primary Code Reference | Backend / Tables | Evaluation & Notes |
|---|---|---|---|---|
| Modular Rental Agreement Engine | **Fully Working** | `js/domain.js:createAgreement`, `renewAgreement` | `docs` kind `agr` | Captures owner/tenant details, rooms, rent, deposit, notice, rules, clauses. |
| Version History & Renewal Tracking| **Fully Working** | `js/domain.js:agreementDueRenewal` | `docs` kind `agr` | Preserves old versions; flags agreements expiring within 30 days. |
| Legal Disclaimers & E-Sign Compliance | **Fully Working** | `js/domain.js:createAgreement` | Metadata disclaimer | IT Act 2000 disclaimer; explicitly clarifies e-contract vs Aadhaar eSign. |

---

## 3. Database Schema & Storage Model Summary

- **Single Operational Table (`docs`)**: All dynamic records (`res`, `inv`, `pay`, `meter`, `agr`, `item`, etc.) use PostgreSQL `jsonb` keyed by `(hostel_id, id)` with indexed promoted columns (`res_id`, `room_id`, `day`).
- **Administrative Core Tables**: `public.orgs`, `public.hostels`, `public.profiles`, `public.members`, `public.account_invites`.
- **Blob Storage (`docs` bucket)**: Compressed KYC Aadhaar documents, resident photos, police verification receipts.
- **Backup Storage (`backups` bucket)**: Gzip compressed per-hostel weekly JSON snapshots.
