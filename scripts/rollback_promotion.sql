-- scripts/rollback_promotion.sql
-- Exact, complete reversal of migrations/003_promote.sql. Deletes ONLY rows tagged
-- with this batch; anything else in the tables is untouched. Children first so no
-- FK dependency is orphaned mid-delete.
--   wrangler d1 execute tsi-intel --local  --file=scripts/rollback_promotion.sql
--   wrangler d1 execute tsi-intel --remote --file=scripts/rollback_promotion.sql

DELETE FROM person_organizations WHERE person_seed_id IN
  (SELECT seed_id FROM persons WHERE source_batch='dynamics_2026_06_30');
DELETE FROM person_emails WHERE person_seed_id IN
  (SELECT seed_id FROM persons WHERE source_batch='dynamics_2026_06_30');
DELETE FROM person_phones WHERE person_seed_id IN
  (SELECT seed_id FROM persons WHERE source_batch='dynamics_2026_06_30');
DELETE FROM persons       WHERE source_batch='dynamics_2026_06_30';
DELETE FROM products      WHERE source_batch='dynamics_2026_06_30';
DELETE FROM organizations WHERE source_batch='dynamics_2026_06_30';

-- (product_prices had no rows inserted for this batch, so nothing to delete there.)
