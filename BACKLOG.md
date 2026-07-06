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

## 🔐 Accounts, roles & personalization (design LOCKED — see below)
Decisions: auth = **Cloudflare Access (SSO)** — not roll-our-own; IdP = **Microsoft
365 / Entra** (already in use via SharePoint); roles = **lean 3-tier**; personalization
= **follows/faves first, activity feed later**. Enforcement is **server-side** in the
worker (reads the Access JWT → email → role in D1); client role checks are UX only.

Roles (cumulative ladder):
- **member** — edit pipeline/quotes, view.
- **power** — member + MGMT + top-tier "power AI" (chart/analysis gen). The CEO.
- **admin** — power + user management.
(viewer/read-only is an easy add later if guests are needed.)

- [!] **PREREQ (yours):** enable Cloudflare Zero Trust, add Microsoft as the IdP, and
  put the `tsi-intel-api` worker (and ideally the app) behind an Access application.
  Nothing below identifies users until this is live.
- [ ] Phase 1 — **Auth + users/roles**: extend D1 `users` (email, role, ai_tier,
  active); worker validates the Access JWT + `/api/me`; role-gate mutations & MGMT
  (replaces the `initials==='JT'` hack). Admin UI to manage users.
- [ ] Phase 4 — **Power AI tiering**: `/api/ai` picks the Claude model by the caller's
  ai_tier (power → top/chart model, standard → lighter). Server-side.
- [~] Phase 2 — **Saved views** (per-user) on Store('saved_views'): **pipeline done**
  (⭐ Views dropdown captures/applies search + filters + close-chip + starred + sort +
  column filters, tagged to the soft identity). TODO: extend to accounts/quotes tabs;
  optional shared/team views.
- [~] Phase 3 — **Follows / faves** on Store('follows'): **pipeline done** — per-user
  🔔 follow toggle per opp (distinct from the team ⭐ star) + a "🔔 Following only"
  filter, captured in saved views. TODO: extend follow to quotes / accounts.
- [ ] Later — **Activity feed** ("what changed on my stuff"): needs audit logging on
  worker writes; "My activity" = events on followed/led items. Deferred (keep simple).

## 🧱 Architecture & design system (roadmap)
- [~] **Remove localStorage as the store of record** — built an extensible
  `Store(collection)` client + generic D1 `collections` table + `/api/store/*`
  worker endpoints (localStorage is now just an offline cache). **Bug register
  migrated.** Remaining: accounts (`tsi_accounts_v1`), saved opp views
  (`tsi_opp_views`), user identity/initials — migrate onto the same `Store`.
  (Device prefs like compact-mode / onboarding flag stay local by design.)
- [ ] **TSI component library (in git)** — factor the app's repeated UI into a
  reusable component set (tabs, editable tables, drawers, KPI cards, chips, toasts,
  mode badges, tree grid, sub-tabs…) as part of the **design system / style set**,
  so features compose consistently. Ties into the extensibility work above.

## ✅ Recently done
- [x] **Collapse sections cut off on mobile** — Hot Right Now / Pipeline Charts had
  fixed 200/260px caps; charts stack taller on phones and clipped. Now measured via
  scrollHeight (recomputed on load/resize/expand) so nothing is cut off, no desktop gap.
- [x] **Mobile header fix** — the 105px logo overflowed the 48px bar and shoved the
  title/dark-toggle off-screen; shrunk it on ≤768px so nothing is cut off (to 320px).
- [x] **Follows** (pipeline) — per-user 🔔 follow per opp + "Following only" filter.
- [x] **Column picker** — ▦ Columns dropdown shows/hides pipeline columns
  (nth-child, per-user, persisted + captured in saved views).
- [x] **Saved views** (pipeline) — per-user ⭐ Views dropdown (soft identity),
  persisted via Store('saved_views'); captures the full filter+sort+columns+follow state.
- [x] Extensible **D1 `Store`** (generic `collections` table + `/api/store/*`) and
  migrated the **bug register** off localStorage-as-record (cache/offline only).
- [x] Mobile: tab bar collapses to a **hamburger menu** (<768px).
- [x] Products: **family/tree view** (Category → Family → members, collapsible) +
  fixed the sticky column header.
- [x] Quotes tab: list + editable **Price Book** (D1) + **Quote Builder** (Biocarbon
  LLC proposal, QUO-#####-###### numbering, auto-filled prices, custom lines, PDF).
- [x] Loud offline / local-only save warnings.
- [x] `tsi-intel-mcp` remote MCP server (build quotes by chatting with Claude).

## 🔗 Related (other branches)
- Pipeline KV → D1 migration + auth hardening — `feature/db-seed-and-auth` (own TODO.md).
