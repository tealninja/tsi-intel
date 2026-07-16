# TSI Intel — D1 schema & seed load

Staging schema and seed SQL for the CRM data (accounts, contacts, products), generated
from the `seed_*.json` files at the repo root. Follows the `seed_manifest.json`
recommendation: **load into `staging_*` tables first, promote to live as a reviewed step.**

## Files

| File | What it is |
| --- | --- |
| `schema.sql` | Staging table DDL (`staging_accounts`, `staging_contacts`, `staging_products`) + indexes. Idempotent (`IF NOT EXISTS`). |
| `seed_staging.sql` | 876 rows (374 accounts, 371 contacts, 131 products) as `INSERT OR REPLACE`, wrapped in one transaction. Re-runnable. |
| `promote.sql` | **Template** for staging → live promotion. Column lists are assumptions — confirm against the live Worker schema before running. |

Validated locally against SQLite: all rows load, re-runs are idempotent, and every
foreign reference (contact→account, account/product→parent) resolves with zero dangling links.

## Prerequisites

1. `wrangler` authenticated (`wrangler login` or `CLOUDFLARE_API_TOKEN`).
2. Real `database_id` filled into `../wrangler.toml` — get it from `wrangler d1 list`.

## Load

```sh
# From the repo root.

# 1. Dry-run locally first (writes to a local SQLite replica, not prod):
wrangler d1 execute DB --local --file=db/schema.sql
wrangler d1 execute DB --local --file=db/seed_staging.sql
wrangler d1 execute DB --local --command "SELECT count(*) FROM staging_contacts;"   # expect 371

# 2. Apply to the real D1 (remote):
wrangler d1 execute DB --remote --file=db/schema.sql
wrangler d1 execute DB --remote --file=db/seed_staging.sql

# 3. Verify:
wrangler d1 execute DB --remote --command \
  "SELECT 'accounts' t, count(*) n FROM staging_accounts
   UNION ALL SELECT 'contacts', count(*) FROM staging_contacts
   UNION ALL SELECT 'products', count(*) FROM staging_products;"
```

## Promote (later, deliberate)

Only after reviewing `promote.sql` against the live schema:

```sh
wrangler d1 execute DB --remote --file=db/promote.sql
```

## Regenerating

`schema.sql` / `seed_staging.sql` are generated from the root `seed_*.json`. If the seed
files change, regenerate rather than hand-editing the SQL.

## Security notes (open items)

- **Repo visibility:** `seed_contacts.json` contains real emails + mobile numbers. Keep this
  repo **private**. Treat any data that was public as already exposed.
- **Worker auth is unverified.** The dashboard sends `X-TSI-User` (spoofable initials) and an
  optional `X-TSI-Key`; the MGMT-mode gate is client-side only. Before the contact tables are
  reachable through the API, confirm the Worker actually authenticates `/api/pipeline`,
  `/api/ai`, and friends — otherwise CRM PII and the Claude proxy are open at a public URL.
