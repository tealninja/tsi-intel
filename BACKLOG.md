# TSI Intel — Backlog (Claude-maintained working list)

Claude edits this file (via commits) as work is raised/finished. The
human-readable master snapshot is the Google Doc **"TSI — Notes & Backlog"**
(https://docs.google.com/document/d/1k87MEc1fns4ZjXODu9XChH-mE_M82fMcJe0fNmiDXUk/edit) —
the Drive connector can create/read but not edit in place, so the Doc is
refreshed from this file on request. See `CLAUDE.md`.

Legend: `[ ]` open · `[~]` in progress · `[x]` done · `[?]` decision · `[!]` blocked

## 🚀 Deploy / go-live (blocked on the Cloudflare pipeline)
- [!] Deploy the quote API endpoints (`worker.js` /api/prices, /api/quotes) via
  `feature/db-seed-and-auth`. Patch: `docs/quote-api-for-db-branch.patch`. Flips the
  app from OFFLINE to D1.
- [!] Set the client `TSI_API_KEY` / `X-TSI-Key` so the app authenticates to the worker.
- [!] Deploy `tsi-intel-mcp` (KV namespace, `MCP_LOGIN_PASSWORD`) + add as a claude.ai
  connector. Steps in `mcp/README.md`.
- [x] D1 quotes/quote_lines tables + product_prices seed (31 rows) — live, verified.

## 🧭 Decisions needed
- [?] Price-list PN reconciliation (bare TS-000HP/LP vs catalog TAP/TBP variants).
- [?] MCP prod auth — shared password → Cloudflare Access managed OAuth.
- [?] Unit basis for material samples ($/st vs catalog unit "sample").

## 📋 Backlog / ideas
- [ ] Surface the D1 price-book price inline in the Products tab (shows "TBD" now).
- [ ] Make the Quote Builder "+ Quote" reachable from Products rows.
- [ ] Quote → Pipeline/Deal linkage once deals move to D1.
- [ ] Price Book bulk CSV import/export + price-change audit trail.
- [ ] Proper quote revisioning (R0 → R1) with history.
- [ ] Offline resilience: queue local quote saves, push to D1 on reconnect.

## 🔐 Accounts, roles & personalization (roadmap)
- [ ] **User login & management** — authenticated users; admin UI to manage
  users and roles.
  - [ ] **Saved user views** — per-user saved filters / column layouts / tab states.
  - [ ] **Follow / subscribe** to individual opportunities, quotes (and other items).
  - [ ] **Personalized activity view** — a feed of updates/changes on the items a
    user follows ("what changed on my stuff").
- [ ] **Power-user / role tiers** — privileged users (e.g. the CEO) get access to
  top-tier Claude models for on-demand chart & analysis generation; standard users
  get the lighter tier. Gate model/features by role.

## 🧱 Architecture & design system (roadmap)
- [ ] **Remove localStorage as the store of record** — bug register, quotes
  local-fallback, user identity/initials, and in-memory product edits currently
  live in the browser. Move persistence to D1 via the worker; keep localStorage
  only as an offline cache. Design the storage layer so **new entity types plug in**
  (extensible — one pattern for pipeline / bugs / quotes / prices / future objects).
- [ ] **TSI component library (in git)** — factor the app's repeated UI into a
  reusable component set (tabs, editable tables, drawers, KPI cards, chips, toasts,
  mode badges, tree grid, sub-tabs…) as part of the **design system / style set**,
  so features compose consistently. Ties into the extensibility work above.

## ✅ Recently done
- [x] Mobile: tab bar collapses to a **hamburger menu** (<768px).
- [x] Products: **family/tree view** (Category → Family → members, collapsible) +
  fixed the sticky column header.
- [x] Quotes tab: list + editable **Price Book** (D1) + **Quote Builder** (Biocarbon
  LLC proposal, QUO-#####-###### numbering, auto-filled prices, custom lines, PDF).
- [x] Loud offline / local-only save warnings.
- [x] `tsi-intel-mcp` remote MCP server (build quotes by chatting with Claude).

## 🔗 Related (other branches)
- Pipeline KV → D1 migration + auth hardening — `feature/db-seed-and-auth` (own TODO.md).
