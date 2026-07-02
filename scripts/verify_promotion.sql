-- scripts/verify_promotion.sql
-- Run immediately after migrations/003_promote.sql. Confirms the batch landed and
-- referential integrity is clean.
--   wrangler d1 execute tsi-intel --local  --file=scripts/verify_promotion.sql
--   wrangler d1 execute tsi-intel --remote --file=scripts/verify_promotion.sql

-- Promoted row counts by batch — expect 374 / 371 / 131
SELECT 'organizations' AS tbl, COUNT(*) AS n, 374 AS expect FROM organizations WHERE source_batch='dynamics_2026_06_30'
UNION ALL SELECT 'persons', COUNT(*), 371 FROM persons WHERE source_batch='dynamics_2026_06_30'
UNION ALL SELECT 'products', COUNT(*), 131 FROM products WHERE source_batch='dynamics_2026_06_30';

-- Child tables produced by promotion — expect 357 / 322 / 354
SELECT 'person_emails' AS tbl, COUNT(*) AS n, 357 AS expect FROM person_emails
UNION ALL SELECT 'person_phones', COUNT(*), 322 FROM person_phones
UNION ALL SELECT 'person_organizations', COUNT(*), 354 FROM person_organizations;

-- Parent links applied in the second pass — expect 88 orgs / 19 products
SELECT 'orgs_with_parent' AS tbl, COUNT(*) AS n, 88 AS expect
FROM organizations WHERE source_batch='dynamics_2026_06_30' AND parent_seed_id IS NOT NULL;
SELECT 'products_with_parent' AS tbl, COUNT(*) AS n, 19 AS expect
FROM products WHERE source_batch='dynamics_2026_06_30' AND parent_seed_id IS NOT NULL;

-- product_prices intentionally empty for this batch — expect 0
SELECT 'product_prices' AS tbl, COUNT(*) AS n, 0 AS expect FROM product_prices;

-- Referential integrity across the whole database — expect ZERO rows returned.
PRAGMA foreign_key_check;
