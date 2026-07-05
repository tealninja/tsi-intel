# Deploy runbook — Quotes on D1, Price Book, and the MCP connector

Everything for the quote system is written and verified; this is what makes it
go live. Three independent pieces; do them in any order.

## Status snapshot

| Piece | State |
|-------|-------|
| D1 tables (`quotes`, `quote_lines`) | ✅ live (`migrations/004`) |
| D1 `product_prices` (31 rows from the sample price list) | ✅ live, verified |
| App UI (Quotes tab, Price Book, Quote Builder) | ✅ on this branch; served with `tsi-intel.html` |
| `worker.js` quote/price endpoints | ⏳ written, not deployed |
| `tsi-intel-mcp` connector | ⏳ written, not deployed |

Until the worker endpoints deploy, the app runs in **local (browser)** mode and
says so loudly. D1 tables/prices are already live, so it flips to **D1** the
moment the worker is up and the client key is set.

## 1. Quote API endpoints (`tsi-intel-api` worker)

The endpoints were added on top of the `feature/db-seed-and-auth` worker, so the
diff applies cleanly there.

```bash
git checkout feature/db-seed-and-auth
git apply docs/quote-api-for-db-branch.patch    # worker.js endpoints + migrations/004
# (migrations/004 is already applied to the live D1 — re-running is safe: IF NOT EXISTS / INSERT OR REPLACE)
wrangler deploy                                  # deploys tsi-intel-api
```

Endpoints added: `GET /api/prices`, `PUT /api/prices/:seedId`,
`GET/POST/PUT/DELETE /api/quotes(/:id)` — all D1-backed, totals recomputed
server-side.

## 2. Client API key (so the app leaves OFFLINE mode)

The worker fails closed without a key. In `tsi-intel.html`, `TSI_API_KEY` is
empty and `workerHeaders()` sends `X-TSI-Key` only when it's set.

- Set `wrangler secret put TSI_API_KEY` on the worker, and
- provide the matching key to the client (the app's existing key mechanism / the
  same way pipeline auth is configured).

Verify: open the app → **Quotes** tab → the banner turns off and the badge reads
**D1 database**; saving a quote shows "saved to the D1 database".

## 3. MCP connector (`tsi-intel-mcp` worker)

```bash
cd mcp
npm install
wrangler kv namespace create OAUTH_KV     # paste id into mcp/wrangler.jsonc
wrangler secret put MCP_LOGIN_PASSWORD    # shared access password
npm run deploy                            # → https://tsi-intel-mcp.<subdomain>.workers.dev
```

Then in **claude.ai → Settings → Connectors → Add custom connector**, URL
`https://tsi-intel-mcp.<subdomain>.workers.dev/mcp`, log in with the password,
and ask Claude to build a quote. Full notes + auth-upgrade options in
`mcp/README.md`.

## Verify the D1 layer directly (optional)

```sql
-- prices seeded
SELECT COUNT(*) FROM product_prices;                 -- 31
-- a quote round-trips (worker/MCP run exactly this shape)
SELECT id, customer_name, total,
  (SELECT COUNT(*) FROM quote_lines l WHERE l.quote_id=q.id) n_lines
  FROM quotes q ORDER BY created_at DESC LIMIT 5;
```
