# Sarvlekh (HostelOS) — Architecture Assessment & Evolution

**Date**: November 2026  
**Status**: Production Architecture Validated  

---

## 1. Architectural Principles & Blueprint

Sarvlekh was designed with strict operational and economic constraints:
- **Cost**: ₹0 to low double-digit USD/month for up to 10–25 hostels on free/hobby tiers.
- **Client Footprint**: Lightweight Vanilla JavaScript PWA without frameworks, transpilations, or node build steps.
- **Offline-First Resilience**: Reads are instant from IndexedDB; writes are optimistic, encrypted in an AES-256-GCM vault, and queued in a durable outbox.
- **Single-Table Operational Storage (`docs`)**: All business records (`res`, `inv`, `pay`, `meter`, `agr`, `item`, `mv`, etc.) live in one PostgreSQL `docs` table as structured JSONB, keyed by `(hostel_id, id)`.
- **Stateless Serverless Execution**: Server execution is limited to bounded serverless functions running on Vercel Node 18+ runtime with 0 external npm dependencies.

```
┌────────────────────────────────────────────────────────┐
│ Phone / Desktop Client (PWA)                           │
│ • HTML5 + CSS3 + Vanilla JavaScript (No build step)    │
│ • IndexedDB CacheStore + Device Encrypted Vault (AES)   │
│ • Optimistic UI writes + Batched Outbox Synchronization│
│ • Browser-side Image Compression & Lightweight OCR     │
└────────────┬─────────────────────────────┬─────────────┘
             │ Delta Sync & Direct REST    │ Privileged Auth / QR
             ▼                             ▼
┌─────────────────────────┐   ┌───────────────────────────┐
│ Supabase PostgreSQL     │   │ Vercel Serverless         │
│ • Multi-tenant RLS      │   │ • /api/admin (Privileged) │
│ • Atomic Locking RPCs   │   │ • /api/public (QR/Webhook)│
│ • Private Storage (docs)│   │ • /api/wa (WhatsApp)      │
└─────────────────────────┘   └─────────────┬─────────────┘
                                            │ Service Role Only
                                            ▼
                               ┌───────────────────────────┐
                               │ Supabase Auth & Storage   │
                               └───────────────────────────┘
```

---

## 2. Evaluation of Key Subsystems

### 2.1 Offline Store & Synchronization
- **Outbox Architecture**: Writes are stored locally with deterministic IDs (`inv-rent-{resId}-{ym}`, `agr-{resId}-v{ver}`). When online, `Store.flush()` pushes records in batches up to 200 items.
- **Atomic Bed Allocation & Stock Movement**: Critical records (`res`, `pay`, `mv`) are routed via PostgreSQL RPCs (`allocate_bed`, `record_payment_atomic`, `record_stock_movement`) with row-level locks (`FOR UPDATE`) to prevent race conditions during concurrent offline flushes.
- **Delta Sync Optimization**: Cursor-based polling (`updated_at >= cursor`) queries only mutated rows. The poll interval dynamically adapts between 60s and 300s (and 180s to 600s for residents) based on idle activity, avoiding excessive egress fees.

### 2.2 Security & Multi-Tenant Isolation
- **Row-Level Security (RLS)**: Enforced directly on `public.orgs`, `public.hostels`, `public.profiles`, `public.members`, and `public.docs`. Helper functions (`full_hostels()`, `my_access()`) are marked `STABLE SECURITY DEFINER` and evaluated once per query (InitPlan).
- **Service-Role Key Confinement**: The service-role key (`SUPABASE_SERVICE_ROLE_KEY`) is strictly confined to serverless function environment variables and never bundled or exposed to frontend code.

### 2.3 Browser-Side Smart Automation
- **Lightweight 7-Segment OCR**: Implemented without external AI APIs or heavy WebAssembly runtimes. Canvas-based grid sampling decodes digits and evaluates segment confidence directly in browser memory.
- **Provider-Independent Payment Architecture**: Dynamic UPI intents and QR codes route payments directly to the owner's bank account with 0% gateway fees. Verified payment webhooks (`api/public.js:webhook`) support Razorpay, Cashfree, and Setu with HMAC signature verification and idempotent settlement.

---

## 3. Safe Improvements Incorporated

1. **Self-Contained Benchmark Harness**: `tests/concurrency.test.js` automatically manages child server lifecycles, enabling reliable CI test execution.
2. **Push Notification Infrastructure**: Integrated standards-compliant Web Push in `sw.js` and `/api/admin` with permission handling and category preferences.
3. **Audit Trail Engine**: Extended `alog()` to log actor identities, roles, timestamps, old/new states, and reasons across payments, invoices, meter readings, and agreements.
4. **Digital Rental Agreements Engine**: Modular agreement generator with versioning, PDF/print layout, and IT Act 2000 legal disclaimer.
5. **Verified Payment Webhooks**: Webhook endpoint with HMAC signature checking, idempotency guards, and automatic ledger reconciliation.
