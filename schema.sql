-- TSI Intel — D1 schema (DRAFT for review)
-- ---------------------------------------------------------------------------
-- Modeled on the Pipedrive object model so a future push to Pipedrive is a
-- field-mapping job, not a re-architecture (constraint from DECISION-2 review).
--
--   TSI entity        Pipedrive object     this schema
--   account        -> Organization      -> organizations
--   contact        -> Person            -> persons
--   product        -> Product           -> products
--   pipeline opp   -> Deal              -> deals          (phase 2)
--   owner          -> User              -> users
--
-- ID strategy (DECISION-3): seed_id is the canonical PK. dynamics_id and
-- pipedrive_id are external-reference columns — dynamics_id is known now,
-- pipedrive_id is backfilled when/if we push. Pipedrive's own ids are
-- integers; we never adopt them as PKs, just record them.
--
-- TSI-specific columns (lat/lon, plant_type, industry, acct_match, pn,
-- category, structure) have no native Pipedrive home — on export they map to
-- Pipedrive *custom fields*. Kept as real columns here for query/filtering.
--
-- SQLite/D1: booleans are INTEGER 0/1; timestamps are ISO-8601 TEXT (matches
-- the seed's "2023-06-07 09:17:03" style, normalized to UTC on load).

PRAGMA foreign_keys = ON;

-- ── users (Pipedrive: User) ────────────────────────────────────────────────
-- Seed carries owner as a name string ("John Teal"); we normalize to a users
-- row and FK to it. owner_id on every entity = Pipedrive owner_id.
CREATE TABLE users (
  id         INTEGER PRIMARY KEY,        -- local surrogate
  name       TEXT NOT NULL,
  email      TEXT,
  pipedrive_id INTEGER                   -- backfilled on push
);

-- ── organizations (Pipedrive: Organization) = TSI accounts ─────────────────
CREATE TABLE organizations (
  seed_id        TEXT PRIMARY KEY,       -- acct_0001  (canonical)
  dynamics_id    TEXT,                   -- CRM source id
  pipedrive_id   INTEGER,                -- backfilled on push

  name           TEXT NOT NULL,          -- Pipedrive: name
  formal_name    TEXT,                   -- legal name; alias for matching
  owner_id       INTEGER REFERENCES users(id),

  -- Pipedrive label (single). DECISION-1 surfaced these values from the seed.
  account_type   TEXT CHECK (account_type IN
                  ('customer','vendor','competitor','government',
                   'contact_only','unclassified')),

  -- org hierarchy: Pipedrive models parent/child via OrganizationRelationships;
  -- we use a self-FK (single parent in the seed) and emit a relationship on export.
  parent_seed_id TEXT REFERENCES organizations(seed_id),

  -- Pipedrive address sub-fields (org address is split into components)
  address_street     TEXT,   -- street1 (+ street2 appended)
  address_locality   TEXT,   -- city
  address_admin_area TEXT,   -- state / region
  address_postal_code TEXT,
  address_country    TEXT,

  -- org has no native phone/website in Pipedrive -> custom fields on export
  phone          TEXT,
  website        TEXT,

  -- TSI custom fields (Pipedrive custom fields on export)
  industry       TEXT,
  plant_type     TEXT,
  lat            REAL,
  lon            REAL,
  acct_match     TEXT,        -- load-bearing: resolves pipeline acct strings (DECISION-1)

  notes          TEXT,
  active_flag    INTEGER NOT NULL DEFAULT 1,   -- from status = Active
  add_time       TEXT,        -- created_on
  update_time    TEXT         -- modified_on
);
CREATE INDEX idx_org_parent     ON organizations(parent_seed_id);
CREATE INDEX idx_org_type       ON organizations(account_type);
CREATE INDEX idx_org_acct_match ON organizations(acct_match);
CREATE UNIQUE INDEX idx_org_dynamics ON organizations(dynamics_id) WHERE dynamics_id IS NOT NULL;

-- ── persons (Pipedrive: Person) = TSI contacts ─────────────────────────────
CREATE TABLE persons (
  seed_id        TEXT PRIMARY KEY,       -- cont_0001
  dynamics_id    TEXT,
  pipedrive_id   INTEGER,

  name           TEXT NOT NULL,          -- full_name
  first_name     TEXT,
  last_name      TEXT,
  job_title      TEXT,                   -- Pipedrive: job_title
  owner_id       INTEGER REFERENCES users(id),

  -- DECISION-4: a person can belong to MANY orgs. Membership lives entirely in
  -- person_organizations (below); the row flagged is_primary is the "primary org"
  -- that ports to Pipedrive's single org_id and back-maintains the many relation.
  -- No denormalized org column here -> single source of truth.
  match_type     TEXT,                   -- how the seed matched (exact/alias/domain)
  company_name_raw TEXT,                 -- unresolved company string from CRM

  active_flag    INTEGER NOT NULL DEFAULT 1,
  add_time       TEXT,
  update_time    TEXT
);
CREATE UNIQUE INDEX idx_person_dynamics ON persons(dynamics_id) WHERE dynamics_id IS NOT NULL;

-- Pipedrive stores email/phone as arrays of {label, value, primary}. Child
-- tables mirror that exactly (vs flattening to one column) -> DECISION-5.
CREATE TABLE person_emails (
  person_seed_id TEXT NOT NULL REFERENCES persons(seed_id),
  label          TEXT,                   -- work / home / other
  value          TEXT NOT NULL,
  is_primary     INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE person_phones (
  person_seed_id TEXT NOT NULL REFERENCES persons(seed_id),
  label          TEXT,                   -- work (business_phone) / mobile
  value          TEXT NOT NULL,
  is_primary     INTEGER NOT NULL DEFAULT 0
);

-- Many-to-many person<->org (DECISION-4) — source of truth for membership.
-- Exactly one row per person should carry is_primary=1; that is the org we
-- send to Pipedrive's single org_id (app/loader enforces the single-primary rule).
CREATE TABLE person_organizations (
  person_seed_id TEXT NOT NULL REFERENCES persons(seed_id),
  org_seed_id    TEXT NOT NULL REFERENCES organizations(seed_id),
  is_primary     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (person_seed_id, org_seed_id)
);
CREATE INDEX idx_po_org ON person_organizations(org_seed_id);  -- reverse: org's contacts

-- ── products (Pipedrive: Product) ──────────────────────────────────────────
CREATE TABLE products (
  seed_id        TEXT PRIMARY KEY,       -- prod_0001
  pipedrive_id   INTEGER,

  name           TEXT NOT NULL,
  code           TEXT,                   -- Pipedrive: code  (= pn)
  category       TEXT,                   -- 21 categories
  structure      TEXT,                   -- 'Product' | 'Product Family'
  parent_seed_id TEXT REFERENCES products(seed_id),  -- family hierarchy
  active_flag    INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_product_parent   ON products(parent_seed_id);
CREATE INDEX idx_product_category ON products(category);

-- Pipedrive prices = array per currency. Seed price is null throughout (manual
-- entry later) -> child table future-proofs multi-currency (DECISION-5).
CREATE TABLE product_prices (
  product_seed_id TEXT NOT NULL REFERENCES products(seed_id),
  currency        TEXT NOT NULL DEFAULT 'USD',
  price           REAL,
  cost            REAL,
  PRIMARY KEY (product_seed_id, currency)
);

-- Deals/pipelines are intentionally OUT OF SCOPE (DECISION-6): this schema is
-- for tracking & capturing CRM info only. The existing pipeline stays in KV.
-- organizations.acct_match remains so the app can still resolve a KV pipeline
-- row to its D1 organization. If deals ever move to D1, add them modeled on
-- Pipedrive's Deal object (org_seed_id FK via acct_match).
