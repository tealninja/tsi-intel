# TSI Intel — project notes for Claude

## Running backlog (important)
The human-readable master backlog is the Google Doc **"TSI — Notes & Backlog"**
(Drive id `1k87MEc1fns4ZjXODu9XChH-mE_M82fMcJe0fNmiDXUk`, owner teal.john@gmail.com).
`read_file_content` it at the start of a session for context / items the user added
there. NOTE: the Drive connector is **read + create only — it can't edit a Doc in
place**, so you cannot tick items directly in the Doc.

Therefore: keep `BACKLOG.md` (repo root) as the Claude-maintained working list —
edit it via commits when the user raises or finishes work. When asked (or at a good
checkpoint), refresh the Google Doc from BACKLOG.md by re-generating it via the
connector. The in-session task tool is ephemeral; BACKLOG.md + the Doc are what survive.

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

## Deploying to Cloudflare (what Claude can/can't do via MCP)
The `mcp__Cloudflare_Developer_Platform__*` tools let Claude **inspect and verify**
Cloudflare, but **not deploy**. There is no MCP tool to upload a Worker script or
static assets — the two `wrangler deploy` steps and all secrets are **human/CLI only**.

**Claude CAN (via MCP):**
- **Query/verify D1** — `d1_database_query` on db `e18ad8cb-ce35-42b2-ba01-8a1d31551398`.
  Handy checks: `SELECT name FROM sqlite_master WHERE type='table'`; row counts on
  `quotes` / `collections` / `product_prices` to confirm data is landing.
- **Inspect deployed Workers** — `workers_list`, `workers_get_worker`,
  `workers_get_worker_code` (e.g. confirm the deployed `tsi-intel-api` contains
  `/api/store`, `/api/quotes`, `/api/shipping/rates`). `*_code` may need approval.
- **Manage resources** — `kv_namespace_*`, `r2_bucket_*`, `d1_database_*`; search CF docs.

**Claude CANNOT (needs a human running `wrangler`):**
- **Deploy** the static app or the API Worker (no upload tool exists).
- **Set secrets** (`wrangler secret put SHIPPING_API_KEY` / `ANTHROPIC_API_KEY` / `TSI_API_KEY`).
- **Read the live static site** — WebFetch to tsi-intel.bodhistoys.com 403s through the
  agent proxy. Use the header **build stamp** (`APP_BUILD` in `tsi-intel.html`) for
  human confirmation, and **bump `APP_BUILD` on every deployable change**.

**Human deploy steps (wrangler):**
1. Static app: `git checkout <branch> && npx wrangler deploy` (repo root, `wrangler.jsonc`).
2. API worker: `cd deploy && wrangler deploy` (`deploy/wrangler.toml` + `tsi-intel-api.js`;
   binds DB=D1 + TSI_DATA=KV; adds prices/quotes/store/shipping routes).
3. Shipping: `cd deploy && wrangler secret put SHIPPING_API_KEY` (EasyPost; rating is free).

**Claude's post-deploy verification (MCP):** read the deployed `tsi-intel-api` code for
the new route strings, then after the user saves a quote / edits an account,
`d1_database_query` that `quotes` / `collections` gained rows.

## Conventions
- Match the surrounding style in `tsi-intel.html`; data lives inline as JS consts.
- Products/prices/quote lines key on `products.seed_id` (stable across SKU schemes).
- Verify UI changes by driving the app headlessly (pre-installed Chromium via
  Playwright) — the app's Chart.js/Leaflet CDN errors are expected offline and
  are not from your changes.
- Multiple branches touch `tsi-intel.html` and `worker.js` — check `origin/main`
  and `feature/db-seed-and-auth` before large edits to avoid clobbering.
