-- 005_collections.sql
-- ---------------------------------------------------------------------------
-- Generic, extensible key/value collection store. One row per object, keyed on
-- (collection, id), with the object as a JSON blob. Lets features persist to D1
-- without a bespoke table each — the app's `Store(collection)` client and the
-- worker's /api/store/:collection endpoints ride on this.
--
-- First user: the bug register (collection = 'bugs'), moving it off localStorage
-- as the store of record. Future users: saved views, follows, user prefs, etc.
-- Structured objects that deserve their own tables (quotes, product_prices) keep
-- them — this is for the long tail of simpler collections.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS collections (
  collection  TEXT NOT NULL,          -- e.g. 'bugs', 'saved_views', 'follows'
  id          TEXT NOT NULL,          -- object id, unique within the collection
  data        TEXT NOT NULL,          -- JSON-encoded object (includes its own id)
  updated_at  TEXT,
  updated_by  TEXT,
  PRIMARY KEY (collection, id)
);
CREATE INDEX IF NOT EXISTS idx_collections_coll ON collections(collection);
