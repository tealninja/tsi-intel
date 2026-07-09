# TSI Intel — Backlog (Claude-maintained working list)

Claude edits this file (via commits) as work is raised/finished. The
human-readable master snapshot is the Google Doc **"TSI — Notes & Backlog"**
(https://docs.google.com/document/d/1k87MEc1fns4ZjXODu9XChH-mE_M82fMcJe0fNmiDXUk/edit) —
the Drive connector can create/read but not edit in place, so the Doc is
refreshed from this file on request. See `CLAUDE.md`.

Legend: `[ ]` open · `[~]` in progress · `[x]` done · `[?]` decision · `[!]` blocked

## 🗒️ 2026-07-06 review — new batch (raised by JT)
**Quick wins / polish**
- [x] Pipeline **Value** shows thousands separators (commas).
- [x] Account list **obvious scroll** — resolved by removing the 260px cap (full list flows).
- [x] Account detail: map + climatogram **stack vertically on mobile** (were cramped side-by-side);
  even 1fr/1fr on desktop.
- [x] **Summary** KPI cards → **horizontal scroll strip** on mobile (was 5 squished columns).
- [x] **Quote drawer** verified fine at phone width (full-width single column); "too wide" was
  landscape/tablet only.
- [~] **Full mobile audit** — accounts, pipeline, products, quotes, summary, quote drawer checked.

**Navigation / IA restructure** — ✅ DONE
- [x] **Imminent** → a *filter* on Pipeline (⚡ chip, IMMINENT_IDS), Imminent tab removed.
- [x] Merge **Parse-updates + AI-assistant** into one **"AI + Parse"** tab with sub-tabs.
- [x] Move **Usage + Bug register** to the end.
- [x] Move **Products + Quotes** to just after Accounts.
- [x] Tab order: `Pipeline · Accounts · Products · Quotes · Won · Summary · AI+Parse · Usage · Bugs · MGMT`.
- [x] Refactored `showTab` to be **data-tab based** (no more brittle position-indexed matching).

**Accounts features**
- [x] **Account media** — per parent-account **logo** (shown in the account header + sidebar
  group list) + a **photo gallery** with a **prime photo** (banner on the detail / card).
  Client-compressed to JPEG data URLs, stored via `Store('account_media')` (local now, D1 on
  deploy). Follow-up: move large photo libraries to **R2** once the worker deploys (data URLs
  are fine for logos + a few photos; R2 is better for many/large images).
- [x] **Unassigned leads inbox** — "📥 Leads" launcher (user bar, with a new-count badge)
  opens a drawer: quick-capture (note / company / contact / source) + a triageable inbox.
  Actions: **→ Opportunity** (opens a prefilled new pipeline opp, stage Lead), Dismiss/Restore,
  delete. Stored via `Store('leads')` (local now, D1 on deploy). Ready to receive web-form /
  email requests once a worker route posts into the same collection.

**Quote generator**
- [x] **Print/PDF + Word** now use **theme colors + fonts** (deep-blue #19446C + teal
  #00929F, Inter + DM Serif Display; deep-blue pricing header, teal accents).
- [x] Rename **"proposal" → "quote"** in the builder, Print/PDF, and Word output.
- [x] Add a **Description** section after the "issued to" info (new `q-description`
  field + D1 `quotes.description` column + worker upsert).
- [x] Move **Assumptions & Clarifications to after the pricing** (Print + Word).
- [x] **Rich-text** long fields (bold, italic, bullets) via contenteditable + sanitizer.
- [x] **Attach the T&Cs** — full standard terms from the uploaded doc (19 sections) in a
  collapsible editable box (Q_TERMS_FULL); rendered in Print + Word; D1 `terms` column.
- [x] Import: **drag-and-drop** on Parse Updates — email (.eml)/Excel (.xlsx/.csv)/text,
  Excel via lazy SheetJS.
- [x] **Professional unique PN** — custom quote lines auto-get a `TSI-C#####` catalog PN
  (no blank PNs in the builder or Print/Word output).

**Decisions to talk through**
- [?] **Part numbers** — abstract them? (how far, and why)
- [x] **AI model tiering / user classes** — `jteal@`/`wteal@`/`bteal@tsi-inc.net` = **executive**:
  AI Assistant shows an "Executive" badge + a **model dropdown** (Sonnet default / Haiku),
  members get neither. Client sends `tier` + `X-TSI-Email`; the worker's `aiModelFor(email,tier)`
  picks the model server-side (members always standard; executives may choose). Model IDs are an
  easily-editable const block in the worker. **Runs once the worker deploys.**
- [ ] **Usage** tab should key on the **SharePoint** identity we already resolve.


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
  column filters, tagged to the soft identity). **Now editable: rename (✎), update-to-current
  filters (⟳), delete (✕) per view.** TODO: extend to accounts/quotes tabs; shared/team views.
- [x] **Identity: Cloudflare-hosted web = jteal** — on the deployed app (`*.bodhistoys.com` /
  `*.workers.dev`, no SharePoint context) the user defaults to jteal@tsi-inc.net (executive
  tier). SharePoint still wins when present; manual "Who am I" still overrides in-session.
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

## 📋 Quote Builder — next up (discussed)
- [ ] **AI quote builder** — natural-language → drafted line items. Two paths:
  in-app via the worker /api/ai proxy (uses API tokens) OR via the claude.ai MCP
  connector (no tokens). Needs a decision + the worker deployed.
- [ ] **Quote templates** — save a quote's lines + terms + config as a reusable
  template (Store('quote_templates')); start a new quote from one.
- [x] **Export** — **Word (.doc)** download (editable proposal, table-based layout for
  Word's renderer). Available from the builder footer (📄 Word) and each quotes-list row (📄).
- [ ] Full **rev history in D1** — rev # + status persist as columns today; the detailed
  per-revision snapshots are local-only (add a `revisions` JSON column / collection later).

## 🎤 Project Track — present mode (sales → engineering)
- [x] **Stage 1 — present mode** — full-screen "🎤 Present to Engineering" (from the Hot
  strip). Deck: Overview (map + KPIs + agenda) → business-line section dividers → one slide
  per opportunity, **technical scope first** (decoded scope-tag chips, spec text with counts
  highlighted, install/commissioning from MI/EI/COM tags, auto-extracted **capacity** TPY/×
  figures, muted-but-shown commercial block, bottom **track rail** with click-to-jump).
  Sections fixed: **Biomass → Engineered Wood → Torrefaction → Torrefaction Samples**;
  pipeline opps heuristic-classified; **Samples pulls from Biocarbon quotes**;
  **linked-stages ribbon** cross-refs siblings (Alfanar Stage 1/2, Idemitsu units).
  Keyboard ←/→/Esc, "Hide $" toggle, full-screen. Read-only.
- [x] **Stage 2 — curation builder (drag & drop)** — "🗂 Arrange deck" opens a kanban board
  (5 columns: the 4 business lines + "Not in deck"). Drag cards between lines to re-file, drag
  within a line to reorder, drop into "Not in deck" to hide. "↺ Reset to auto" clears overrides;
  "▶ Present" launches the deck in that exact arrangement.
- [x] **Server-side arrangement** — the builder now **pushes to D1** (bulk POST
  `/api/store/preso_sections`, one shared deck for the team) via a new `Store.saveAll()`;
  a save-state chip shows **☁ Saved to server** vs **⚠ this browser only**. Verified: client
  POSTs the correct `{id,section,ord,excluded}` payload; live D1 `collections` round-trip
  (insert→read→delete) confirmed. **Remaining: deploy the worker** so the route exists (below).
- [ ] Polish: real capacity fields (vs. regex), presenter notes, per-deck save/name/reuse,
  richer sample-quote slides.
- [ ] **Deck export to PPTX** (PptxGenJS via CDN, TSI-themed) so it's distributable /
  Canva-importable (Canva imports .pptx). Raised alongside "export to ppt or Canva".
- [x] **"What to present" settings** — "⚙ What to present" modal: **Auto / Smart rules /
  Hand-picked**. Smart filters (updated-within, closes-within, value ≥ X, stages) + **group-by
  line / stage / region** (deck sections are now dynamic). **AI describe box** parses a plain-
  English request → fills the rules via /api/ai (runs on worker deploy; degrades gracefully).

## 🗂️ Pipeline
- [x] **Stage view (kanban)** — ▤ Table / ▦ Stages toggle in the pipeline toolbar. Columns
  Lead→Qualified→Proposal→Negotiation→Verbal→PO Received with opp cards (acct/type/value/prob/
  close/lead, stage-colored spine); per-column count + value. **Drag a card to change its
  stage** (updates the record, marks dirty, best-effort worker save); click a card to edit.
  Honors the current search/filters/chips.

## ✅ Recently done
- [x] **Sync audit — spot records others changed** (build #87) — a ~60s background
  check (`auditSync`, paused when the tab is hidden) fetches the server copy of the
  `opportunities` collection non-destructively (no cache clobber) and compares record
  **versions** (not details) to local `DATA`. Rows someone else bumped get a pulsing
  yellow **(!)** badge in the ID cell (`title` names who); brand-new records surface via
  a floating **"⚠ N updated · M new by others · Refresh all"** pill. Clicking a badge
  pulls that one record into `DATA`; the pill pulls them all. Rows we're mid-edit on
  (`dirtyIds` or open in the drawer, `_drawerEditId`) are **skipped** so local work is
  never stomped. Verified via Playwright (badge/pill counts, refresh adoption, dirty/open
  skip).
- [x] **Quote shipping + addresses** — (A) accounts carry separate **bill-to / ship-to**
  addresses, each own / "same as another account" (child→parent sharing) / ship-same-as-
  bill, with nominatim geocode confirm + `resolveAddr()`. (B) Quote builder pulls bill-to/
  ship-to from the chosen account (source dropdown: parent / site / associated / manual),
  prints both on PDF + Word. (C) **⚡ Estimate** button → live parcel rates (USPS/UPS/FedEx/
  DHL) via new Worker route `POST /api/shipping/rates` → EasyPost (key = `SHIPPING_API_KEY`
  secret; free to quote; 501-degrades to manual until deployed). Fills freight + stamps carrier.
- [x] **Preso 16:9 + real-estate** — slides locked to a contained 16:9 box; raised the
  fill cap (1280→1760) so 1080p/1440p screens aren't wasted.
- [x] **Shared DropLine** — drop-position indicator (deck builder + pipeline stage board).
- [x] **TableKit — reusable list-table engine** — one registration-driven component
  (`TableKit.register(id,{columns,data,render,capture/apply})`) providing sort, column
  show/hide, column drag/resize, per-column value filters, and per-table **saved views**
  (Store('saved_views'), scoped by table id). Rolled out to **all list tables**: Pipeline
  (re-plumbed off its bespoke code), Products, Quotes, Price Book, Imminent. Views/Columns
  are shared floating popovers (one list table visible at a time).
- [x] **Account/site drawer prev-next arrows** — same `.drawer-nav` component as the
  opportunity drawer; pages sites (or parent accounts) in sidebar order, saving on page.
- [x] **NA pellet-producer accounts** — seeded 8 new parent accounts + 38 operating
  mills from the USA/Canada pellet-mill list (Drax +11, CM Biomass 9, Fram 4, AWF 3,
  Lignetics 7 [≥90k], Barrette, Canfor, Groupe Lebel, Highland Pine Bluff). Each with
  nameplate capacity (MTPY) + coords. Enviva's 10 mills backfilled with capacity +
  shipping ports (Chesapeake/Panama City/Mobile/Wilmington/Pascagoula/Savannah → 🚢
  markers). Corrected Drax "Amite" → Gloster, MS. Peak Renewables skipped (no operating
  mill yet); Amory left out (closed).
- [x] **Plant nameplate capacity + shipping port** — site editor gains a nameplate
  capacity (value + unit: MTPY / MMSF 3/8″ / MMBF 3/8″ / m³·yr / MW) and a shipping
  port (geocoded via "Locate"). Port shows a 🚢 boat marker + dashed connector on the
  accounts map and on the individual preso slide. _Pending: seed the Enviva mill→port
  list (JT has it)._
- [x] **Preso individual-slide map** — the per-opportunity slide now renders a real
  Leaflet locator map (was a CSS grid+pin schematic that read as "broken"), mirroring
  the working overview/summary map; grid+pin kept as offline fallback.
- [x] **Line of Business column** — pipeline table shows LoB (biomass / eng-wood /
  torref) between Category & Account; inline dropdown, auto-derived shown muted, sortable.
- [x] **Opportunities + accounts → D1** — both now persist through the generic
  `/api/store/*` collection store (opportunities import existing KV on first load +
  transitional KV mirror; accounts as a single `{id:'main'}` blob, adopt/seed on start).
- [x] **Word (.doc) export** — editable proposal download (Biocarbon letterhead, pricing
  table, scope/assumptions/terms), from the builder footer and each quotes-list row.
- [x] **Quote lifecycle** — Save-draft / Publish buttons; **rev control** (auto-bumps
  R0→R1 on re-publish, keeps a revision history w/ hover timeline); auto-generated
  quote № surfaced as read-only.
- [x] **Quote Builder line items** — fixed the mobile bug where qty/unit-price were
  clipped off-screen (wide table → responsive wrapping rows); added **drag-to-reorder**
  (handle), a **product autocomplete** search (with "add as custom line"), keeping the
  category/product dropdowns + quick-add chips.
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
