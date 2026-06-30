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

### Schema design decisions (drafted in `schema.sql`, Pipedrive-modeled)

- [x] **DECISION-4 — person↔org cardinality:** many-to-many. Membership lives in
  `person_organizations`; `is_primary` marks the org that ports to Pipedrive's single `org_id`.
- [x] **DECISION-5 — multi-value fields:** child tables (`person_emails`, `person_phones`,
  `product_prices`), mirroring Pipedrive's labeled-array model. No flattening.
- [x] **DECISION-6 — scope:** CRM capture only (organizations/persons/products). No deals/pipeline;
  the pipeline stays in KV. `organizations.acct_match` retained so the app still resolves it.
- [x] **DECISION-7 — notes:** Pipedrive-style `notes` table (many timestamped, attributed notes
  per org/person) for the evolving log, plus a flat `organizations.about` for the static blurb.
- [x] **DECISION-8 — edit tracking:** `version` + `updated_by` on organizations/persons/products,
  mirroring the pipeline's optimistic-concurrency pattern.
- [x] **DECISION-9 — review state:** none added; `account_type = 'unclassified'` (122 rows) is the
  review backlog. Add a real `review_status` only if a formal sign-off workflow appears.
- [x] **DECISION-10 — geocoding: at import, in the Worker.** Live geocoders are policy-blocked from
  the build session; offline city-centroid covered only 58% coarsely. So the Worker geocodes org
  addresses at D1 import via an external API (key required). Schema support added: `organizations.
  geo_source` (`plant`|`geocoded`) so the 42 precise app coords are never overwritten, and a
  `geocode_cache` table (keyed by normalized address) so each address is geocoded once.
  Loader tags the 42 carried coords as `geo_source='plant'`. Coverage at load: 42 plant-precise,
  **301 to geocode**, 46 with no address.

## 1. Schema reconciliation

- [ ] Write the seed→app field map for accounts (see gaps table in PR/notes).
  - [ ] `parent_seed_id` → `parentId` via ID crosswalk
  - [ ] `city`/`state`/`country` → `loc` (and keep structured address fields)
  - [ ] Derive `acctMatch` (pipeline links by this string) — name + `formal_name` aliases
  - [ ] Find a home for `account_type`, `dynamics_id`, `formal_name`, `website`, `phone`, address
- [ ] Bump `SCHEMA_VERSION` (currently 2) and add a migration in `loadAccounts()` for the new fields.
- [ ] Decide whether `account_type` becomes a filter/badge in `view-accounts`.

## 2. Accounts import (seed = canonical) — LOADER SPEC

**Data profiling (verified against the committed seed):**
- Seed referential integrity is **perfect**: 0 unresolved account parents, 0 unresolved
  contact→account links (354 linked / 17 standalone), 0 unresolved product parents, 0 duplicate
  `dynamics_id`. Loader needs no orphan-repair.
- Owner is a single user ("John Teal", all 745 records) → seed one `users` row.
- Phones: 62 contacts have **both** business+mobile, 48 business-only, 150 mobile-only, 111 none
  → `person_phones` child table justified (label `work`/`mobile`). One email max per contact.
- Products: 121 Product + 10 Family, 21 categories, 0 prices (manual later).

**app↔seed crosswalk** (RECONCILED → `enrichment_crosswalk.json`, 0 unresolved / 0 bad links):
- **57 of 72** app accounts → action `enrich` an existing seed row (incl. matcher-miss fixes:
  `S-GPEN`→acct_0139 `GP - Engelhart` spelling; `S-TAF`/`AG-TAF`→acct_0315 Tafisa site).
- **15** → action `add` net-new seed-origin rows, IDs `acct_0375`–`acct_0389` (no `dynamics_id`),
  **8 carry the must-not-lose geo**. Hierarchy wired, e.g. new PNRE corp acct_0375 ← PNRE-Hoquiam
  acct_0386. Children placed under existing parents where present (LP→acct_0207, Weyerhaeuser→
  acct_0362, WEGR=West-Fraser-Grand-Prairie→acct_0350).
- Manual calls resolved (John Teal): WEGR = West Fraser – Grand Prairie (new WF child);
  "West Fraser / Javelin" = separate JV (new co); Nature's Flame = new co (not Leaf-NZ);
  Van Lung / BFV = new entries.

**Loader algorithm:**
- [ ] Load `users` (one row: John Teal).
- [ ] Load all 374 `seed_accounts.json` → `organizations` (PK `seed_id`; map address sub-fields,
      `account_type`, `dynamics_id`; `status`→`active_flag`; `created/modified_on`→`add/update_time`).
- [ ] Resolve `parent_seed_id` self-FK (data already clean).
- [ ] Apply crosswalk: for `enrich` rows, set `acct_match` + `lat`/`lon`/`plant_type`/`industry`
      on the matched org; for `add_seed_origin` rows, INSERT a new org (no `dynamics_id`) parented
      to its corporate row (add the absent parent company too where needed).
- [ ] Load `seed_contacts.json` → `persons` + `person_organizations` (primary row from
      `matched_account_seed_id`) + `person_phones`/`person_emails`.
- [ ] Load `seed_products.json` → `products` (+ empty `product_prices` rows skipped until priced).
- [x] Verify: 36/38 pipeline `acct` strings resolve via `organizations.acct_match`/name.
- [x] Loader is idempotent / re-runnable (git seed stays source-of-truth staging).

**Loader status: BUILT & PASSING — `load_seed.py` → `tsi-intel.db` (gitignored).**
Output: 389 organizations (374 seed + 15 new, 57 enriched, 42 with geo), 371 persons,
357 emails, 322 phones, 354 org links (17 standalone), 131 products; **0 FK violations**;
account/contact joins verified. Re-run: `python3 load_seed.py`.

- [ ] **Residual — 2 pipeline codes unresolved: `ARSA` (Arauco site), `HUCR` (Huber Crossett).**
  They're 4-letter internal codes that don't prefix-match any single `acct_match`. A single
  alias column can't hold them → consider a small `org_aliases` table (many aliases per org)
  if more such codes surface. Low priority; doesn't block the load.

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
- [ ] **Geocoding step (DECISION-10), runs in the Worker at import:**
  - [ ] Normalize country first (`USA`/`United States`, `UK`/`United Kingdom`) before building the
        query — counts showed inconsistent values.
  - [ ] For each org with `lat IS NULL` and an address (301 rows): build normalized
        `address_key`, look up `geocode_cache`; on miss call the geocoding API (Google/Mapbox key
        in Worker secret), store result in `geocode_cache`, then set `lat`/`lon` +
        `geo_source='geocoded'`. Never touch `geo_source='plant'` rows.
  - [ ] Respect provider rate limits; cache makes re-imports free.

## 6. Validation / cleanup

- [ ] De-dupe pass across all three files (name collisions, `dynamics_id` uniqueness).
- [ ] Verify referential integrity: every contact `matched_account_seed_id` and product
      `parent_seed_id` resolves.
- [ ] Keep `seed_manifest.json` `count`s in sync if files are re-exported.

---
_Seed source: Dynamics CRM export, cleaned with John Teal (`seed_manifest.json`)._
