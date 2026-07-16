-- migrations/001_staging.sql
-- Additive, reversible. Creates the three staging landing tables that mirror the
-- flat seed JSON exactly, so validation happens on the raw import BEFORE any
-- transform into the live tables. Touches nothing live.
--
-- Apply:    wrangler d1 execute tsi-intel --local  --file=migrations/001_staging.sql   (dry run)
--           wrangler d1 execute tsi-intel --remote --file=migrations/001_staging.sql
-- Rollback: DROP TABLE staging_accounts; DROP TABLE staging_contacts;
--           DROP TABLE staging_products; DROP TABLE staging_enrichment;
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

-- staging_enrichment mirrors enrichment_crosswalk.json (DECISION-1). One row per
-- account that carries app-only data onto the seed: the load-bearing acct_match
-- alias (resolves pipeline acct strings), plus geo/industry where the app had it.
-- geo_source is precomputed 'plant' for rows with a coordinate so the Worker's
-- address-geocoder never overwrites a precise app coordinate (DECISION-10).
-- seed_id points at a staging_accounts row (an existing seed org for 'enrich'
-- entries, or one of the 15 net-new 'add' orgs, which are loaded into
-- staging_accounts too). Promotion LEFT JOINs this onto organizations.
CREATE TABLE IF NOT EXISTS staging_enrichment (
  seed_id     TEXT PRIMARY KEY,
  app_id      TEXT,        -- source app id (e.g. AG-LP) — traceability only
  acct_match  TEXT,        -- load-bearing pipeline alias
  industry    TEXT,
  lat         REAL,
  lon         REAL,
  plant_type  TEXT,
  geo_source  TEXT,        -- 'plant' when lat present, else NULL
  load_batch  TEXT,
  loaded_at   TEXT DEFAULT (datetime('now'))
);
