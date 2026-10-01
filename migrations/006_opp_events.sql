-- 006: opportunity audit trail (applied live 2026-10-01 via the Cloudflare connector)
-- Append-only field changes. Written by the API worker on every opportunities
-- write (diff vs stored row) and by the app's /api/events/backfill push.
CREATE TABLE IF NOT EXISTS opp_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  opp_id TEXT NOT NULL,
  at TEXT NOT NULL,            -- ISO timestamp of the change
  by TEXT,                     -- initials / user
  field TEXT NOT NULL,         -- val | prob | close | stage | lead | status | acctId | created | review | note
  from_v TEXT, to_v TEXT,      -- stringified before/after (NULL = unknown / n.a.)
  source TEXT,                 -- app | api | mcp | prose | record | backfill
  note TEXT,                   -- original free-text action when parsed from prose
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_opp_events_opp ON opp_events(opp_id, at);
CREATE INDEX IF NOT EXISTS idx_opp_events_at ON opp_events(at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_opp_events ON opp_events(opp_id, at, field, COALESCE(to_v,''), COALESCE(from_v,''));

-- Daily state of every opportunity (worker cron 06:00 UTC, or POST /api/snapshots/run).
CREATE TABLE IF NOT EXISTS pipeline_snapshots (
  snap_date TEXT NOT NULL, opp_id TEXT NOT NULL,
  status TEXT, val REAL, prob REAL, close TEXT, expected_close TEXT, stage TEXT, lead TEXT, acct TEXT, cat TEXT,
  PRIMARY KEY (snap_date, opp_id)
);
