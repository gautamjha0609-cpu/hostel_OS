# Environment variables

Server-side only. They are read by the three Vercel functions in `api/` (and by
`scripts/dev-server.js` from `.env.local` when you run locally). **Nothing here is ever sent to
the browser.** The browser's settings (Supabase URL and the public *anon* key) live in
`js/config.js`; the anon key is public by design and is protected by row-level security.

Never put real values in this file, in the repo, or in chat. `.env*` is listed in both
`.gitignore` and `.vercelignore`.

| Variable | Purpose | Required? | Development (`.env.local`) | Preview | Production |
|---|---|---|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Secret key for the Supabase project. Used only by `/api/*` to create logins, reset passwords, run the clean-up and backups. | **Required** | Yes (use a *test* project's key) | Yes (test project) | Yes |
| `SUPABASE_URL` | Supabase project URL. Defaults to the project in `js/config.js`. Locally, set it together with `SUPABASE_ANON_KEY` to run the whole app against staging (the dev server rewrites `js/config.js` on the fly; `scripts/restore.js` writes there too). | Optional | **Set to staging** | Recommended (staging project) | Optional |
| `SUPABASE_ANON_KEY` | Staging project's public anon key. Local dev server only; with `SUPABASE_URL` it points the browser at staging. Not read on Vercel. | Optional | **Set to staging** | No | No |
| `CRON_SECRET` | Protects `GET /api/admin?cron=sweep` (nightly document clean-up + weekly backups). Vercel sends it automatically to cron calls. Any long random string. | **Required in production** (without it the cron always gets 401 and no backups are made) | Optional | Optional | **Yes** |
| `AUTH_EMAIL_DOMAIN` | Domain used to turn a user ID into a login email (`ravi@<domain>`). Default `login.hostelos.app`. Must equal `AUTH_EMAIL_DOMAIN` in `js/config.js`. Changing it after users exist locks them out. | Optional | Optional | Optional | Optional (leave unset) |
| `SETUP_KEY` | One-time key for creating the first super admin at `/#/setup`. A super admin already exists, so **leave unset** and delete it if set. | Optional (first install only) | No | No | No |
| `BACKUP_PASSPHRASE` | Encrypts backup copies written to Google Drive. Keep a copy offline — without it those files cannot be opened. | Optional (recommended with Drive) | No | No | If Drive is used |
| `GOOGLE_CLIENT_ID` | Google OAuth client for the optional Drive copy of backups. | Optional | No | No | If Drive is used |
| `GOOGLE_CLIENT_SECRET` | Pair of the above. Also signs the OAuth `state`. | Optional | No | No | If Drive is used |
| `GOOGLE_REDIRECT_URI` | Overrides the OAuth callback URL (default: `https://<host>/api/admin?oauth=callback`). | Optional | No | No | Only behind a proxy |
| `EVOLUTION_URL` | Shared WhatsApp (Evolution API) server, for the optional automatic WhatsApp sending in `api/wa.js`. Shelved for now; owners use `wa.me` links. | Optional | No | No | No |
| `EVOLUTION_API_KEY` | Pair of the above. | Optional | No | No | No |
| `PORT` | Port for the local dev server only (default 5173). | Optional | Optional | n/a | n/a |

Not read by any code: `.env.whatsapp` (Meta WhatsApp Cloud API credentials) is kept locally for
a future official-API integration. Do not add those to Vercel until code uses them.

## Separate environments

* **Development and Preview must not use the production Supabase project.** Create a second
  free Supabase project (the free plan allows two), run `supabase/schema.sql` and then every
  `supabase/2026-*.sql` file in it, and use its URL and keys for local work and Vercel Preview.
  For Preview, also point `js/config.js` at it (it is a static file, so the simplest route is a
  `staging` branch whose `config.js` holds the staging URL/anon key).
* In Vercel → Project → Settings → Environment Variables, tick **Production** only for the
  production key, and **Preview / Development** only for the staging key.
