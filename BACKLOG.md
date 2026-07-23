# TSI Intel — Backlog (Claude-maintained working list)

Claude edits this file (via commits) as work is raised/finished. The
human-readable master snapshot is the Google Doc **"TSI — Notes & Backlog"**
(https://docs.google.com/document/d/1k87MEc1fns4ZjXODu9XChH-mE_M82fMcJe0fNmiDXUk/edit) —
the Drive connector can create/read but not edit in place, so the Doc is
refreshed from this file on request. See `CLAUDE.md`.

Legend: `[ ]` open · `[~]` in progress · `[x]` done · `[?]` decision · `[!]` blocked

## 🗒️ 2026-07-23
- [x] **"Shipping port" → generic "Shipping location"** (build #169). A site's outbound
  destination is no longer assumed to be an export port — it can be a port *or* a
  direct-to-customer address. Renamed everywhere user-facing: site-drawer label +
  helper/placeholder, account-card badge, accounts-table column, map marker popup/tooltip
  (account map + presentation-mode job map), and geocode status text. Port-specific 🚢
  swapped for a neutral 📦. Data keys unchanged (`shippingPort`, `portLat`, `portLon`) so
  stored/embedded records and other branches keep working; still gated to production sites.

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

### 🗒️ 2026-07-16/17 session cont. — visits, familiarity, quotes, opp→site (builds #154–#168)
Branch `claude/reintegrate-features-tablekit` → fast-forwarded to `main` after each change.

**Mill visits (new tab)**
- [x] **Visits log** — generic `activities` collection (type `visit`; call/meeting/sample reserved).
  Person(s) + mill/site + date + areas-looked-at (tags) + notes + report link. TableKit list with
  date-range filter + per-person filter; account/site detail gets a "Field visits" section.
- [x] **Excel export / import** for the visit log (Date, Days, Type, People, Mill, Account, Looked at,
  Notes, Report, ID, Site ID). Import resolves site by id or name; upserts by ID.
- [x] **Familiarity map** — 🗺️ view: every site is a bubble sized/coloured by familiarity at a
  scrubbed date = Σ(days × linear decay to zero over a year). Fades to **black** over the year since a
  visit (= mills that don't know us). Timeline scrubber + Play. Filters: person, line of business,
  customer status, account. Visits gained a **days-on-site** field.

**Presentation / deck**
- [x] Deck-builder **star** indicator + **filters** (search / stage / ⭐ starred).
- [x] **Slide footer** → TSI logo + Confidential moved **top-right** (out of the scroll path); section
  items compacted to a **single row** (tags inline).
- [x] Deck job maps: **pan/zoom + saved per-mill framing** (`preso_mapviews`).
- [x] **Package deck → self-contained static HTML** ("⬇ Save HTML"): every slide, charts baked to PNG,
  framed maps, styles inlined, keyboard/arrow nav. (No export **history** yet — see open items.)
- [x] **FIX: preso maps/climatograms were mis-located** — used fuzzy `LOC_COORDS` on the opp's loc
  string. Now `presoJobCoords`/`oppSite` resolve the real **site** coords (acctId → acctMatch+city →
  exact loc), disambiguating same-named towns (LP→Newberry MI vs West Fraser→Newberry SC).

**Opp → site model**
- [x] **`oppSite(o)` linker + one-click backfill** ("🔗 Auto-link all to sites" in the opp gap review) —
  keyed 57/73 open opps to their site (persists acctId).
- [x] **Opp location inherits (read-only) from the linked site**; unlinked/sample opps stay editable.

**Accounts**
- [x] Corporate/HQ locations: **no climatogram** (weather is a plant concern); **office-building
  markers** on the accounts map + an **All / Plants / Corporate** filter.
- [x] Bill/ship-to gained **Attn + Dept/building (line 2)** and a **full-name Country** (Japan) — the
  geocoder resolves Asia poorly; addresses now round-trip (Kobe Steel example).
- [x] **Industry is a multi-tag editor** (confirmed live — was a deploy-lag confusion, not a code gap).

**Quotes**
- [x] **Fixed line-item column alignment** (unit-price field was too narrow → truncated prices).
- [x] **Quote / Budgetary-estimate toggle** — **budgetary is the default** (no T&Cs, no acceptance
  line; "planning only" note). Quotation = full actionable doc. Applies to Print/PDF + Word.

**Dashboard map**
- [x] Location popup: opportunities now **link** — account name → the account, project type → the opp drawer.

**Housekeeping**
- [x] Header build stamp slimmed to the number; logos back onto **white** + upload as **PNG** (no black).

**Open / next (raised, not yet built)**
- [ ] **Slides: commissioning key** (white=not included, green=included) + generalize "Scope of Supply"
  into Engineering / Equipment / Controls / Mechanical / Electrical / Commissioning inclusions
  (+ possible products/equipment section).
- [ ] **Quote from opportunity** — "start from opp" picker pulling account/contact/bill-ship/location/
  scope, linking the quote back to the opp.
- [ ] **Accounting currency format** in the quote pricing table (symbol flush-left, amount right-aligned).
- [ ] **Export history for "Save HTML"** — archive each deck export (timestamp + slide count), re-downloadable.
- [ ] Refresh the Google Doc from this BACKLOG.

**Known follow-ups**
- [ ] Deleting an opp doesn't clean its legacy KV mirror (harmless now).
- [ ] Opportunities are JSON blobs in the D1 `collections` table — could promote to a real table.
- [ ] Traffic **Unassigned** column / familiarity-map **black dots** are the natural "needs attention" inbox.

### 🗒️ 2026-07-16 session — pipeline tree, traffic, preso & polish (raised by JT, builds #135–#153)
Branch `claude/reintegrate-features-tablekit` → fast-forwarded to `main` after each change.

**Pipeline / table**
- [x] **Date-range column filters** — any table column holding dates gets a header ▾ popover:
  all / before / after / between, with a dual-thumb slider over the column's date domain
  (built as the reusable `.drf` component in tsi-style, applied via TableKit `dateFilters`).
- [x] **Pipeline tree view "by parent account"** — renders INTO the main `#pip-table` so it
  inherits the same column choices, show/hide, resize and widths. Rolls up total value,
  weighted value and blended probability per parent; a **sub-tree** appears when a site has
  more than one opportunity. Caret (2×) + left-justified parent headline.
- [x] **Parent-account column** in the pipeline table (sortable/filterable, hidden by default).
- [x] **Bulk-edit checkbox column + bulk delete** in the table.
- [x] **Row-icon polish** — star/bell/link centered vertically and enlarged; starred rows kept
  at readable contrast (deepened teal).
- [x] **Star + inline edits auto-save to D1** — confirmed & fixed (was a 409 on the old base;
  new base uses `/api/store`, no version conflict). `syncStarredFromData()` on load/boot.
- [x] **Delete actually syncs** — root-caused a `loadFromWorker` bug that merged the embedded
  `_PIPELINE` seed back in and resurrected deleted opps; now only local *unsaved* rows survive
  a refresh. Verified deleted opps stay gone in D1.
- [x] Header cleanup: dropped the "Operations Review · date" subheading; enlarged the dashboard title.

**Stage board**
- [x] **Group-by + sort-by** controls (group by company / line of business; sort alphabetically).

**Accounts**
- [x] **Industry is now a multi-tag editor** (like Product Types) — a site/parent can span several
  industries; legacy "OSB/LVL" strings parse into tags, saved as `industryTags[]` + a joined string.
- [x] **HQ/corporate locations hide capacity + shipping port** (production-only attributes) on both
  the account card and the site drawer (row toggles live with Location Type).
- [x] **Capacity/port row alignment** fixed in the site drawer (trailing status line was
  bottom-aligning the cells and lifting the port input).
- [x] **Logos back onto white** everywhere (account header, sidebar thumb, media preview) so
  transparent SVG/PNG logos read on any surface, including dark mode.
- [x] **Logos upload as PNG** (were re-encoded to JPEG → transparent pixels went **black**);
  transparency now preserved. NOTE: logos stored before #151 must be **re-uploaded** to drop
  their baked-in black.

**Deck builder / presentation ("Project Track")**
- [x] **Ctrl/Shift multi-select + multi-card drag** in the deck builder (much faster arranging).
- [x] **Group slides by line / region / account / parent account** (dynamic sections ordered by value).
- [x] **"Value by business line" overview bars segmented by job** with white divider lines +
  per-job tooltip breakdown.
- [x] **Customer logo on the section header** when a section is grouped by account/parent and all
  jobs share one logo. (Per-job slide logos **2× larger**, shadow → hairline border.)
- [x] **Stage-snapshot slide per section** — a read-only kanban of just that section's
  opportunities-under-review across the PIP_STAGES funnel (skips single-opp sections & quotes).

**Traffic (new tab) — assignment & workload** (build #153)
- [x] **🚦 Traffic board** — one column per person + a dashed **Unassigned** column. Deals are
  **weighted by stage** (Lead ×1 … PO Received ×6) so each column's ⚙ effort score + load bar
  reflect real load, not headcount. Sort people by effort / value / count. **Drag a card onto a
  person to assign** (sets `lead`, stamps updatedAt/By, logs, persists via `oppPersist`); the
  pipeline table re-renders in sync. Verified light + dark.

**Housekeeping**
- [x] Header **build stamp slimmed** to just the number (#153); full stamp moved to the profile
  menu + header tooltip.
- [x] Confirmed **where opportunities live**: D1 `collections` table, `collection='opportunities'`,
  one JSON blob per opp (not a dedicated table). Follow-up idea below.

**Known follow-ups from this session**
- [ ] Deleting an opp doesn't clean its **legacy KV mirror** (`/api/pipeline/:id`) — harmless now
  (KV only read on a first-run empty store) but worth a tidy-up when we drop the KV transition.
- [ ] Optionally promote **opportunities to a real D1 table** (currently JSON blobs in `collections`).
- [ ] Traffic **Unassigned** column is the natural inbox for parsed/web-form opps that arrive with
  no owner — wire new intake to land there.

### earlier
- [x] **Accounts tabular view** (build #134) — a ▦ Table toggle in the Accounts
  header opens a full sortable/filterable grid of every account & site, sharing
  the TableKit engine with the pipeline/quotes tables: click-to-sort, per-column
  value filters (▾▾), show/hide columns, drag-reorder, resize, and saved views.
  Search + Type (account/site) + Customer-status filters; a row opens the site
  drawer. Columns: name, type, parent, industry, location type, customer status,
  plant types, nameplate, city/state/country, geocoded, port, opp count, primary
  contact, last update (industry/loc-type/state/port/contact hidden by default).
- [x] **Header profile button** (build #133) — sign in as yourself (name/email/
  initials) from the header; the shared web app no longer defaults everyone to
  John. Sync-alert "Refresh all" is now a real button.
- [x] **Gap-review "fix" flow + account cleanup** (builds #131–#132):
  - **Accounts sidebar header** no longer overflows — the map/push/KML/site/gaps
    buttons wrap onto their own row under the title.
  - **Opportunity Account field** — removed the duplicate autocomplete (native
    datalist **and** custom popup were both showing); now one styled autocomplete
    over ALL accounts that resolves the real account FK on select.
  - **Dockable "fix" flow** (accounts **and** opportunities): "Fix all"/row-click
    keeps the review list docked open on the left while the drawer edits on the
    right — no greying, no losing your place. Save auto-advances to the next
    flagged record; prev/next pages the flagged set (sorted to match the list).
  - **Delete account/site** — drawer button + 🗑 on each review row; cascades child
    sites and unlinks affected opps (they resurface in the opp gap review). Confirm.
  - **Reassign/merge** a duplicate (abbreviation) account into a canonical one —
    re-parents its sites, re-links its opps, then removes the duplicate.
- [x] **Quote builder overhaul** (builds #103–#105) — eight tweaks:
  1. **My Companies** page/modal: manage seller entities (TSI + Biocarbon seeded — name,
     address, EIN, uploadable logo, default flag; persisted to D1 `companies`), with an
     **"Issued by (seller)"** selector on the quote. Exports use the chosen company's
     details + **logo**.
  2. **PO contact** — "Issue PO to" name + email, shown on exports.
  3. **Schedule** section (rich text) printed right after the pricing summary.
  4. **Default / custom** toggle on Assumptions, Payment, Delivery, T&C: "Use default"
     (locked, tracks an editable global default) vs "Custom" (with ⤵ import-default);
     **✎ edit default** opens a modal saving the global default (D1 `quote_defaults`), so
     one edit updates every default-mode quote.
  5. **Word export**: 1in margins, **Aptos** font (not Calibri), Section with repeating footer.
  6. **Accounting number format** (negatives in parentheses) for all quote money.
  7. **Acceptance/signature** section at the end of the quote (separate from T&C) with a
     large signature / printed-name / title / date block.
  8. **Footer** on both PDF + Word: quote# + rev (left), CONFIDENTIAL (center), page x of y
     (right — Word field codes; CSS page counters for print).
  Verified via Playwright (seller wiring, exports contain seller/logo/footer/acceptance,
  accounting format, PO + schedule round-trip, default/custom modes + editable defaults).
- [x] **Account bill/ship address source → radios + account finder** (build #102) — replaced the
  bill-to / ship-to source `<select>` in the account editor with radio buttons: **This account's
  own address** (shows the editable + geocode-verified fields) vs **Use another account's address**
  (an autocomplete box to find the account to bill/ship through); ship-to also keeps **Same as
  billing**. The picked account's id is stored in billToRef/shipToRef exactly as before, so
  resolveAddr and quotes are unchanged. Verified via Playwright (default own, switch to other,
  autocomplete pick, save ref, resolveAddr follows it, reopen restores state).
- [x] **KML mill import + customer-status flag/filter** (builds #100–#101) — accounts gained a
  **Customer status** field (Current / Potential / not set) in the editor plus an **All / ✅
  Current / 🎯 Potential** filter row in the sidebar (a group shows if it or any site matches).
  New **📍 KML** button imports a Google Earth `.kml`: each Placemark becomes a top-level account
  (name + coordinates), with customer status inferred from its ancestor folder ("Current
  Customers" → current, "Potential Customers" → potential). Existing names are skipped and a
  confirm dialog shows the breakdown before writing. Verified against the real 192-placemark
  file: 158 new mills (34 current · 90 potential), 34 skipped, coords + status set, filter works.
  Follow-up: mills import as top-level accounts — re-parenting under company groups is manual.
- [x] **Accounts — "☁ Push" to cloud button** (build #98) — an explicit force-push of the whole
  accounts+contacts blob to D1 with a confirmation toast ("✓ Pushed N accounts · M contacts").
  Edits already auto-sync via saveAccounts(); this is a manual belt-and-suspenders control for
  seeding a freshly-live DB. Confirmed live D1 state via MCP: `accounts` = 1 blob (37 KB, 160
  accounts), `opportunities` = 79 rows — the seed is already persisted; the button just lets you
  re-push on demand.
- [x] **Quote Builder — quick-create account** (build #97) — when the customer typed into a
  quote doesn't match an existing account, a "No matching account — ➕ Quick-create it" prompt
  appears. It opens a modal (name pre-filled, optional contact, bill-to + optional separate
  ship-to), saves a new top-level account + linked contact to the Accounts store (localStorage
  + D1), then points the quote at it — filling customer, contact, and auto-populating the
  bill-to/ship-to from the new account — and closes. Dedupes against an existing name. Verified
  via Playwright (prompt → create → use → persist → dedupe).
- [x] **Update Agent — conversational opportunity updates** (build #95) — a new
  **💬 Update Agent** sub-tab in the AI + Parse area: an AI chat that updates existing
  opportunities (or adds new ones) from natural language ("Drax Princeton slipped to Q1
  2027, now 80%", "we won the Berneck dryer"). It matches the deal by its stable **id**
  (asking to disambiguate when an account has several open deals), then shows a
  **proposed-change diff** (old → new per field) in the sidebar for review before anything
  is written. **Apply** patches the record by id, bumps version, stamps updater + a history
  entry, marks it dirty, and syncs to D1. Degrades gracefully with a clear "set
  ANTHROPIC_API_KEY" message when the AI endpoint is unconfigured. Complements the
  intake-focused AgentJohn (still in MGMT). **Note:** all AI features (this, AI Assistant,
  Parse Updates, AgentJohn) require the **ANTHROPIC_API_KEY** secret on the `tsi-intel-api`
  Worker — until it's set the endpoint returns 503/404 and chats show no response.
  Verified via Playwright (propose diff, apply-by-id, version bump + history, AI-down path).
- [x] **Onboarding logo** (build #94) — the TSI leaf mark was aliasing into a thin crescent
  at 42px; rendered at 60px in the welcome modal it reads as a leaf again.

- [x] **Greeting robustness + coworker-safe local identity** (builds #90–#92) — the welcome
  card wasn't appearing when the downloaded `tsi-intel.html` is opened directly (a `file://`
  open has no SharePoint login, so there was no one to greet). A `file://` page also can't
  call the SP `/_api/web/currentuser`, so the live MS identity isn't retrievable locally.
  Rather than silently assume John (which would mislabel a **coworker** who opens their own
  download as John, executive tier and all), a local/desktop open now **asks who's using it**:
  the onboarding modal gained **name + email + initials** fields, **pre-filled with John** so
  he confirms in one click while a coworker types their own; the choice is remembered per
  browser (cache wins on return). The bodhistoys/workers.dev web landing still auto-defaults
  to John's Gmail, and SharePoint still auto-detects and overrides live whenever reachable.
  Also hardened: (a) greet on initials alone so a slow SP API can't suppress the card;
  (b) checklist render wrapped in try/catch with a minimal-greeting fallback; (c) `.catch` +
  3s safety-net trigger on the identity promise; (d) card z-index raised above SharePoint's
  suite bar; (e) fixed a load-order race where the identity microtask ran before the
  onboarding markup was parsed (checkOnboarding now defers to DOMContentLoaded). Verified via
  Playwright over `file://`: John pre-fill→confirm (exec), coworker override (not exec, not
  mislabeled), returning-user cache, no premature greeting.
- [x] **Ask-on-open everywhere identity is unknown** (build #93) — made the rule uniform:
  if identity can't be *determined* (no SharePoint session, no remembered user) the app
  **asks on open** rather than assuming anyone. The bodhistoys/workers.dev web landing no
  longer silently claims John either — it now shows the same prompt, pre-filled with his
  **Gmail** (local files pre-fill his **MS** identity; any other host is blank). SharePoint
  and the per-browser cache still resolve silently. Verified via Playwright: web landing
  now prompts (source stays 'manual', not auto-claimed) and confirm → Gmail + exec.
- [x] **Welcome status card** (build #89) — the login greeting grew into a richer,
  longer-lived card (stays ~11s, **pauses on hover**, has a **×** to dismiss). Header is
  the "Hi {name}" + email + avatar as before; below it a **linked-vs-local checklist** of
  the six data areas — Pipeline, Accounts, Quotes/price book, Saved views·follows, Bug
  register, Account photos — each tagged **Linked** (✓ green, D1), **Syncing** (⋯ while a
  pull is in flight, e.g. Quotes until its tab loads), or **Local** (○ amber, this browser
  only). A cloud banner summarizes "☁ Linked · N/6 synced" (or "○ Local only" with no API).
  Footer status chips: build #, identity source (SharePoint / Web·bodhistoys), and — when
  present — **N unsaved** and **N updated by others**. Re-renders every 1.2s so Syncing→Linked
  updates live. Verified via Playwright (states, transitions, chips, hover-pause, dismiss).
- [x] **Login welcome + landing identity** (build #88) — a one-time **"Hi {name}"**
  greeting toast (with the user's email + initials avatar) slides in from the top once
  identity resolves on load (SharePoint, bodhistoys landing, or manual onboarding; shown
  once per page load). Landing via **bodhistoys.com / workers.dev** now identifies John
  Teal by his personal Gmail **teal.john@gmail.com** (initials derived from the name → JT;
  kept on the executive AI tier). **SharePoint (and everyone else) still uses SharePoint
  creds**, with initials derived from their Title. Verified via Playwright (both identity
  paths, initials derivation, exec-tier flag, no-duplicate greeting).
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

## 💤 Parked (not now — revisit if the need is felt)
- **RFP / Bid tracking on opportunities** — reviewed a real RFP (Perpetual Next
  DT70_RFP009). Candidate additions were: an RFP/Bid section (RFP #, revision,
  issue date, questions-due, bid-due date, validity, contract form e.g. FIDIC,
  bid/no-bid, submission status), opportunity-level customer buying team + Owner's
  Engineer/EPC, decision milestones (Gate/FEED/FID + estimate class), deliverables
  + compliance checklist, and competition. Deferred on 2026-07-14 to avoid making
  the opp drawer too granular/complex; Scope narrative / Tags / Notes hold RFP
  specifics ad-hoc for now.

## 🔗 Related (other branches)
- Pipeline KV → D1 migration + auth hardening — `feature/db-seed-and-auth` (own TODO.md).
