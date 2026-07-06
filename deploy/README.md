# Deploy: make the Quote Builder go online (D1)

**Why it's "offline" now:** the live `tsi-intel-api` Worker (last deployed
2026-06-29) has no `/api/prices`, `/api/quotes`, or `/api/store` routes and no
D1 binding, so the app's calls 404 and it falls back to local mode. The D1
database itself is fine — `quotes` + `quote_lines` tables and 31 seeded prices
are already live.

## `tsi-intel-api.js` — ready-to-deploy drop-in

This is the **current live worker + the new quote/price/store endpoints**, kept
**permissive** (GET reads open, no key required) so it behaves exactly like the
worker running today — deploying it won't break the pipeline/bugs/AI features.
It adds:

- `GET /api/prices`, `PUT /api/prices/:seedId`
- `GET/POST/PUT/DELETE /api/quotes(/:id)`
- `GET/POST /api/store/:collection`, `PUT/DELETE /api/store/:collection/:id`

## Deploy (whoever owns the `tsi-intel-api` Worker)

1. Use `deploy/tsi-intel-api.js` as the Worker's `main` script.
2. Ensure the Worker's `wrangler.toml` has **both** bindings:
   ```toml
   [[kv_namespaces]]
   binding = "TSI_DATA"
   id = "e1b7efd464b647909e526903f52dc01f"

   [[d1_databases]]           # ← this is the new one the quote endpoints need
   binding = "DB"
   database_name = "tsi-intel"
   database_id = "e18ad8cb-ce35-42b2-ba01-8a1d31551398"
   ```
3. `wrangler deploy`.

That's it — no client change needed. The app auto-detects the endpoints and the
Quote Builder / Price Book flip from **OFFLINE** to **D1** on next load.

## Notes

- **Auth:** kept permissive to match today's worker. When the Cloudflare Access /
  user-management work lands, front this Worker with Access (or set `TSI_API_KEY`
  on the Worker **and** the client) to lock it down.
- The repo's root `worker.js` is the fail-closed variant aligned with
  `feature/db-seed-and-auth`; this `deploy/` copy is the low-risk permissive drop-in
  for an immediate fix. Keep them in sync when the DB branch merges.
