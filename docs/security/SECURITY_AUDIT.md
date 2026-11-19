# Sarvlekh (HostelOS) — Security & Multi-Tenant Audit

**Audit Date**: November 2026  
**Security Status**: Hardened & Production Validated  

---

## 1. Multi-Tenant Isolation & Boundary Enforcement

In Sarvlekh, tenant isolation is maintained at both the database layer (Row-Level Security) and the serverless API layer.

### 1.1 Row-Level Security (RLS) Analysis
Every table in Supabase has RLS enabled (`alter table public.<name> enable row level security`):

- **`public.orgs`**:
  - `orgs_read`: Members can SELECT only organizations where they hold an active membership row (`id in (select org_id from my_access())`) or if caller is platform super-admin (`is_super()`).
  - INSERT/UPDATE/DELETE: Restricted strictly to platform super-admins.
- **`public.hostels`**:
  - `hostels_read`: Members can SELECT only hostels within their permitted organizations.
  - `hostels_update`: Owners and managers can only modify settings for hostels they manage (`id = any((select full_hostels())::uuid[])`). Column-level permissions restrict updates to harmless columns (`name, city, address, phone, settings`). Module ceilings and status columns cannot be altered by owners.
- **`public.members`**:
  - Lockdown rules prevent managers from escalating privileges or attaching themselves to unassigned hostels. Scoped managers cannot create org-wide memberships.
- **`public.docs`**:
  - Finance documents (`inv`, `pay`, `claim`, `sal`, `exp`, `dep`) are hidden from operational staff (cook, guard, cleaner).
  - Residents can only read documents where `res_id` matches their own linked resident ID (`my_res_keys()`), documents for their assigned room (`my_room_keys()`), or public hostel notices/menus.
  - Residents can only insert/update whitelisted kinds (`skip`, `tiffin`, `cmp`, `claim`, `hkf`, `leave`, `rinfo`) carrying their own `res_id`.

### 1.2 Serverless API Authorization (`/api/admin`, `/api/public`)
- Privileged operations (`makeUser`, `addMembership`, `setPassword`, `setActive`) run under the Supabase service-role key, bypassing PostgreSQL RLS. Therefore, application-layer authorization is independently enforced:
  - `assertAdmin(me, orgId, hostelId)`: Verifies that the authenticated caller has an `owner` or `manager` role inside the target organization. A manager scoped to Hostel A cannot execute actions on Hostel B.
  - Cross-tenant injection is strictly prevented: An owner of Org 1 cannot create or manipulate user memberships in Org 2 (`uuid(orgId, 'client')` validation).
  - Rate limiting (`limit(key, max, windowMs)`): Protects sensitive endpoints against brute-force attacks and abuse.

---

## 2. Secrets Management & Credential Boundaries

| Secret Name | Location | Exposure Risk | Protection Strategy |
|---|---|---|---|
| `SUPABASE_ANON_KEY` | `js/config.js` | Public | Designed for public client distribution; all access is constrained by RLS. |
| `SUPABASE_SERVICE_ROLE_KEY` | `.env.local` / Vercel Env | Critical | Stored strictly in server environment variables. Never bundled into client JavaScript. |
| `VAPID_PRIVATE_KEY` | Server Env | Critical | Private key for push signing never leaves the serverless execution boundary. |
| `CRON_SECRET` | Server Env | High | Validated via `crypto.timingSafeEqual` in `/api/admin?cron=sweep`. |
| `PAYMENT_WEBHOOK_SECRET` | Server Env | High | Used to compute and verify HMAC-SHA256 signatures for payment webhooks. |
| `BACKUP_PASSPHRASE` | Server Env | High | Derives Scrypt key for AES-256-GCM encryption of Google Drive backup snapshots. |

---

## 3. Input Validation & Content Security Policy (CSP)

### 3.1 Content Security Policy
Enforced in `vercel.json` and mirrored in `scripts/dev-server.js`:
```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: https:;
font-src 'self';
connect-src 'self' https://*.supabase.co https://api.bigdatacloud.net https://nominatim.openstreetmap.org;
form-action 'self';
frame-ancestors 'none';
base-uri 'none';
object-src 'none'
```
- **No Inline Event Handlers**: `script-src 'self'` blocks all `onclick` and `<script>` injection attacks.
- **Clickjacking Protection**: `frame-ancestors 'none'` and `X-Frame-Options: DENY` prevent framing.
- **Base URI Hijacking**: `base-uri 'none'` prevents relative address manipulation.

### 3.2 Input Sanitization & Boundaries
- **Mobile Numbers**: Validated via `cleanPhone()` enforcing Indian 10-digit mobile standards with prefixes `[5-9]`.
- **Financial Amounts**: Validated via `round2()`, enforcing strict positivity (`amount > 0`) and upper ceiling limits (`₹10,000,000`).
- **File Upload Guard**: Validates MIME types (`application/pdf`, `image/*`) and enforces a 1.5 MB upload ceiling before network transmission.
- **Offline Vault**: Outbox writes stored on devices are sealed using Web Crypto AES-256-GCM (`CryptoVault`) to protect data on shared/unlocked hardware.

---

## 4. Privacy & Compliance Disclaimers

- **Resident Data Retention**: Documents belonging to departed residents are automatically scheduled for permanent deletion 30 days after checkout (`DOC_KEEP_DAYS = 30`).
- **Electronic Rental Agreements**: Digital rental agreements include explicit disclaimers:
  > *"This electronic document is a binding rental contract under the Information Technology Act, 2000. It does not replace state-specific mandatory stamp duty or biometric Aadhaar eSign registration requirements where applicable."*
