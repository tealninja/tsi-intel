-- 004_quotes_and_prices.sql
-- ---------------------------------------------------------------------------
-- Adds the quote objects (Pipedrive: Deal + Deal products) and seeds
-- product_prices from the "TE3T Sample Price List R2y" (Biocarbon torrefied
-- material, packaging, and lab services). Additive to 001–003; safe to re-run
-- (IF NOT EXISTS / INSERT OR REPLACE).
--
--   quotes      -> one customer quotation (header)          -> Pipedrive Deal
--   quote_lines -> line items on a quote                    -> Pipedrive Deal products
--
-- Prices are keyed on products.seed_id (stable across the SKU re-scheme). The
-- 3rd-party lab rows carry both cost (AH Knight rate) and price (customer);
-- internal lab and material rows carry price only.
-- ---------------------------------------------------------------------------

PRAGMA foreign_keys = ON;

-- ── quotes (Pipedrive: Deal) ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS quotes (
  id                   TEXT PRIMARY KEY,          -- QUO-00001-A1B2C3
  rev                  TEXT NOT NULL DEFAULT 'R0',
  seq                  INTEGER,                   -- numeric part, for next-number allocation

  customer_org_seed_id TEXT REFERENCES organizations(seed_id),  -- resolved account (nullable)
  customer_name        TEXT NOT NULL,             -- denormalized / free-text customer
  customer_address     TEXT,
  contact_name         TEXT,
  contact_email        TEXT,
  contact_phone        TEXT,

  project              TEXT,
  status               TEXT NOT NULL DEFAULT 'Draft'
                         CHECK (status IN ('Draft','Sent','Accepted','Declined','Expired')),
  currency             TEXT NOT NULL DEFAULT 'USD',
  quote_date           TEXT,
  valid_until          TEXT,
  prepared_by          TEXT,

  scope                TEXT,                       -- Scope of Supply
  assumptions          TEXT,                       -- Assumptions & Clarifications
  payment_terms        TEXT,
  delivery_terms       TEXT,
  notes                TEXT,

  discount             REAL NOT NULL DEFAULT 0,
  discount_mode        TEXT NOT NULL DEFAULT 'pct' CHECK (discount_mode IN ('pct','abs')),
  freight              REAL NOT NULL DEFAULT 0,
  tax_pct              REAL NOT NULL DEFAULT 0,
  subtotal             REAL NOT NULL DEFAULT 0,     -- cached rollup
  total                REAL NOT NULL DEFAULT 0,     -- cached rollup

  version              INTEGER NOT NULL DEFAULT 1,  -- optimistic concurrency (DECISION-8)
  created_at           TEXT,
  created_by           TEXT,
  updated_at           TEXT,
  updated_by           TEXT
);
CREATE INDEX IF NOT EXISTS idx_quotes_status ON quotes(status);
CREATE INDEX IF NOT EXISTS idx_quotes_org    ON quotes(customer_org_seed_id);

-- ── quote_lines (Pipedrive: Deal products) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS quote_lines (
  id              TEXT PRIMARY KEY,
  quote_id        TEXT NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  line_no         INTEGER NOT NULL,
  product_seed_id TEXT REFERENCES products(seed_id),   -- NULL = custom line
  code            TEXT,                                 -- SKU snapshot at quote time
  description     TEXT,
  qty             REAL NOT NULL DEFAULT 1,
  unit            TEXT,
  unit_price      REAL NOT NULL DEFAULT 0,
  line_total      REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_quote_lines_quote ON quote_lines(quote_id);

-- ── product_prices seed (from TE3T Sample Price List R2y) ───────────────────
-- Torrefied material — $/short ton, SYP basis, by treatment level.
INSERT OR REPLACE INTO product_prices (product_seed_id, currency, price, cost) VALUES
  ('prod_0121','USD', 654, NULL),   -- TS-000LC  Chips  · Low
  ('prod_0122','USD', 812, NULL),   -- TS-000MC  Chips  · Mid
  ('prod_0123','USD',1910, NULL),   -- TS-000HC  Chips  · High
  ('prod_0126','USD', 712, NULL),   -- TS-000LP-TBP Pellets · Low
  ('prod_0119','USD', 712, NULL),   -- TS-000LP-TAP Pellets · Low
  ('prod_0125','USD', 873, NULL),   -- TS-000MP  Pellets · Mid
  ('prod_0124','USD',2010, NULL),   -- TS-000PH-TBP Pellets · High
  ('prod_0118','USD',2010, NULL),   -- TS-000PH-TAP Pellets · High
  ('prod_0116','USD', 812, NULL),   -- TS-000CUST      Chips   · Customer-supplied ($10k min)
  ('prod_0117','USD', 812, NULL),   -- TS-000CUST-P    Pellets · Customer-supplied
  ('prod_0120','USD', 812, NULL),   -- TS-000CUST-P-TAP Pellets · Customer-supplied
  -- Packaging
  ('prod_0031','USD',  25, NULL),   -- SS-424244   Super Sack
  ('prod_0032','USD',  40, NULL),   -- Sealed Super Sack (w/ liner)
  ('prod_0033','USD', 600, NULL),   -- SS-RENT     Sealer rental / week
  ('prod_0034','USD',  20, NULL),   -- PAL-4242    Pallet
  -- 3rd-party accredited lab (AH Knight) — cost + customer price (5kg sample)
  ('prod_0035','USD', 102,  85),    -- 3P-PROX  Proximate
  ('prod_0036','USD', 216, 180),    -- 3P-SCLF  +S,Cl,F
  ('prod_0037','USD', 216, 180),    -- 3P-ULT   Ultimate
  ('prod_0038','USD',  48,  40),    -- 3P-CV    Calorific value
  ('prod_0039','USD',  75,  50),    -- 3P-SHIP  Shipping & handling
  ('prod_0040','USD',  60,  50),    -- 3P-DUR   Mechanical durability
  ('prod_0041','USD',  66,  55),    -- 3P-PSD   Particle size distribution
  ('prod_0020','USD', 583, 530),    -- 3P-SHT-100-140  Self-heating test
  ('prod_0021','USD', 583, 530),    -- 3P-SHT-25-140   Self-heating test
  ('prod_0022','USD', 583, 530),    -- 3P-SHT-25-120   Self-heating test
  -- Internal lab (not accredited) — price only
  ('prod_0042','USD',  65, NULL),   -- INT-PROX Proximate
  ('prod_0043','USD',  30, NULL),   -- INT-CV   Calorific value
  ('prod_0044','USD',  30, NULL),   -- INT-DUR  Mechanical durability
  ('prod_0045','USD',  30, NULL),   -- INT-PSD  Particle size distribution
  ('prod_0046','USD',  20, NULL),   -- INT-BD   Bulk density
  ('prod_0047','USD',  50, NULL);   -- INT-HGI  Grindability / HGI
