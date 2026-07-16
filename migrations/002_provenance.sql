-- migrations/002_provenance.sql
-- Additive, reversible. Adds a nullable `source_batch` provenance column to each
-- live table that receives promoted rows. ADD COLUMN is non-destructive: existing
-- rows get NULL, existing queries are unaffected. This column is what makes the
-- promotion exactly rollback-able (delete WHERE source_batch = '<batch>').
--
-- Apply:    wrangler d1 execute tsi-intel --local  --file=migrations/002_provenance.sql   (dry run)
--           wrangler d1 execute tsi-intel --remote --file=migrations/002_provenance.sql
-- Rollback: leave them in place (harmless NULLs for all prior rows). SQLite/D1
--           cannot DROP COLUMN cleanly on a table with dependent indexes without a
--           table rebuild, so removal is intentionally NOT part of rollback.
--
-- NOTE: ADD COLUMN is not idempotent in SQLite (re-running errors "duplicate
-- column name"). Run this exactly once per environment. On a re-run that error is
-- benign and means the column already exists.

ALTER TABLE organizations ADD COLUMN source_batch TEXT;
ALTER TABLE persons        ADD COLUMN source_batch TEXT;
ALTER TABLE products       ADD COLUMN source_batch TEXT;
