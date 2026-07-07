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

A ready-to-use **`deploy/wrangler.toml`** sits next to the script with both
bindings already filled in (IDs verified live on 2026-07-06):

```bash
cd deploy
wrangler deploy        # uses wrangler.toml → deploys tsi-intel-api.js
```

That's it — no client change needed. The app auto-detects the endpoints and the
Quote Builder / Price Book / deck-arrangement flip from **OFFLINE** to **D1** on
next load. Both bindings the worker needs:

- **TSI_DATA** (KV `tsi-pipeline-data`, `e1b7efd464b647909e526903f52dc01f`) — pipeline/bugs/usage/locks.
- **DB** (D1 `tsi-intel`, `e18ad8cb-ce35-42b2-ba01-8a1d31551398`) — the new binding for
  prices, quotes, and `/api/store/*` (bugs, saved views, follows, **Project Track deck
  arrangement**, and now **opportunities + accounts** — see below).

### Opportunities + accounts now persist to D1 (`/api/store/*`)

The pipeline (opportunities) and the accounts/sites CRM used to live only in KV
(`/api/pipeline`) and `localStorage`. They now persist through the generic
collection store (`/api/store/:collection`, D1 `collections` table) — no worker
change is required, the generic route already handles arbitrary collections:

- **`opportunities`** — one row per opp. On first load the client imports any
  existing KV `/api/pipeline` records into the collection (nothing is lost), then
  reads/writes exclusively through the store. During the transition each opp save
  is **also mirrored** to the legacy KV `/api/pipeline/:id` so a static deploy that
  lands before this worker won't regress. The KV mirror can be dropped once the
  worker + client are both live on D1.
- **`accounts`** — a single `{ id:'main', data }` blob holding the whole
  `{accounts, contacts, equipment, outages, events}` object. On startup the client
  pulls it; if the collection is empty it seeds from the local copy, so an
  already-populated browser adopts its data into D1 on first run.

If you deploy without the **DB** binding, the D1 routes now return a clear
`503 "D1 not bound…"` instead of a cryptic 500.

**Auth:** leave `TSI_API_KEY` **unset** (permissive, prod-parity). Setting it
without also giving the client the matching key makes every write 401 — see the
header comment in `tsi-intel-api.js`.

## Notes

- **Auth:** kept permissive to match today's worker. When the Cloudflare Access /
  user-management work lands, front this Worker with Access (or set `TSI_API_KEY`
  on the Worker **and** the client) to lock it down.
- The repo's root `worker.js` is the fail-closed variant aligned with
  `feature/db-seed-and-auth`; this `deploy/` copy is the low-risk permissive drop-in
  for an immediate fix. Keep them in sync when the DB branch merges.
