# TSI Intel — feature implementation TODO

Working list for wiring the CRM seed data (`seed_accounts.json`, `seed_contacts.json`,
`seed_products.json`) into the app, and the features that unlocks. Status legend:
`[ ]` not started · `[~]` in progress · `[x]` done · `[?]` needs a decision.

## 0. Decisions to make first (blockers)

- [?] **Account model strategy.** Pick one:
  - (A) Migrate the 72 curated `DEFAULT_ACCOUNTS` onto seed IDs — one unified account list,
    richer CRM fields, but must re-attach `lat`/`lon`/`plantType`/`industry`/weather.
  - (B) Keep app accounts as the *operational* layer (plants/sites, maps, weather) and treat
    seed accounts as a *CRM reference* layer, linked by ID. Two stores, one mapping.
- [?] **Worker backend storage.** The DB schema lives in the Cloudflare Worker (not in this
  repo). Confirm it's D1 (SQL — supports the manifest's `staging_*` tables) vs KV/blob, before
  deciding where staging and promotion happen.
- [?] **ID strategy.** Seed uses `seed_id` (`acct_0001`) + `dynamics_id`; app uses `AG-*`/`S-*`.
  Decide canonical ID and build a seed↔app crosswalk.

## 1. Schema reconciliation

- [ ] Write the seed→app field map for accounts (see gaps table in PR/notes).
  - [ ] `parent_seed_id` → `parentId` via ID crosswalk
  - [ ] `city`/`state`/`country` → `loc` (and keep structured address fields)
  - [ ] Derive `acctMatch` (pipeline links by this string) — name + `formal_name` aliases
  - [ ] Find a home for `account_type`, `dynamics_id`, `formal_name`, `website`, `phone`, address
- [ ] Bump `SCHEMA_VERSION` (currently 2) and add a migration in `loadAccounts()` for the new fields.
- [ ] Decide whether `account_type` becomes a filter/badge in `view-accounts`.

## 2. Accounts import

- [ ] Loader that maps `seed_accounts.json` (374) into the unified `accounts[]` shape.
- [ ] Resolve seed `parent_seed_id` hierarchy → `parentId`.
- [ ] Reconcile against the 72 existing `DEFAULT_ACCOUNTS` (de-dupe by name/`formal_name`).
- [ ] Re-link pipeline rows: confirm every `acct` string still resolves to an account.

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

## 5. Backend / sync

- [ ] If Worker is D1: create `staging_accounts` / `staging_contacts` / `staging_products`
      mirroring live schema; load seed there first, promote as a reviewed step (per manifest).
- [ ] Extend the Worker `/api/*` endpoints + client sync for accounts/contacts/products
      (today only the pipeline syncs).

## 6. Validation / cleanup

- [ ] De-dupe pass across all three files (name collisions, `dynamics_id` uniqueness).
- [ ] Verify referential integrity: every contact `matched_account_seed_id` and product
      `parent_seed_id` resolves.
- [ ] Keep `seed_manifest.json` `count`s in sync if files are re-exported.

---
_Seed source: Dynamics CRM export, cleaned with John Teal (`seed_manifest.json`)._
