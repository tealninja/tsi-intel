# TSI-Intel — Cutover Runbook (D1 seed + shared-key auth)

Branch: `feature/db-seed-and-auth`. This runbook is the ordered, copy-pasteable
procedure for the steps that need **Cloudflare credentials** — everything up to
these points has already been built and validated locally (see "What's already
done" at the bottom).

> **Prerequisite for everything below:** a Cloudflare session. This session had
> **no** Cloudflare access (no MCP connector, `wrangler` not logged in), so none
> of the `--remote` / `deploy` / `secret` steps below have been run. Get access
> first, one of:
> - Connect the **Cloudflare MCP** connector, **or**
> - `npx wrangler login` (opens a browser OAuth — do this yourself), then
>   `npx wrangler whoami` should show your account.

All commands run from the repo root on `feature/db-seed-and-auth`.

---

## Part A — D1 seed load (safe against the live app)

The live app serves from **KV**, never D1, so all of Part A is invisible to the
running app. Every promoted row is tagged `source_batch='dynamics_2026_06_30'`,
so Part A is exactly reversible (Step A9).

The remote D1 already has the base schema applied (tables exist, empty). Do **not**
re-apply `schema.sql` to remote.

### A1 — (optional) re-confirm the local dry run
```
python scripts/build_load_staging.py         # regenerates scripts/load_staging.sql
# The full local dry run was already executed and passed; re-run it if you edited any SQL.
```

### A2 — staging tables (remote)
```
wrangler d1 execute tsi-intel --remote --file=migrations/001_staging.sql
```
Rollback: `DROP TABLE staging_accounts; DROP TABLE staging_enrichment; DROP TABLE staging_contacts; DROP TABLE staging_products;`

### A3 — load staging rows (remote)
```
wrangler d1 execute tsi-intel --remote --file=scripts/load_staging.sql
```
Loads 389 accounts (374 seed + 15 net-new enrichment orgs), 57 enrichment rows,
371 contacts, 131 products. Rollback / re-run:
`DELETE FROM staging_accounts; DELETE FROM staging_enrichment; DELETE FROM staging_contacts; DELETE FROM staging_products;`

### A4 — validate staging (remote) — **GATE: do not proceed unless clean**
```
wrangler d1 execute tsi-intel --remote --file=scripts/validate_staging.sql
```
Every row's `n` must equal its `expect`:
`accounts=389, contacts=371, products=131, enrichment=57, net_new_orgs=15,
enrichment_orphans=0, products_null_price=131, orphan_account_parents=0,
orphan_product_parents=0, contacts_no_account=17, contacts_bad_account_ref=0,
bad_account_type=0`, and `load_batch` uniform = `dynamics_2026_06_30`.
**Any mismatch → STOP**, investigate, do not promote.

### A5 — provenance columns (remote, run ONCE)
```
wrangler d1 execute tsi-intel --remote --file=migrations/002_provenance.sql
```
`ADD COLUMN` is not idempotent — a re-run errors "duplicate column name" (benign;
means it's already applied). Rollback: leave them (harmless NULLs).

### A6 — promote to live tables (remote)
```
wrangler d1 execute tsi-intel --remote --file=migrations/003_promote.sql
```

### A7 — verify promotion (remote)
```
wrangler d1 execute tsi-intel --remote --file=scripts/verify_promotion.sql
```
Expect `organizations=389, persons=371, products=131, person_emails=357,
person_phones=322, person_organizations=354, orgs_with_parent=97,
products_with_parent=19`, enrichment coverage `orgs_with_acct_match=57,
orgs_with_geo=42, orgs_geo_source_plant=42, orgs_with_industry=27,
orgs_with_plant_type=42`, `product_prices=0`, and **`PRAGMA foreign_key_check`
returns zero rows**.

### A8 — (optional) drop staging tables
Staging has served its purpose after promotion. Keep them if you want to re-promote;
otherwise `DROP TABLE staging_accounts; staging_enrichment; staging_contacts; staging_products;`.

### A9 — Part A rollback (exact, if ever needed)
```
wrangler d1 execute tsi-intel --remote --file=scripts/rollback_promotion.sql
```
Deletes only `source_batch='dynamics_2026_06_30'` rows (children first). The
pre-existing `users` row and anything else are untouched. Verified locally.

> **Known gap (intentional):** all 131 products have NULL price, so `product_prices`
> gets **zero** rows this batch. Prices are entered manually later as a separate task.
>
> **Enrichment note (DECISION-1):** this load is the *enriched* dataset. 72 crosswalk
> entries merge onto 57 orgs (42 existing seed orgs + 15 net-new `acct_0375..0389`),
> carrying the load-bearing `acct_match` alias plus geo/industry/plant_type. One
> lossy spot: West Fraser is 4 plant sites in the app but one corporate org in the
> seed, so its org row keeps a single coordinate (3 site coordinates are dropped).
> Representing plant sites individually would be a later site-level enhancement.

---

## Part B — Security cutover (THE DISRUPTIVE STEP — needs coordination)

**Why it's disruptive:** turning on the shared key changes the live Worker from
"open" to "key required," and the currently-served HTML sends **no key**. Between
"Worker now requires a key" and "new keyed HTML is live," the app is down. Do
Part B as one tight, scheduled window. **Do not start until you can also publish
the new HTML immediately after.**

### ⚠️ Two behavior changes at cutover, not one
1. **Auth** — the Worker will require `X-TSI-Key` on every `/api/*` call except
   `/api/health`. (Verified locally: fail-closed, GET included, `/api/ai` closed.)
2. **CORS** — the hardened Worker replies with a CORS **allowlist**, not `*`. The
   app is served from **SharePoint** (cross-origin), so `ALLOWED_ORIGINS` in
   `worker.js` **must** contain the app's exact SharePoint origin, e.g.
   `https://<tenant>.sharepoint.com` (scheme + host, no path). If it's wrong/empty,
   the browser blocks the app from reading responses **even with a valid key**.
   → **Decision required (see below).**

#### CORS decision — pick one before deploying
- **(Recommended) Lock CORS:** put the real SharePoint origin in `ALLOWED_ORIGINS`
  and verify on staging. Best security; needs the exact origin (read it from the
  SharePoint address bar where the app lives).
- **Match today's behavior:** if you'd rather change only ONE variable at cutover,
  set `ALLOWED_ORIGINS` to keep `*` for now and lock CORS later. Auth is still fully
  enforced by the key; CORS is not an auth boundary. (Plan §3.5 lists CORS-lock as
  optional.) To do this, tell me and I'll wire a one-line `CORS_OPEN` flag.

### B1 — build + FULLY TEST on a separate staging Worker (never touch live first)
```
wrangler deploy --env staging                     # deploys tsi-intel-api-staging
wrangler secret put TSI_API_KEY --env staging     # paste a STAGING key when prompted
```
Point a throwaway copy of the HTML at `https://tsi-intel-api-staging.<sub>.workers.dev`
(set `API_WORKER_URL` + `TSI_API_KEY` to the staging values) and confirm from the
**real SharePoint page** (so CORS is exercised for real):
- no key → 401 · correct key → 200 · `/api/ai` without key → 401 · `/api/health` → 200
- the app actually renders (proves the SharePoint origin is in `ALLOWED_ORIGINS`)

> Staging binds the **live KV** by default (reads only). Do NOT run POST/PUT/DELETE
> tests against staging or you'll mutate live pipeline data — see the warning in
> `wrangler.toml`. Create a separate staging KV first if you want to test writes.

**Only proceed to B2 once staging passes end-to-end.**

### B2 — generate the shared key + set the LIVE secret
```
# generate a strong key (example)
openssl rand -base64 24
wrangler secret put TSI_API_KEY                   # paste the key (LIVE Worker)
```
(`ANTHROPIC_API_KEY` is already a live secret; leave it.)

### B3 — deploy the hardened Worker to LIVE  ← app goes key-required at this instant
```
wrangler deploy
```

### B4 — publish the keyed HTML IMMEDIATELY (closes the outage window)
In `tsi-intel.html` set:
```
const TSI_API_KEY = '<the same key from B2>';
```
(`API_WORKER_URL` already points at the live Worker.) Re-upload the HTML to
SharePoint. `workerHeaders()` already attaches `X-TSI-Key` when the constant is
non-empty — no other HTML change needed.

> The committed `tsi-intel.html` keeps `TSI_API_KEY=''` on purpose (no secret in
> git). The key is pasted only into the copy uploaded to SharePoint at B4.

### B5 — verify live
- Load the app in SharePoint → pipeline/bugs/usage render, AI works.
- `curl https://tsi-intel-api.teal-john.workers.dev/api/pipeline` (no key) → 401.
- `curl .../api/health` → 200.

### Part B rollback
- **Fastest:** `wrangler rollback` (Cloudflare keeps deploy history) returns the
  previous Worker. Because the new code is fail-closed, also decide the key state:
  reverting code **and** leaving the secret set is fine; the previous (open) code
  ignored it. If you re-deploy the OLD open Worker, the old HTML (no key) works again.
- **HTML:** re-upload the previous `tsi-intel.html` (or `git revert` the key commit).
- Roll back **code and HTML together** so you never have keyed-Worker + unkeyed-HTML.

### Rotation (later)
`wrangler secret put TSI_API_KEY` (new) → update the HTML constant → re-upload. To
avoid a lockout window, add a temporary second accepted key (`TSI_API_KEY_PREV`) in
`isAuthorized`, ship the new HTML, then drop the old key.

---

## What's already done (this branch, no Cloudflare access needed)

- **Local dry run PASSED** end-to-end via `wrangler d1 execute --local` (enriched
  dataset): staging load (389/57/371/131) → validate (all checks = expected) →
  provenance cols → promote (389/371/131 + 357/322/354 + 97/19 parents + enrichment
  57 acct_match / 42 geo / 27 industry / 42 plant_type + 0 prices) →
  `foreign_key_check` clean → rollback returns to zero, leaving pre-existing rows intact.
- **Auth logic VERIFIED locally** via `wrangler dev --local`:
  fail-closed when the key is unset (all non-health routes 401 even with a key);
  with the key set: health open, GET/POST require the key, wrong key 401,
  `/api/ai` returns our 401 with no key (open-proxy risk closed), OPTIONS 204.
- **Not done (needs Cloudflare access):** every `--remote` step, the staging/live
  deploys, `wrangler secret put`, and the real-SharePoint CORS check. Nothing was
  deployed and nothing was merged to `main`.
