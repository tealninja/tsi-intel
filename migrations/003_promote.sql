-- migrations/003_promote.sql
-- Promote validated staging rows into the live tables. Run ONLY after
-- scripts/validate_staging.sql passes (counts 374/371/131, 0 orphans, clean types).
-- Every promoted row is tagged source_batch='dynamics_2026_06_30' so the whole
-- batch is exactly reversible via scripts/rollback_promotion.sql.
--
-- Self-referential parent FKs (parent_seed_id -> same table) are deferred: parents
-- and children are inserted first with parent_seed_id NULL, then linked in a second
-- UPDATE pass. This avoids insert-ordering FK failures regardless of row order.
--
-- Apply:    wrangler d1 execute tsi-intel --local  --file=migrations/003_promote.sql   (dry run)
--           wrangler d1 execute tsi-intel --remote --file=migrations/003_promote.sql
-- Rollback: scripts/rollback_promotion.sql  (children first, then parents; exact by source_batch)

-- 0. Owner row. On remote this already exists (users.id=1 = John Teal); INSERT OR
--    IGNORE makes it a no-op there and satisfies the owner_id FK on a fresh local db.
INSERT OR IGNORE INTO users (id, name, email) VALUES (1, 'John Teal', 'teal.john@gmail.com');

-- 2C.1 organizations (parent links deferred) ---------------------------------
INSERT INTO organizations
  (seed_id, dynamics_id, name, formal_name, account_type,
   address_street, address_locality, address_admin_area,
   address_postal_code, address_country, phone, website, about,
   active_flag, add_time, update_time, owner_id, source_batch, version)
SELECT
  seed_id, dynamics_id, name, formal_name, account_type,
  TRIM(COALESCE(street1,'') ||
       CASE WHEN COALESCE(street2,'')<>'' THEN ', '||street2 ELSE '' END),
  city, state, postal_code, country, phone, website,
  COALESCE(description, notes),
  CASE WHEN status='Active' THEN 1 ELSE 0 END,
  created_on, modified_on,
  1,                       -- owner_id = John Teal (users.id = 1)
  'dynamics_2026_06_30', 1
FROM staging_accounts;

UPDATE organizations
SET parent_seed_id = (SELECT s.parent_seed_id
                      FROM staging_accounts s WHERE s.seed_id = organizations.seed_id)
WHERE source_batch='dynamics_2026_06_30'
  AND EXISTS (SELECT 1 FROM staging_accounts s
              WHERE s.seed_id=organizations.seed_id AND s.parent_seed_id IS NOT NULL);

-- 2C.2 persons ---------------------------------------------------------------
INSERT INTO persons
  (seed_id, dynamics_id, name, first_name, last_name, job_title,
   match_type, company_name_raw, active_flag, add_time, update_time,
   owner_id, source_batch, version)
SELECT
  seed_id, dynamics_id, full_name, first_name, last_name, job_title,
  match_type, company_name_raw,
  CASE WHEN status='Active' THEN 1 ELSE 0 END,
  created_on, modified_on, 1, 'dynamics_2026_06_30', 1
FROM staging_contacts;

-- 2C.3 emails / phones / org links (child tables) ----------------------------
INSERT INTO person_emails (person_seed_id, label, value, is_primary)
SELECT seed_id, 'work', email, 1
FROM staging_contacts WHERE COALESCE(email,'')<>'';

INSERT INTO person_phones (person_seed_id, label, value, is_primary)
SELECT seed_id, 'business', business_phone, 1
FROM staging_contacts WHERE COALESCE(business_phone,'')<>''
UNION ALL
SELECT seed_id, 'mobile', mobile_phone, 0
FROM staging_contacts WHERE COALESCE(mobile_phone,'')<>'';

INSERT INTO person_organizations (person_seed_id, org_seed_id, is_primary)
SELECT seed_id, matched_account_seed_id, 1
FROM staging_contacts
WHERE matched_account_seed_id IS NOT NULL
  AND matched_account_seed_id IN (SELECT seed_id FROM organizations);

-- 2C.4 products (parent links deferred, same pattern as orgs) -----------------
INSERT INTO products
  (seed_id, name, code, category, structure, active_flag, source_batch, version)
SELECT
  seed_id, name, pn, category, structure,
  CASE WHEN status='Active' THEN 1 ELSE 0 END,
  'dynamics_2026_06_30', 1
FROM staging_products;

UPDATE products
SET parent_seed_id = (SELECT s.parent_seed_id
                      FROM staging_products s WHERE s.seed_id = products.seed_id)
WHERE source_batch='dynamics_2026_06_30'
  AND EXISTS (SELECT 1 FROM staging_products s
              WHERE s.seed_id=products.seed_id AND s.parent_seed_id IS NOT NULL);

-- 2C.5 product_prices — intentionally SKIPPED (all 131 seed prices are NULL).
--       The null-price gap is kept explicit rather than hidden behind zero rows.
--       Add product_prices rows later, once prices are entered manually.
