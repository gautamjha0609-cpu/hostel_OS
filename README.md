# Sarvlekh — Hostel & PG management SaaS

A mobile-first PWA (Hindi + English) for running hostels/PGs: rooms & beds, check-in with documents, rent + electricity + laundry billing with UPI pay links, WhatsApp messages without a paid API, mess with skip/tiffin cut-offs and stock learning, purchase requests, housekeeping schedules, gate, complaints, staff & salary, and a super-admin console for running it as a SaaS.

**Cost: ₹0/month** for ~10 hostels on the Vercel Hobby + Supabase Free tiers. ID papers are stored, compressed, in a private Supabase Storage bucket.

---

## 1. Architecture (kept small on purpose)

```
 Phone / desktop browser (PWA)                       Vercel (free)
 ┌──────────────────────────────┐   static files    ┌───────────────────────────┐
 │ index.html + js/*.js (no build)│◄────────────────│ /index.html /js /css /pay  │
 │ • offline-first local store   │                  │ /api/admin.js  (1 function)│──┐ service-role key
 │ • outbox → 1 batched upsert   │  user mgmt only  └───────────────────────────┘  │ (only here)
 │ • delta sync (1 small GET)    │─────────────────────────────────────────────────┼─┐
 └──────────┬───────────────────┘                                                  ▼ ▼
            │ REST (anon key + user JWT, row-level security)               Supabase (free)
            └─────────────────────────────────────────────────────────────► Postgres + Auth
            │ ID papers (compressed in the browser)                         orgs · hostels · profiles
            └──────────► Supabase Storage, private bucket `docs` (storage RLS: owner/manager only)
```

```
 QR pages (no login): visit.html · join.html · site.html ──► /api/public (gate entry, application, public page)
 Nightly: Vercel cron ──► /api/admin?cron=sweep ──► deletes papers 30 days after checkout
```

| Decision | Why |
|---|---|
| **No framework, no build** — plain JS files | Nothing to compile or upgrade; deploys as static files; very fast on low-end phones. |
| **One `docs` table** (jsonb) for all operational records, keyed `(hostel_id, id)` | One sync query, one batched write, simple RLS. 10 hostels ≈ 50–150k rows/year ≈ 50–150 MB — far under the 500 MB free limit. |
| **Offline-first store + outbox** | Reads are instant (local). Writes are optimistic, queued, sent as **one** upsert. Works with bad network; syncs on reconnect. |
| **Delta sync** (`updated_at >= cursor`) on open/foreground + every 60 s | A normal refresh is a single request returning 0–few rows. No realtime sockets needed. |
| **Deterministic IDs** (`inv-rent-{resident}-{month}`, `hkt-{date}-{room}-{schedule}`) | Automation can run on any device, any number of times — nothing is ever doubled. |
| **Automation in the client, once per day** | No paid cron/workers. Runs when the owner/staff opens the app. |
| **One serverless function** (`api/admin.js`) | Only creating/resetting logins needs the service-role key. Everything else goes straight to Supabase under RLS. |
| **WhatsApp via `wa.me` links** | No API cost. The app types the message; the owner taps Send. Bulk lists become a one-tap queue. |
| **UPI via `upi://` + `pay.html`** | Payments go directly to the owner's UPI ID (no gateway fee). `pay.html` is an https link WhatsApp can open, with a button for any UPI app plus a QR. |
| **ID papers in Supabase Storage** | Only what matters is kept: Aadhaar, the person's photo and the two police-verification papers. Compressed to WebP/JPEG in the browser (≈100–150 KB, a photo ≈50 KB) and uploaded straight to a private bucket, so nothing passes through our functions. A 50-bed hostel stays around 30 MB, because papers are deleted 30 days after checkout. |

### Data model
* `orgs` — a client (PG business). Super admin sets plan, fee, paid-till, status and the **client-wide module ceiling** (`orgs.modules`).
* `hostels` — 1..n per client. `settings` jsonb holds everything the owner configures; `hostels.modules` switches a module off in **one** PG without touching the client's other hostels. A module is live only when both allow it. Neither column is writable from a browser — `set_hostel_admin()` is super-admin only, and `hostels` grants `update` on `name, city, address, phone` and nothing else.
* `profiles` — one per login (`username` = what people type).
* `members` — role per org/hostel (`owner, manager, accountant, cook, housekeeping, laundry, guard, staff, resident`) + `perms` (extra modules) + `deny`. One login can have several memberships (multi-profile).
* `docs` — `kind` = `room, res, inv, pay, claim, dep, meter, laundry, menu, dish, item, mv, pr, skip, tiffin, leave, served, guestmeal, exp, staff, att, ratt, sal, hks, hkt, hkf, cmp, rinfo, gate, notice, ntf, log`.

### Money, in one place
Rent, electricity, laundry, late fees and **penalties** are all `inv` rows, so one balance rule
(`amount − paid − waived`) answers every screen. Two things ride on top of that and add no new
record kinds:
* **Advance rent.** The owner records one payment, ticks *this is an advance* and says how many
  months. The ordinary rent bill for each of those months is created now, the gap between what
  the months cost and what was handed over is written onto them as a **discount** (a waiver), and
  the normal oldest-first allocation settles them. The automation that writes monthly rent bills
  skips a month that is already billed, so nothing is charged twice. The receipt shows the span
  and the discount.
* **Penalties.** A fine carries a reason and behaves like any other charge, except that every
  payment screen asks whether to collect it *now*. Left out, it stays open until it is paid or
  cancelled — and the amount drops by the same figure, so the money the owner is not collecting
  for it never turns into silent credit. Cancelling writes a waiver; the fine is never deleted.

### Attendance and resident messages
* **`ratt`** — resident roll call. Everyone is present unless marked, so **only absences are
  stored**: one row per resident per month holding the day numbers and which roll calls were
  missed. A 50-bed hostel for a year is a few hundred small rows. The owner sets how many roll
  calls there are in a day and when (Settings → Attendance), or switches the whole thing off.
* **`rinfo`** — a resident telling the owner something about themselves (unwell, going home, back
  late), as opposed to a complaint about the hostel. It shares the Complaints screen but is a
  separate kind, so the open-complaint count and the repair workflow are untouched. A message
  covering a date shows up next to that resident on the attendance sheet.

### Security (row-level security in `supabase/schema.sql`)
* Owner/manager: everything in their hostels. Super admin: everything.
* Staff (cook, housekeeping, laundry, guard): their hostel's operational data, **no** payments/invoices/salaries. The guard also gets Attendance, since the night roll call is usually theirs.
* Residents: only their own bills, payments, meals, laundry, complaints, their room's cleaning, plus menu & notices. They can only create skip/tiffin/leave/complaint/UPI-claim/cleaning-feedback rows for themselves.
* Suspending a client in super admin blocks all of its logins instantly (data kept).
* Users can change only `full_name/phone/lang` on their profile; `is_super` is server-only.
* Module switches are not a cosmetic filter: a resident screen whose module is off is refused by
  the router too, so a bookmarked link cannot reach it.

### Module dependencies
Some modules cannot stand alone — the kitchen works out what to cook from the mess menu, and
cleaning tasks are assigned to housekeeping staff. `MOD_DEPS` in `js/domain.js` records this, and
every switch goes through `applyModSwitch()`: turning one **on** brings what it needs with it,
turning one **off** takes whatever needs it. The console says what else it moved. This is why a
switch can no longer leave a screen that silently shows zeros.

### Blocks (one hostel, several wings)
A hostel can be split into Block A, Block B, an annexe — without becoming separate hostels. One
inventory, one set of bills, one head count, so the platform still charges per hostel however
many blocks a client creates.

The platform admin creates blocks (Clients → hostel → **Blocks / wings**); they live on the
hostel row next to `modules`, so they cost no table and no extra query. A block is stored in
exactly **one** place: on a room. A resident's block is read back from the room they live in, a
payment's from the resident — so shifting someone from 101-A to 204-C moves their whole history
with them and nothing can fall out of step.

Filtering is one scope for the whole app, the strip under the header. `rooms()` and
`residents()` honour it and every other list is built from those two, so the app narrows at
once. Anything that charges money or exports data runs inside `withAllBlocks()`, which lifts the
filter — a wing filter must never decide who gets billed. A login can be tied to one block
(Settings → Users, logins & access), and then has no switch at all.

Expenses stay hostel-wide: gas, salaries and the internet bill are not a wing's to carry. The
Reports screen says so when a block is selected.

### Keeping big lists cheap
Reads are local, but "what does this resident owe?" used to walk every invoice in the hostel —
once per row, so a 100-person list was a hundred full scans per render. `index()` in
`js/domain.js` builds a per-resident map once and throws it away the moment `Store.ver` moves,
so it can never go stale. Measured on 120 residents × 1 440 invoices: **4.9 ms → 0.3 ms per
render.** Long lists also render in pages (`Show more`), and the sync itself already pulls only
rows changed since the last cursor, backing off while a hostel is quiet.

### The public hostel page
A one-pager the owner fills in under Settings → **Hostel page for enquiries**: photos, what a
bed costs, facilities, location, the questions every parent asks, and an enquiry form that
opens WhatsApp with the message already typed. Nothing is stored from that form — a public page
that writes to the database is a public page that can be filled ten thousand times by a script.

**Its address is the hostel's own name:** `https://sarvlekh.in/h/sunrise-boys-pg`. The domain
comes from `PUBLIC_SITE_BASE` in `js/config.js`; `/h/:slug` is rewritten to `site.html` (and a
`<base href="/">` keeps the page's own files loading from the root, since a rewrite leaves the
address bar on the pretty path). The slug lives in `settings.site.slug`, defaults to the hostel
name, and is matched against the stored value only — never rebuilt from the name server-side —
so a hostel answers at exactly the address its owner set. Until a domain is connected the page
is still reachable at `site.html?h=<id>`, so nothing waits on DNS.

**Photos are links, not files.** The owner keeps the pictures where they already are — in
practice a Google Drive folder shared as "Anyone with the link" — and pastes each share link
into one of six fixed, labelled slots: front, a room, bathroom, mess, common area, outside. The
slots are the same for every hostel, so nobody designs a page; they fill six boxes. `imgUrl()`
turns a Drive share link into Drive's thumbnail address (the viewer-page URL an owner copies is
not an image, and `uc?export=view` bounces larger files through a confirmation page), and the
editor shows a live preview so a link that will not load is caught there and not by a parent.
Holding the pictures instead would mean a megabyte per hostel inside a 500 MB database, synced
to every phone that opens the app; a link is about eighty characters. `img-src` in the CSP
allows `https:` for this reason — scripts, styles and connections stay locked to our origin.

Four gates have to be open before it serves anything: the client is active, the hostel is
active, the platform admin gave this client the **Public page** module, and the owner switched
the page on. A closed gate looks exactly like a wrong address, so the endpoint cannot be used to
discover which hostels exist. Responses are cached for five minutes at the edge, so an advert
going around a college WhatsApp group costs one database read, not one per reader.

---

## 2. Go live (about 20 minutes)

### A. Supabase
1. Create a free project at <https://supabase.com> (region: Mumbai).
2. **SQL Editor** → paste all of `supabase/schema.sql` → **Run**.
3. **Authentication → Sign In / Providers → Email**: turn **off** "Confirm email". (Logins use user ID + password; emails are internal.)
4. **Project Settings → API**: copy the **Project URL**, the **anon public** key and the **service_role** key.

### B. App config
Edit `js/config.js`:
```js
SUPABASE_URL: 'https://xxxx.supabase.co',
SUPABASE_ANON_KEY: 'eyJ...anon...',
```
(The anon key is meant to be public; RLS protects the data. **Never** put the service_role key in any file.)

### C. Vercel
1. Push this folder to a GitHub repo (or use `npx vercel` from this folder).
2. Import it in Vercel → Framework preset **Other**, no build command, output = root.
3. **Environment variables**:
   * `SUPABASE_URL` = project URL
   * `SUPABASE_SERVICE_ROLE_KEY` = service_role key
   * `SETUP_KEY` = any long random text (used once)
   * `AUTH_EMAIL_DOMAIN` (optional) — must equal `AUTH_EMAIL_DOMAIN` in `js/config.js`
   * `CRON_SECRET` = any long random text. Vercel sends it with the nightly document clean-up
     (`crons` in `vercel.json`); without it the clean-up refuses to run. The super admin can
     also run it by hand: **Usage & health → Delete old documents now**.
4. Deploy. Open `https://<your-app>.vercel.app/#/setup`, enter `SETUP_KEY`, create the super admin. You can delete `SETUP_KEY` afterwards.

### D. Onboard a client
Super admin → **New client** → business name, first hostel, owner name & mobile → WhatsApp opens with the owner's login. Add more hostels for the same client from the client page.

### E. Owner's first-day checklist
1. **Settings → Profile & UPI payments**: UPI ID (required for pay links).
2. **Rooms & Beds → Add room** for each room (rent per bed, number of beds).
3. **Documents**: nothing. Clients configure nothing — see below.

### ID papers — nothing to set up

`supabase/schema.sql` (section 12) creates the private `docs` bucket and its policies. Files
sit at `docs/<hostel>/<res|staff|signup>/<record>/<type>-<random>.<ext>`; only that hostel's
owner and manager (and the super admin) can upload or open them, and every Open is a link
that works for ten minutes. Nobody can delete from a browser. `doc_files_garbage()` decides
what goes: papers 30 days after a checkout or a staff removal, papers of applications that
were never admitted, a paper replaced by a newer upload, and abandoned uploads (after a day).

Rough size: a resident or staff member is 4 papers ≈ 0.5 MB. A 50-bed hostel with 8 staff is
≈ 30 MB at any time, so the free 1 GB holds about 30 hostels and Supabase Pro's 100 GB about
3,000. Hostel page photos are not in that figure — those are links the owner pastes.
4. Optional: electricity rate/free units, laundry free clothes, meal timings & cut-offs, dishes & menu, staff.
5. Check in residents — their logins are created automatically (user ID = name, password = mobile).

---

## 3. Free-tier budget (10 hostels × ~30 beds)

| Resource | Free limit | Expected use |
|---|---|---|
| Supabase database | 500 MB | 50–150 MB/year. Super admin → **Usage & health** shows it; "Clean up deleted records" frees space. |
| Supabase egress | 5 GB/month | Delta sync ≈ 1–5 KB per open. ~300 users × 20 opens/day ≈ 1 GB/month. |
| Supabase auth | 50,000 MAU | ~300–400 users. |
| Vercel bandwidth | 100 GB/month | App ≈ 250 KB first load, then cached by the service worker. |
| Vercel functions | 100k invocations | User management, the QR pages, one nightly clean-up. |
| Supabase Storage | 1 GB | ≈ 30 MB per 50-bed hostel. Super admin → **Usage & health** shows it. |

**Note:** Supabase pauses free projects after 7 days with **no** activity. Daily use by any hostel prevents this.

---

## 4. Local development
Needs Node 18+ and nothing else (no `npm install`: there are no dependencies).
```bash
cp env.local.example .env.local   # then fill in the STAGING project's values (see ENVIRONMENT_VARIABLES.md)
npm test          # 131 tests: billing, ledger, permissions, API authorization, QR pages, public page, CSP, WhatsApp gateway
npm run dev       # http://localhost:5176 — real app + real /api handlers; prints which database it uses
npm run dev:demo  # http://localhost:5177 — same source, no database: made-up data in the browser, demo logins on the login screen
npm run release   # not needed for deploys: Vercel runs it as the build command (vercel.json) so phones update at once
```
**Never develop against production.** With `SUPABASE_URL` + `SUPABASE_ANON_KEY` (and the staging
service-role key) in `.env.local`, `npm run dev` serves the whole app against the staging project
without touching `js/config.js`; without them it uses the production project in `js/config.js`
and says so when it starts. In demo mode, **Settings → Backup & export → Reset demo data** starts fresh.

Database changes: `supabase/schema.sql` is the full, re-runnable schema (a fresh project needs only
this file). Dated files next to it (`supabase/2026-11-02_members_lockdown.sql`) record each change
for projects that already exist; `supabase/verify_members_lockdown.sql` checks the authorization
rules on a live project and rolls back everything it creates.

## 5. Files
```
index.html            app shell            pay.html          UPI pay page sent on WhatsApp
css/app.css           iOS-style design     sw.js             offline support (network-first)
js/config.js          Supabase keys        js/core.js        utils, i18n, icons, UI kit
js/data.js            cloud/demo backend, offline store, sync, document upload
js/domain.js          business rules: billing, UPI, WhatsApp, mess learning, housekeeping, automation, permissions
js/app.js             login, profiles, navigation, routing
js/ui-*.js            screens (owner, operations, settings, resident, super admin)
js/i18n-hi.js         Hindi translations
api/admin.js          Vercel function for logins (service-role) and the nightly document clean-up
api/public.js         the no-login QR pages: visitor entry, resident application, public page
api/_lib.js           helpers shared by the functions
supabase/schema.sql   tables, indexes, RLS, RPCs, the `docs` storage bucket
api/wa.js             optional self-hosted WhatsApp gateway (WAHA / Evolution API)
visit.html            public visitor form opened from the gate QR (no login)
join.html             public resident self-registration opened from the QR in Settings
site.html             public hostel page for enquiries (css/site.css, js/site.js)
js/geo.js             location → "locality, city, state", geofence distance
scripts/release.js    stamps the service-worker version
tests/                node:test suites
```


## 6. Operating notes

* **Deploying:** run `npm run release` first. The service worker serves the app from the phone's
  cache (about 1–2 requests per app open instead of about 15) and refreshes in the background
  every 12 hours; a new VERSION makes every phone take the new files on its next open.
* **Server calls kept low:** data sync backs off from 60 s to 5 min while nothing changes,
  documents go straight to Storage, and the WhatsApp gateway sends 5 messages per call.
* **Database:** re-run `supabase/schema.sql` once after this update — it adds the
  `wa_gateways` table, lets a resident mark their own room cleaned (when the owner allows it),
  and fixes resident messages (`rinfo`) being refused.
* **Visitor QR:** Gate & Visitors → QR button. Print it at the gate. "New QR" changes the key,
  which stops every old printout.
* **Reports:** pick a period once (this month, last month, a financial year, any two dates); every download follows it. "Complete analysis (Excel)" builds one workbook in the browser (js/xlsx.js + js/report.js, loaded only then): a summary page, P&L, cash flow, costs, dues, occupancy, electricity, inventory, laundry, payroll and the payment/expense ledgers, with live formulas and a print header/footer.
* **Sign-in screen:** background pictures are img/login-phone.webp and img/login-desktop.webp (the brand mark is part of the picture); swap the files to rebrand.
* **WhatsApp:** with no gateway, messages open in WhatsApp typed and ready (free, no risk).
  The ONLY message ever sent automatically is the monthly bill (rent + electricity, once per resident per month, after the meter is read, or from a fallback day); everything else opens WhatsApp for the owner to press Send. Automatic sending needs the owner's own WAHA or Evolution API gateway behind a public https
  address (a free Cloudflare Tunnel works). It is unofficial: use a separate number, because
  WhatsApp can block numbers that send a lot.
  **Shared gateway (owners just scan a QR):** run one Evolution API server (Docker) behind a public
  https address and set `EVOLUTION_URL` and `EVOLUTION_API_KEY` in the Vercel environment. Each
  hostel then gets its own instance (`h-<hostel id>`); the owner opens Settings → WhatsApp →
  Connect WhatsApp and scans the QR with their own phone, so messages leave from their number.
  Run `supabase/wa_gateways.sql` once if the `wa_gateways` table is missing.
* **Police verification:** all 36 states/UTs have a built-in link. Assam, Delhi, Maharashtra,
  Rajasthan and Tamil Nadu open the tenant form directly; the others open the state's citizen
  portal, or the national digitalpolice.gov.in where no state portal is known. Every link can be
  replaced in Settings → Police verification.

## Running on the free tiers (Supabase + Vercel Hobby)

* **Database size.** Supabase's own tables (auth, storage, migrations) are about 11 MB on a brand-new
  project, so "Usage & health" shows a size split: your clients' data vs Supabase's system tables.
  The 500 MB limit counts both; only the first grows with the business. After a big delete, run
  `reindex table public.docs;` in the SQL editor to give the index space back.
* **Free projects pause after 7 days without activity.** The nightly cron in `vercel.json`
  (`/api/admin?cron=sweep`, needs `CRON_SECRET`) queries the database every day, which keeps it awake.
* **Turn off public sign-ups** (Supabase → Authentication → Sign In / Up → "Allow new users to sign
  up"). Logins are created only by `/api/admin`. Leaked-password protection is a Pro-plan feature.
* **Vercel functions** are bounded (every Supabase call gives up after 8 s, under the 10 s Hobby
  limit), answer in JSON on every failure, and remember who is calling for 15 s so one screen does
  not cost three database round trips per request. Only four functions exist (limit: 12).
* **Content-Security-Policy is enforced** (`script-src 'self'`): no inline `onclick=` handlers and no
  `<base>` tag. `npm test` fails if either comes back; use `data-act` / `data-flt` instead.
* **Reading data in pages.** PostgREST stops silently at 1000 rows, so the super admin screens load
  owners and staff in pages and resident logins only on request. The app itself syncs only rows
  changed since its last cursor and polls less often while a hostel is quiet.

## Backups

Supabase's free plan keeps none, so the daily cron also writes a weekly gzip backup of every hostel (its
settings, logins' roles and all records) to the private **backups** bucket, the newest four per hostel.
Each run does as many hostels as fit in its time budget and finishes the rest the next day. To restore,
download a file from Supabase → Storage → backups and run `node scripts/restore.js <file>` (add `--yes`
to write). It also pays to download one now and then: a backup in the same project does not protect
against losing the project itself.

### Copy backups to Google Drive

Super admin: **Usage -> Backups -> Connect Google Drive**. Google asks once; the refresh token is kept in the
`drive_link` table (no policy, so only the server reads it) and each hostel's weekly file is also written to a
**Sarvlekh Backups** folder in that Drive (scope `drive.file`: the app sees only what it created). Set
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `BACKUP_PASSPHRASE` as environment variables (Vercel and
`.env.local`), and allow `https://<your domain>/api/admin?oauth=callback` as a redirect URI on the OAuth client.
Files from Drive ending in `.enc` are opened by `scripts/restore.js` when `BACKUP_PASSPHRASE` is set.
