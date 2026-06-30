# TSI Intel — feature implementation TODO

Working list for wiring the CRM seed data (`seed_accounts.json`, `seed_contacts.json`,
`seed_products.json`) into the app, and the features that unlocks. Status legend:
`[ ]` not started · `[~]` in progress · `[x]` done · `[?]` needs a decision.

## 0. Decisions to make first (blockers)

- [x] **DECISION-1 — Account model strategy — DECIDED: seed canonical + enrich.**
  The seed (374) becomes the single account list. It already beats the app on identity,
  scale, the corporate→site hierarchy (`parent_account_name`/`parent_seed_id`), `account_type`,
  and CRM fields (`dynamics_id`, address, website). We **enrich** seed records with the data
  that lives *only* in the app's 72 `DEFAULT_ACCOUNTS` and cannot be regenerated:
  - **Operational/geo** — `lat`/`lon`/`plantType` (45 of 72), `industry` (27 of 72). Seed has 0.
    Drives the maps + weather features.
  - **`acctMatch` alias layer — load-bearing.** Only 15 of 38 distinct pipeline `acct` strings
    naive-match the seed; the other 23 are internal site codes (`LP (LPLA)`,
    `WEAL (West Fraser Allendale)`, `Drax (DRUR)`, `Idemitsu SE Asia #2`, misspelled
    `Weyerhauser`). These resolve today only via hand-tuned `acctMatch`. Carry it onto the
    seed records or ~60% of pipeline→account links break.
  - **Reconcile by hand:** ~50 app accounts match a seed record (enrich those); ~22 are
    app-only (Georgia-Pacific, Van Lung, Arauco, site-code rows) — map or add as seed-origin.
- [?] **DECISION-2 — Storage for the CRM data. FINDING: the Worker is KV-backed, NOT D1.**
  Verified via Cloudflare API: `tsi-intel-api` binds KV namespace `tsi-pipeline-data` (`env.TSI_DATA`)
  and stores whole-JSON blobs under keys `pipeline` / `bugs` / `usage_log` / `locks/:id`. There is
  no D1 binding. The account's only D1 db (`dive-log`) is empty and unrelated. So the manifest's
  `staging_accounts/contacts/products` SQL tables do **not** exist and can't without introducing D1.
  Real choice:
  - (A) **Extend KV** — add `accounts`/`contacts`/`products` blob keys; client joins in JS (current
    pattern). Minimal Worker change, ships fast. No server-side query/joins/integrity; staging is a
    flag or separate keys, not tables.
  - (B) **Introduce D1** — new `tsi-intel` database with real tables + `staging_*`; rewrite Worker
    endpoints + client sync to be query-based. Matches the relational seed (FKs everywhere) and the
    manifest's staging→promote intent. Bigger lift.
  - (C) **Hybrid** — pipeline stays in KV (untouched, works today); CRM reference data
    (accounts/contacts/products) goes to D1. Clean separation, two stores in one Worker.

  **DECIDED: (B) full D1 migration — target architecture.** Phased so nothing ships half-built:
  - **The git seed files ARE the staging layer.** They stay in git as source-of-truth; no
    KV/D1 writes happen now. This is the manifest's "staging" step, version-controlled.
  - **When ready, one deliberate migration:** create the `tsi-intel` D1 database + schema,
    load the git seed (with DECISION-1 enrichment baked in), then cut the Worker endpoints
    and client sync over from KV blobs to D1 queries.
  - **Phasing note:** the existing pipeline/bugs/usage live in KV today. "Full" D1 means they
    move too — that's a Worker + client-sync rewrite. Can be sequenced (CRM tables first,
    pipeline KV→D1 second) to de-risk; decide sequencing when we scope section 5.
- [x] **DECISION-3 — ID strategy — DECIDED (follows from DECISION-1 + 2): `seed_id` is canonical.**
  `seed_id` (`acct_0001` etc.) becomes the D1 primary key; `dynamics_id` kept as a column for
  CRM traceability. The app's `AG-*`/`S-*` codes survive only as a build-time crosswalk used to
  enrich the ~50 matched records (carry their `acctMatch` alias + geo onto the seed row), then
  retired. FKs reference `seed_id`: `contacts.account_seed_id`, `accounts.parent_seed_id`,
  `products.parent_seed_id`, and (future) `pipeline.account_seed_id`.

## 1. Schema reconciliation

- [ ] Write the seed→app field map for accounts (see gaps table in PR/notes).
  - [ ] `parent_seed_id` → `parentId` via ID crosswalk
  - [ ] `city`/`state`/`country` → `loc` (and keep structured address fields)
  - [ ] Derive `acctMatch` (pipeline links by this string) — name + `formal_name` aliases
  - [ ] Find a home for `account_type`, `dynamics_id`, `formal_name`, `website`, `phone`, address
- [ ] Bump `SCHEMA_VERSION` (currently 2) and add a migration in `loadAccounts()` for the new fields.
- [ ] Decide whether `account_type` becomes a filter/badge in `view-accounts`.

## 2. Accounts import (seed = canonical)

- [ ] Loader that maps all 374 `seed_accounts.json` into the unified `accounts[]` shape.
- [ ] Resolve seed `parent_seed_id` hierarchy → `parentId` (keep seed IDs as canonical).
- [ ] **Build the app↔seed match table** for the 72 defaults (50 auto by name/`formal_name`,
      ~22 by hand).
- [ ] **Enrich** matched seed records with `lat`/`lon`/`plantType`/`industry`/weather and the
      hand-tuned `acctMatch` alias string from the app defaults.
- [ ] Add the ~22 app-only accounts as seed-origin records (no `dynamics_id`).
- [ ] Re-link pipeline rows: confirm all 38 `acct` strings still resolve via `acctMatch`.

## 3. Contacts import

- [ ] Loader for `seed_contacts.json` (371) → app `contacts[]`.
  - [ ] `full_name`→`name`, `job_title`→`title`, `email`→`email`
  - [ ] Collapse/keep `business_phone` + `mobile_phone` (app currently has one `phone`)
  - [ ] `matched_account_seed_id` → `accountIds[]` via crosswalk; 17 standalone → `[]`
- [ ] Surface contacts in `view-accounts` (per-account contact list).

## 4. Products catalog (net-new)

- [ ] New `products[]` store (no current equivalent in the model).
  - [ ] Fields: `pn`, `name`, `category`, `structure`, `parent_pn`/`parent_seed_id`, `price`, `status`
  - [ ] Render the 21-category / Product→Family hierarchy
- [ ] New products view/tab (or a panel under accounts).
- [ ] Link products to pipeline opportunities and/or `capexModelId` (currently null).
- [ ] Manual price entry UI (`price` is null throughout the seed).

## 5. Backend / sync (target: D1 — see DECISION-2)

Current state (verified): `tsi-intel-api` Worker is KV-only — `env.TSI_DATA` (namespace
`tsi-pipeline-data`), JSON blobs under `pipeline`/`bugs`/`usage_log`/`locks/:id`. No D1.

- [ ] Design the D1 schema: `accounts`, `contacts`, `products` (+ `pipeline` when migrated).
      PKs = `seed_id`; FKs per DECISION-3. Include `account_type`, `dynamics_id`, address cols.
- [ ] Provision the `tsi-intel` D1 database + bind it to the Worker.
- [ ] Migration loader: git seed JSON → D1, with DECISION-1 enrichment applied. Idempotent /
      re-runnable (git seed stays the source-of-truth "staging" layer).
- [ ] Rewrite Worker endpoints from KV blob get/put to D1 queries (keep optimistic-concurrency
      + locks behavior).
- [ ] Update client sync: replace whole-blob fetch with query-based reads where it helps.
- [ ] Sequence the pipeline KV→D1 move (do CRM tables first to de-risk, per DECISION-2 note).

## 6. Validation / cleanup

- [ ] De-dupe pass across all three files (name collisions, `dynamics_id` uniqueness).
- [ ] Verify referential integrity: every contact `matched_account_seed_id` and product
      `parent_seed_id` resolves.
- [ ] Keep `seed_manifest.json` `count`s in sync if files are re-exported.

---
_Seed source: Dynamics CRM export, cleaned with John Teal (`seed_manifest.json`)._
