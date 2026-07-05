# TSI Intel — project notes for Claude

## Running backlog (important)
`BACKLOG.md` (repo root) is the **persistent, cross-session to-do list**. When the
user raises future work — in any session, not just the one where it came up —
**add it to `BACKLOG.md`**, and tick items off there when done. Treat it as the
source of truth for "stuff we said we'd do." The in-session task tool is
ephemeral; BACKLOG.md is what survives.

## What this repo is
A single-page operations app, `tsi-intel.html` (data embedded as JS constants,
e.g. `_PIPELINE`, `PRODUCTS_SEED`), deployed to Cloudflare as **static assets**
via `wrangler.jsonc`. `.assetsignore` is a denylist — only `tsi-intel.html` +
`_redirects` are served publicly (all `*.md`, `*.sql`, `*.json`, `worker.js`,
`mcp/`, etc. are excluded).

Backends (separate Cloudflare Workers, **not** deployable from a web session):
- `worker.js` → the `tsi-intel-api` Worker. Pipeline/bugs in **KV**; quote +
  price endpoints (`/api/quotes`, `/api/prices`) in **D1**. Deploys via
  `feature/db-seed-and-auth` (owns `wrangler.toml`).
- `mcp/` → the `tsi-intel-mcp` Worker: a remote MCP server so quotes can be built
  by chatting with Claude on claude.ai (custom connector). See `mcp/README.md`.
- D1 database `tsi-intel` (id `e18ad8cb-ce35-42b2-ba01-8a1d31551398`): schema on
  `feature/db-seed-and-auth`; migrations in `migrations/`. `product_prices`,
  `quotes`, `quote_lines` are live.

## Conventions
- Match the surrounding style in `tsi-intel.html`; data lives inline as JS consts.
- Products/prices/quote lines key on `products.seed_id` (stable across SKU schemes).
- Verify UI changes by driving the app headlessly (pre-installed Chromium via
  Playwright) — the app's Chart.js/Leaflet CDN errors are expected offline and
  are not from your changes.
- Multiple branches touch `tsi-intel.html` and `worker.js` — check `origin/main`
  and `feature/db-seed-and-auth` before large edits to avoid clobbering.
