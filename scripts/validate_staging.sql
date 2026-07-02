-- scripts/validate_staging.sql
-- Run after loading scripts/load_staging.sql, BEFORE promotion. Eyeball every
-- result against the expected value in the comment. Any mismatch = stop.
--   wrangler d1 execute tsi-intel --local  --file=scripts/validate_staging.sql
--   wrangler d1 execute tsi-intel --remote --file=scripts/validate_staging.sql

-- Row counts must equal the source files: 374 / 371 / 131
SELECT 'accounts' AS check_name, COUNT(*) AS n, 374 AS expect FROM staging_accounts
UNION ALL SELECT 'contacts', COUNT(*), 371 FROM staging_contacts
UNION ALL SELECT 'products', COUNT(*), 131 FROM staging_products;

-- KNOWN GAP: all 131 products have NULL price
SELECT 'products_null_price' AS check_name, COUNT(*) AS n, 131 AS expect
FROM staging_products WHERE price IS NULL;

-- Orphan parent references (parent_seed_id pointing nowhere) — expect 0 / 0
SELECT 'orphan_account_parents' AS check_name, COUNT(*) AS n, 0 AS expect
FROM staging_accounts a
WHERE a.parent_seed_id IS NOT NULL
  AND a.parent_seed_id NOT IN (SELECT seed_id FROM staging_accounts);
SELECT 'orphan_product_parents' AS check_name, COUNT(*) AS n, 0 AS expect
FROM staging_products p
WHERE p.parent_seed_id IS NOT NULL
  AND p.parent_seed_id NOT IN (SELECT seed_id FROM staging_products);

-- Standalone contacts with no account link — expect 17 (per seed_manifest)
SELECT 'contacts_no_account' AS check_name, COUNT(*) AS n, 17 AS expect
FROM staging_contacts WHERE matched_account_seed_id IS NULL;

-- Contacts pointing at an account seed_id not present in staging_accounts — expect 0
SELECT 'contacts_bad_account_ref' AS check_name, COUNT(*) AS n, 0 AS expect
FROM staging_contacts c
WHERE c.matched_account_seed_id IS NOT NULL
  AND c.matched_account_seed_id NOT IN (SELECT seed_id FROM staging_accounts);

-- account_type values outside the live CHECK constraint domain — expect 0 rows
SELECT 'bad_account_type' AS check_name, COUNT(*) AS n, 0 AS expect
FROM staging_accounts
WHERE account_type IS NOT NULL
  AND account_type NOT IN
    ('customer','vendor','competitor','government','contact_only','unclassified');

-- Confirm the load_batch tag is uniform — expect one row: dynamics_2026_06_30 across all three
SELECT 'load_batch_accounts' AS check_name, load_batch, COUNT(*) FROM staging_accounts GROUP BY load_batch
UNION ALL SELECT 'load_batch_contacts', load_batch, COUNT(*) FROM staging_contacts GROUP BY load_batch
UNION ALL SELECT 'load_batch_products', load_batch, COUNT(*) FROM staging_products GROUP BY load_batch;
