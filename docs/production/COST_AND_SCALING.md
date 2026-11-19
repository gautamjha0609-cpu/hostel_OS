# Sarvlekh (HostelOS) — Infrastructure Costing & Scaling Model

**Audit Date**: November 2026  
**Target Architecture**: Zero-Waste Serverless + Managed PostgreSQL  

---

## 1. Provider Service Tiers & Free Quotas

| Service | Tier / Plan | Cost | Included Quota | Upgrade Trigger Threshold |
|---|---|---|---|---|
| **Vercel** | Hobby | **$0 / mo** | 100 GB Bandwidth, 100k Serverless Executions/day, 10s timeout | Exceeding 100k function calls/day or commercial team seats needed ($20/seat/mo). |
| **Supabase** | Free Tier | **$0 / mo** | 500 MB Database, 1 GB Storage, 2 GB Egress, 50k MAU | Database approaching 400 MB or PITR daily continuous backups required ($25/mo Pro). |
| **WhatsApp Direct** | Native `wa.me` | **₹0 / mo** | Unlimited pre-typed messages via browser intent | Manual owner tap required. Zero platform API cost. |
| **WhatsApp Meta Cloud**| Graph API | **Usage-based** | 1,000 Service conversations free/mo | ~₹0.80 per Utility conversation in India. |
| **Storage Bucket** | Supabase `docs` | **Included** | 1 GB Free Tier bucket storage | Pruned automatically (30 days post checkout); photos tuned to ~25 KB. |

---

## 2. Capacity & Growth Modeling

A standard 50-bed hostel generates:
- Active resident records: 50 rows
- Invoices (rent + electricity + laundry): ~150 rows / month
- Payments: ~50 rows / month
- Mess skip / attendance logs: ~300 rows / month (pruned after 120 days)
- Annual data volume per 50-bed hostel: **~5 MB to 10 MB / year**.
- Compressed KYC storage (400px passport photo @ 25KB, Aadhaar @ 75KB): **~5 MB per active hostel**.

---

## 3. Projected Operating Costs by Scale

### 3.1 Controlled Pilot (5–10 Hostels, ~300–500 Beds)
- **Vercel**: Hobby ($0)
- **Supabase**: Free Tier ($0) — Database volume ~30–50 MB (10% of 500 MB limit)
- **Storage**: ~50 MB (5% of 1 GB limit)
- **WhatsApp**: Direct `wa.me` links / Owner phone (₹0)
- **Payments**: Direct UPI `upi://` + Dynamic QR (₹0 gateway fees)
- **Total Platform Cost**: **₹0 / month** ($0.00)

### 3.2 Medium Stage (25 Hostels, ~1,250 Beds)
- **Vercel**: Hobby or Pro ($20/mo = ~₹1,700)
- **Supabase**: Pro Tier recommended ($25/mo = ~₹2,100) for daily PITR backups & 8 GB storage.
- **WhatsApp**: Direct `wa.me` default; optional shared Evolution instance on a ₹350/mo VPS.
- **Total Platform Cost**: **~₹3,800 – ₹4,200 / month** (~₹160 per hostel/month).
- *Economics*: At a SaaS subscription fee of ₹499/hostel/month, gross revenue is ₹12,475/month against ₹4,000 infrastructure cost (~68% gross margin).

### 3.3 Large Scale (50 Hostels, ~2,500 Beds)
- **Vercel**: Pro ($20/mo = ~₹1,700)
- **Supabase**: Pro ($25/mo + compute add-on = ~₹3,500)
- **Storage**: Additional egress add-ons (~₹500)
- **WhatsApp**: Meta Official Cloud API for automated notifications (~₹3,000/mo)
- **Total Platform Cost**: **~₹8,700 / month** (~₹175 per hostel/month).
- *Economics*: At ₹499/hostel/month, revenue is ₹24,950/month against ₹8,700 cost (~65% gross margin).

### 3.4 Scale-Up (100 Hostels, ~5,000 Beds)
- **Vercel**: Pro ($20/mo + function usage = ~₹3,000)
- **Supabase**: Pro + 2XL Compute ($25 + $50 = ~₹6,300)
- **Total Platform Cost**: **~₹14,000 / month** (~₹140 per hostel/month).
- *Economics*: Revenue is ₹49,900/month against ₹14,000 cost (~72% gross margin).

---

## 4. Scaling Safeguards Built into Codebase

1. **Delta Sync Cursor**: Refreshes query only rows with `updated_at >= cursor`, transferring 0 to 2 KB per poll rather than re-downloading entire tables.
2. **Adaptive Polling Intervals**: Backs off from 60s to 300s (and 180s to 600s for residents) when hostels are quiet, reducing database read egress by over 70%.
3. **Automatic Document Pruning**:
   - `ARCHIVE_DAYS = 120`: Day-wise logs dropped from local device storage.
   - `DOC_KEEP_DAYS = 30`: Serverless cron permanently wipes departed resident papers from Supabase Storage.
4. **Browser-Side Processing**:
   - Image compression (WebP/JPEG, 400px passport photos, 1200px documents) occurs client-side before upload, cutting egress and storage by ~80%.
   - OCR runs client-side in browser memory with zero external cloud API costs.
