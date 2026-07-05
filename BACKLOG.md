# TSI Intel — Running Backlog

The persistent, cross-session to-do list for this project. Not tied to any one
chat — add anything we discuss here so it survives across sessions. Newest
context near the top of each section.

Legend: `[ ]` open · `[~]` in progress · `[x]` done · `[?]` needs a decision · `[!]` blocked

> Maintenance: any Claude Code session should append items here when the user
> raises future work, and tick them off when done (see CLAUDE.md).

---

## 🚀 Deploy / go-live (blocked on the Cloudflare pipeline)

These are ready in code; they need deploying via the Cloudflare pipeline (not
possible from a Claude Code web session).

- [!] **Deploy the quote API endpoints** — `worker.js` gained `/api/prices` and
  `GET/POST/PUT/DELETE /api/quotes`. Deploy via `feature/db-seed-and-auth`
  (which owns `wrangler.toml`). Patch: `docs/quote-api-for-db-branch.patch`.
  Once live, the app flips from **OFFLINE** to **D1** automatically.
- [!] **Set the client API key** — the app's `TSI_API_KEY`/`X-TSI-Key` must be
  set so it authenticates to the worker (worker fails closed without it).
- [!] **Deploy `tsi-intel-mcp`** (the claude.ai quote connector) — create the
  `OAUTH_KV` namespace, set `MCP_LOGIN_PASSWORD`, `npm run deploy`, then add
  `…/mcp` as a custom connector in claude.ai. Steps in `mcp/README.md`.
- [x] D1: `quotes` + `quote_lines` tables + `product_prices` seed (31 rows) —
  applied live and round-trip verified.

## 🧭 Decisions needed

- [?] **Price-list PN reconciliation** — the sample price list uses `TS-000HP` /
  `TS-000LP` (bare) but the catalog has TAP/TBP variants (`TS-000PH-TBP`,
  `TS-000LP-TAP`, …). Prices were applied to all matching variants. Confirm
  which variant is canonical per treatment level, or collapse them.
- [?] **MCP auth for production** — currently a shared-password gate. Upgrade to
  Cloudflare Access managed OAuth (per-user identity) before real use.
- [?] **Unit basis for material samples** — priced per short ton ($/st) but the
  catalog unit is `sample`. Decide whether the price book should store a unit
  basis so quotes show `$/st` cleanly.

## 📋 Backlog / ideas discussed

- [ ] Make the Quote Builder's "+ Quote" reachable from the Products tab rows.
- [ ] Quote → Pipeline/Deal linkage (map a won quote to a Pipedrive Deal /
  pipeline opportunity) once deals move to D1.
- [ ] Price Book: bulk import/export (CSV) and an audit trail of price changes.
- [ ] Revisions: proper quote revisioning (R0 → R1) with history, not just a field.
- [ ] Sync quotes for offline resilience (queue local saves, push to D1 on reconnect).

## 🔗 Related work on other branches (not ours to own)

- Pipeline KV → D1 migration + auth hardening — `feature/db-seed-and-auth`
  (has its own `TODO.md`). Our worker.js quote endpoints should merge with it.

## ✅ Recently done (this workstream)

- Products catalog page (main) + **Quotes** tab: list, editable **Price Book**
  (D1), and **Quote Builder** (Biocarbon LLC proposal template, QUO-#####-######
  numbering, auto-filled prices, custom lines, printable PDF).
- Loud **offline/local-only** save warnings (banner, badge, drawer strip, button).
- `tsi-intel-mcp` remote MCP server (build quotes by chatting with Claude).
