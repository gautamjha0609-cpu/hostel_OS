# GitHub release report

Target: `https://github.com/gautamjha0609-cpu/hostel_OS.git`

## Remote, as found (2026-11-02, read-only checks)

| Question | Answer |
|---|---|
| Exists | yes (`gautamjha0609-cpu/hostel_OS`) |
| Visibility | **PUBLIC** (`"private": false` from the GitHub API) |
| History | **empty** — `git ls-remote` lists no branches and no commits |
| Default branch | none yet (an empty repo has none) |
| Connected elsewhere | nothing visible; no Vercel project uses it (the Vercel account has only `dharam-kata`) |

## Local repository

* The project folder was **not** a git repository. Initialised with `git init -b production-readiness`
  (the release-candidate branch name requested); no other branch exists, nothing was rewritten.
* `.gitignore` rewritten to exclude: every `.env*` file (real `.env.local` holds the service-role
  key; `.env.whatsapp` holds Meta tokens), `node_modules/`, build/test/Lighthouse output, database
  dumps and backup files (`*.json.gz`, `*.sql.gz`, `backups/`), logs, editor folders — and the
  operational files that name the real client and its ids (`DATABASE_INVENTORY.md`,
  `DATA_CLEANUP_PLAN.md`, `DATA_CLEANUP_EXECUTION_REPORT.md`, `supabase/cleanup/`). Those stay on
  this PC.
* `env.local.example` (placeholders only) is committed.

## Secret scan (files that would be committed)

Patterns: Supabase service/secret keys (JWT with `service_role`, `sb_secret_`), Meta tokens (`EAA…`),
Google OAuth secrets (`GOCSPX-`), private keys, GitHub tokens, AWS keys, any JWT.

| Result | |
|---|---|
| Service-role key, CRON secret, Google/Meta/GitHub/AWS secrets, private keys | **none found** |
| JWTs found | 1 — `js/config.js`, role **`anon`**: the public browser key, safe to publish by design (row-level security protects the data) |
| Real client names / ids | none in the commit set (moved to ignored files) |
| Git history | there is none yet, so nothing old can leak |

## Push status

**Pushed** on 2026-11-02 at the owner's explicit choice ("Public mein push"), to the public repository.

* `git push -u origin production-readiness` — a new branch on an empty remote; no force, no other
  branch touched. Run from the owner's terminal (Git Credential Manager sign-in); the agent's own
  shell had no GitHub credentials.
* First commit `bc8f46c`: local = remote, ahead/behind 0/0, verified with `git ls-remote` and
  the GitHub contents API (no `.env*`, inventory or cleanup files listed).
* Later documentation-only commits on the same branch are pushed the same way (fast-forward only).

Consequence of the public repo: the production Supabase URL and the public `anon` key are
readable by anyone. That is safe only because every table is protected by row-level security
(verified on the live database today); keep the service-role key out of the repository forever.

**Known leftover in history:** the first commit `bc8f46c` mentions the real client's business name
once (in `ENVIRONMENT_AND_PORT_AUDIT.md`); the next commit removes it. No ids, logins, phone numbers
or records were ever committed. History was not rewritten (no force-push, as agreed); if the name
must disappear from history too, that needs an explicit decision to rewrite the branch.
