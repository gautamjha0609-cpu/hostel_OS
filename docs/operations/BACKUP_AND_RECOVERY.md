# Sarvlekh (HostelOS) — Backup, Recovery & Disaster Operations

**Date**: November 2026  
**Status**: Verified Operational  

---

## 1. Backup Strategy & Architecture

Because Supabase Free Tier projects do not include automated daily point-in-time recovery (PITR), Sarvlekh implements an autonomous application-level backup and offsite replication architecture.

### 1.1 Snapshot Generation
- **Schedule**: Vercel daily cron triggers `GET /api/admin?cron=sweep` at 21:30 UTC.
- **Scope**: Every hostel is evaluated. Hostels that have not been backed up in the last 7 days are exported into a gzip-compressed JSON file containing:
  - Hostel metadata & settings
  - Active member roles & profiles
  - All operational documents in `public.docs` (`res`, `inv`, `pay`, `meter`, `agr`, `item`, `mv`, etc.)
- **Storage Target**: Private Supabase Storage bucket `backups/<hostel-id>/YYYY-MM-DD.json.gz`.
- **Retention**: Four weekly snapshots per hostel are retained in storage (`pruneBackups`).

### 1.2 Offsite Google Drive Replication
- **Integration**: Super-admin connects Google Drive via OAuth (`api/admin.js:drive_connect`).
- **Security**: Files replicated to Google Drive are encrypted using Scrypt key derivation and AES-256-GCM (`BACKUP_PASSPHRASE`). An unauthorized party gaining access to the Drive folder cannot read resident PII or financial records.
- **Target Folder**: `Sarvlekh Backups` folder created in the connected Google account.

### 1.3 KYC ID Document Separation
- Uploaded identity papers (Aadhaar, resident photos, police verification papers) are stored in the private Supabase `docs` bucket (`docs/<hostel-id>/<res|staff>/<id>/...`).
- These are not duplicated in the JSON backup to avoid storage bloating.
- Departed resident papers are automatically wiped 30 days post-checkout (`doc_files_garbage()`).

---

## 2. Recovery Objectives

| Metric | Target | Rationale |
|---|---|---|
| **Recovery Point Objective (RPO)** | **7 Days** (Free Tier) / **Instant** (Local Outbox) | Weekly automated snapshots; local client outbox buffers unsynced changes. Upgrading to Supabase Pro reduces RPO to Continuous (PITR). |
| **Recovery Time Objective (RTO)** | **< 5 Minutes** | Single-script command-line restoration restores an entire hostel into Postgres. |

---

## 3. Restoration Procedure

Restoration is performed using `scripts/restore.js`:

### Step 1: Inspection (Dry-Run)
Inspect the contents of a backup archive without modifying the database:
```bash
node scripts/restore.js backups/sample-hostel-2026-11-08.json.gz
```
Output displays:
- Hostel name and snapshot timestamp
- Total records count and login count
- Record breakdown by kind (`res`, `inv`, `pay`, `meter`, etc.)
- Target Supabase database URL

### Step 2: Live Database Restoration
Restore records back into the target hostel:
```bash
node scripts/restore.js backups/sample-hostel-2026-11-08.json.gz --yes
```
*Note: Existing records with identical IDs are updated; records created after the snapshot are preserved. Nothing is deleted.*

### Step 3: Disaster Recovery to Clean/Staging Project
To restore a hostel into a completely blank staging database:
```bash
node scripts/restore.js backups/sample-hostel-2026-11-08.json.gz --yes --with-hostel
```
Creates the parent `orgs` and `hostels` rows first, then populates all operational records and member profiles.

---

## 4. Failure Alerting

If the nightly sweep or hostel backup fails, `/api/admin` invokes `sendAlert(subject, detail)`:
- Dispatches HTTP POST notification to `ALERT_WEBHOOK_URL` (Slack, Discord, or monitoring webhook) with timestamp and error message.
