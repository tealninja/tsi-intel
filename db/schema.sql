-- TSI Intel — staging schema for CRM seed load
-- Generated from seed_*.json (source: Dynamics CRM export, cleaned with John Teal).
-- Load target per seed_manifest.json: staging tables, promoted to live as a reviewed step.
-- Idempotent: safe to re-run. Uses IF NOT EXISTS + INSERT OR REPLACE keyed on seed_id.

CREATE TABLE IF NOT EXISTS staging_accounts (
  seed_id TEXT PRIMARY KEY,
  dynamics_id TEXT,
  name TEXT,
  formal_name TEXT,
  account_type TEXT,
  status TEXT,
  owner TEXT,
  phone TEXT,
  website TEXT,
  street1 TEXT,
  street2 TEXT,
  city TEXT,
  state TEXT,
  postal_code TEXT,
  country TEXT,
  description TEXT,
  notes TEXT,
  parent_account_name TEXT,
  parent_seed_id TEXT,
  created_on TEXT,
  modified_on TEXT
);
CREATE TABLE IF NOT EXISTS staging_contacts (
  seed_id TEXT PRIMARY KEY,
  dynamics_id TEXT,
  full_name TEXT,
  first_name TEXT,
  last_name TEXT,
  email TEXT,
  job_title TEXT,
  company_name_raw TEXT,
  business_phone TEXT,
  mobile_phone TEXT,
  status TEXT,
  owner TEXT,
  matched_account TEXT,
  matched_account_seed_id TEXT,
  match_type TEXT,
  created_on TEXT,
  modified_on TEXT
);
CREATE TABLE IF NOT EXISTS staging_products (
  seed_id TEXT PRIMARY KEY,
  pn TEXT,
  name TEXT,
  category TEXT,
  structure TEXT,
  status TEXT,
  price REAL,
  parent_pn TEXT,
  parent_seed_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_stg_acct_parent ON staging_accounts(parent_seed_id);
CREATE INDEX IF NOT EXISTS idx_stg_acct_type   ON staging_accounts(account_type);
CREATE INDEX IF NOT EXISTS idx_stg_cont_acct   ON staging_contacts(matched_account_seed_id);
CREATE INDEX IF NOT EXISTS idx_stg_cont_email  ON staging_contacts(email);
CREATE INDEX IF NOT EXISTS idx_stg_prod_cat    ON staging_products(category);
CREATE INDEX IF NOT EXISTS idx_stg_prod_parent ON staging_products(parent_seed_id);
