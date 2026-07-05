# TSI Intel — project notes for Claude

## Running backlog (important)
The **master** cross-session/cross-project backlog is the Google Doc
**"TSI — Notes & Backlog"** (Drive id `1hwaW6UWV8QG3D8abJVHxex9VrpXnpiP__i5GNtXX8oQ`,
owner teal.john@gmail.com). When the user raises future work — in any session —
**update that Doc via the Google Drive connector** (read it, append/tick the item,
write it back), and do the same when work is finished. The in-session task tool is
ephemeral; the Doc is what survives.

If the Google Drive connector isn't available in a given session, fall back to the
repo `BACKLOG.md` breadcrumb and reconcile into the Doc later.

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
