-- migrations/001_staging.sql
-- Additive, reversible. Creates the three staging landing tables that mirror the
-- flat seed JSON exactly, so validation happens on the raw import BEFORE any
-- transform into the live tables. Touches nothing live.
--
-- Apply:    wrangler d1 execute tsi-intel --local  --file=migrations/001_staging.sql   (dry run)
--           wrangler d1 execute tsi-intel --remote --file=migrations/001_staging.sql
-- Rollback: DROP TABLE staging_accounts; DROP TABLE staging_contacts; DROP TABLE staging_products;
--           (staging is disposable and references nothing live)

CREATE TABLE IF NOT EXISTS staging_accounts (
  seed_id             TEXT PRIMARY KEY,
  dynamics_id         TEXT,
  name                TEXT,
  phone               TEXT,
  website             TEXT,
  city                TEXT,
  state               TEXT,
  country             TEXT,
  postal_code         TEXT,
  street1             TEXT,
  street2             TEXT,
  description         TEXT,
  owner               TEXT,
  status              TEXT,
  created_on          TEXT,
  modified_on         TEXT,
  account_type        TEXT,
  parent_account_name TEXT,
  parent_seed_id      TEXT,
  formal_name         TEXT,
  notes               TEXT,
  load_batch          TEXT,
  loaded_at           TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS staging_contacts (
  seed_id                 TEXT PRIMARY KEY,
  dynamics_id             TEXT,
  full_name               TEXT,
  first_name              TEXT,
  last_name               TEXT,
  email                   TEXT,
  company_name_raw        TEXT,
  business_phone          TEXT,
  mobile_phone            TEXT,
  job_title               TEXT,
  owner                   TEXT,
  status                  TEXT,
  created_on              TEXT,
  modified_on             TEXT,
  matched_account         TEXT,
  matched_account_seed_id TEXT,
  match_type              TEXT,
  load_batch              TEXT,
  loaded_at               TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS staging_products (
  seed_id        TEXT PRIMARY KEY,
  pn             TEXT,
  name           TEXT,
  structure      TEXT,
  status         TEXT,
  category       TEXT,
  price          REAL,
  parent_seed_id TEXT,
  load_batch     TEXT,
  loaded_at      TEXT DEFAULT (datetime('now'))
);
