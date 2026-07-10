/**
 * TSI Intel — Cloudflare Worker API
 * Serves pipeline + bugs data from KV, handles CORS,
 * optimistic concurrency, and a simple shared secret for auth.
 *
 * KV namespace: tsi-pipeline-data
 * Keys:
 *   pipeline   → { schema_version, exported_at, records: [...] }
 *   bugs       → [ ...bug objects ]
 *   usage_log  → [ ...usage events ] (last 1000)
 */

const KV_PIPELINE = 'pipeline';
const KV_BUGS     = 'bugs';
const KV_USAGE    = 'usage_log';

// ── AI model tiering (soft user classes; enforced here, server-side) ──
// Adjust the model IDs to whatever the Anthropic API key can access.
const AI_EXEC_EMAILS = ['jteal@tsi-inc.net','teal.john@gmail.com','wteal@tsi-inc.net','bteal@tsi-inc.net'];
// NOTE: model IDs must be ones your Anthropic key can access, else the API
// returns a 404 "model not found" (which the client surfaced as "[object
// Object]"). The executive id 'claude-sonnet-4-6' was NOT valid — that's why
// members (haiku, below) worked but executives (jteal) got the error.
const AI_MODELS = {
  standard:  'claude-3-5-haiku-latest',    // members — fast/cheap (confirmed working)
  executive: 'claude-sonnet-4-5',          // executives — corrected from invalid claude-sonnet-4-6
};
const AI_EXEC_CHOICES = {                  // an executive may pick any of these
  sonnet: 'claude-sonnet-4-5',
  haiku:  'claude-3-5-haiku-latest',
};
function aiModelFor(email, tier){
  const isExec = AI_EXEC_EMAILS.includes(String(email||'').toLowerCase());
  if (!isExec) return AI_MODELS.standard;                // members always standard
  return AI_EXEC_CHOICES[tier] || AI_MODELS.executive;   // executives may choose
}

// AUTH — permissive drop-in, matching the worker running in prod today.
//   • Leave TSI_API_KEY UNSET → this Worker allows all requests. That is the
//     intended config here: the client (tsi-intel.html) ships with an empty key
//     and does NOT send X-TSI-Key, so it just works — no client change needed.
//   • FOOTGUN: if you `wrangler secret put TSI_API_KEY`, every write (POST/PUT/
//     DELETE) will 401 until you ALSO set the matching key in the client
//     (TSI_API_KEY in the HTML, which makes workerHeaders() attach X-TSI-Key).
//     Never set one side without the other. For real protection prefer putting
//     the Worker behind Cloudflare Access over a shared key (see BACKLOG.md).
function isAuthorized(request, env) {
  if (!env.TSI_API_KEY) return true;             // no key configured → open (prod-parity)
  const key = request.headers.get('X-TSI-Key');
  return key === env.TSI_API_KEY;
}

// CORS — permissive by design here: reflect the caller's Origin (falls back to
// '*'), matching the live worker so the SharePoint-hosted app can read responses
// cross-origin with zero extra config. ALLOWED_ORIGINS is currently a no-op
// placeholder — to lock CORS down later, gate corsHeaders() on it (set it to the
// app's exact origin, e.g. 'https://<tenant>.sharepoint.com', and reject others).
const ALLOWED_ORIGINS = [
  // 'https://<your-tenant>.sharepoint.com',   // ← only used once you enforce the allowlist
];
function corsHeaders(origin) {
  // Reflect the caller's origin, but coerce a missing or opaque origin to '*'.
  // A local download (file://) sends `Origin: null`; echoing `null` back is
  // rejected by Chrome ("value 'null' is not equal to the supplied origin"),
  // which surfaces as an opaque "Failed to fetch" on writes. '*' is accepted
  // for these non-credentialed requests, so the downloaded copy can still save.
  const allow = (origin && origin !== 'null') ? origin : '*';
  const h = {
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-TSI-Key, X-TSI-User, X-TSI-Email',
    'Access-Control-Max-Age':       '86400',
    'Vary':                         'Origin',
  };
  if (allow) h['Access-Control-Allow-Origin'] = allow;
  return h;
}

function json(data, status=200, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) }
  });
}

function err(msg, status=400, origin) {
  return json({ success: false, error: msg }, status, origin);
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin');
   try {
    const url    = new URL(request.url);
    const path   = url.pathname;

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    // Authenticate EVERY request, reads included (was: non-GET only, leaving all
    // GET data endpoints public). Only the health check is left open.
    if (request.method !== 'GET' && !isAuthorized(request, env)) {
      return err('Unauthorized', 401, origin);
    }

    const user = request.headers.get('X-TSI-User') || 'unknown';

    // ── GET /api/pipeline ─────────────────────────────────────
    if (path === '/api/pipeline' && request.method === 'GET') {
      const raw = await env.TSI_DATA.get(KV_PIPELINE);
      if (!raw) return json({ schema_version: 2, records: [] }, 200, origin);
      return new Response(raw, {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) }
      });
    }

    // ── POST /api/pipeline ────────────────────────────────────
    // Body: { records: [...] } or full wrapper
    if (path === '/api/pipeline' && request.method === 'POST') {
      let body;
      try { body = await request.json(); }
      catch { return err('Invalid JSON', 400, origin); }

      const records = Array.isArray(body) ? body : (body.records || body);
      if (!Array.isArray(records)) return err('Expected records array', 400, origin);

      const payload = {
        schema_version: 2,
        saved_at:       new Date().toISOString(),
        saved_by:       user,
        records
      };

      await env.TSI_DATA.put(KV_PIPELINE, JSON.stringify(payload));

      // Log the save
      ctx.waitUntil(appendUsageLog(env, {
        by: user, at: new Date().toISOString(),
        action: 'pipeline_save', detail: `${records.length} records`
      }));

      return json({ success: true, saved: records.length, saved_at: payload.saved_at }, 200, origin);
    }

    // ── PUT /api/pipeline/:id ─────────────────────────────────
    // Update a single record with optimistic concurrency
    const singleMatch = path.match(/^\/api\/pipeline\/([^/]+)$/);
    if (singleMatch && request.method === 'PUT') {
      const id = decodeURIComponent(singleMatch[1]);
      let incoming;
      try { incoming = await request.json(); }
      catch { return err('Invalid JSON', 400, origin); }

      const raw = await env.TSI_DATA.get(KV_PIPELINE);
      const store = raw ? JSON.parse(raw) : { schema_version: 2, records: [] };
      const records = store.records || [];
      const idx = records.findIndex(r => r.id === id);

      if (idx === -1) {
        // New record — append
        records.push({ ...incoming, createdAt: new Date().toISOString(), createdBy: user });
      } else {
        const existing = records[idx];
        // Optimistic concurrency check
        if (incoming.version !== undefined && existing.version !== undefined) {
          if (incoming.version < existing.version) {
            return json({
              success: false,
              conflict: true,
              message: `This record was updated by ${existing.updatedBy || 'someone'} — please refresh`,
              serverVersion: existing.version,
              serverRecord: existing
            }, 409, origin);
          }
        }
        records[idx] = {
          ...existing,
          ...incoming,
          version:   (existing.version || 0) + 1,
          updatedAt: new Date().toISOString(),
          updatedBy: user,
        };
      }

      store.records  = records;
      store.saved_at = new Date().toISOString();
      store.saved_by = user;
      await env.TSI_DATA.put(KV_PIPELINE, JSON.stringify(store));

      ctx.waitUntil(appendUsageLog(env, {
        by: user, at: new Date().toISOString(),
        action: 'record_update', detail: id
      }));

      return json({ success: true, id, version: records[idx]?.version }, 200, origin);
    }

    // ── GET /api/bugs ─────────────────────────────────────────
    if (path === '/api/bugs' && request.method === 'GET') {
      const raw = await env.TSI_DATA.get(KV_BUGS);
      return json(raw ? JSON.parse(raw) : [], 200, origin);
    }

    // ── POST /api/bugs ────────────────────────────────────────
    if (path === '/api/bugs' && request.method === 'POST') {
      let body;
      try { body = await request.json(); }
      catch { return err('Invalid JSON', 400, origin); }

      const bugs = Array.isArray(body) ? body : [body];
      const raw  = await env.TSI_DATA.get(KV_BUGS);
      const existing = raw ? JSON.parse(raw) : [];

      // Merge by bug id
      bugs.forEach(bug => {
        if (!bug.id) bug.id = 'BUG-' + Date.now().toString(36).toUpperCase();
        const idx = existing.findIndex(b => b.id === bug.id);
        if (idx >= 0) existing[idx] = bug;
        else existing.unshift(bug);
      });

      await env.TSI_DATA.put(KV_BUGS, JSON.stringify(existing));
      return json({ success: true, count: existing.length }, 200, origin);
    }

    // ── GET /api/usage ────────────────────────────────────────
    if (path === '/api/usage' && request.method === 'GET') {
      const raw = await env.TSI_DATA.get(KV_USAGE);
      return json(raw ? JSON.parse(raw) : [], 200, origin);
    }

    // ── POST /api/usage ───────────────────────────────────────
    if (path === '/api/usage' && request.method === 'POST') {
      let event;
      try { event = await request.json(); }
      catch { return err('Invalid JSON', 400, origin); }
      ctx.waitUntil(appendUsageLog(env, { ...event, by: user }));
      return json({ success: true }, 200, origin);
    }


    // ── PUT /api/locks/:id — acquire lock ──────────────────────
    const lockAcquire = path.match(/^\/api\/locks\/([^/]+)$/);
    if (lockAcquire && request.method === 'PUT') {
      const id = decodeURIComponent(lockAcquire[1]);
      let body;
      try { body = await request.json(); } catch { body = {}; }

      // Check if already locked by someone else
      const existing = await env.TSI_DATA.get('locks/' + id);
      if (existing) {
        const lock = JSON.parse(existing);
        const ageMs = Date.now() - new Date(lock.since).getTime();
        // Locks expire after 5 minutes
        if (ageMs < 300000 && lock.email !== body.email) {
          return json({
            locked: true,
            lockedBy: lock.name || lock.initials || 'Someone',
            lockedByInitials: lock.initials,
            lockedByEmail: lock.email,
            since: lock.since,
            ageMs
          }, 200, origin);
        }
      }

      // Acquire / refresh lock
      const lockData = {
        id, name: body.name || user, email: body.email || user,
        initials: body.initials || user.slice(0,2).toUpperCase(),
        since: new Date().toISOString()
      };
      // TTL: KV auto-expires lock after 6 minutes (slightly longer than client 5min)
      await env.TSI_DATA.put('locks/' + id, JSON.stringify(lockData), { expirationTtl: 360 });
      return json({ locked: false, acquired: true }, 200, origin);
    }

    // ── DELETE /api/locks/:id — release lock ────────────────────
    const lockRelease = path.match(/^\/api\/locks\/([^/]+)$/);
    if (lockRelease && request.method === 'DELETE') {
      const id = decodeURIComponent(lockRelease[1]);
      await env.TSI_DATA.delete('locks/' + id);
      return json({ released: true }, 200, origin);
    }


    // ── POST /api/ai — proxy to Anthropic ──────────────────────
    // Auth already enforced by the top-level guard (every path except /api/health),
    // so no per-route re-check is needed here — the open-proxy risk is closed.
    if (path === '/api/ai' && request.method === 'POST') {
      let body;
      try { body = await request.json(); }
      catch { return err('Invalid JSON', 400, origin); }

      const anthropicKey = env.ANTHROPIC_API_KEY;
      if (!anthropicKey) return err('AI not configured', 503, origin);

      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type':      'application/json',
          'x-api-key':         anthropicKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model:      aiModelFor(request.headers.get('X-TSI-Email'), body.tier),
          max_tokens: body.max_tokens || 1000,
          system:     body.system     || '',
          messages:   body.messages   || [],
        })
      });

      const data = await res.json();
      return json(data, res.status, origin);
    }

    // ══════════════════════════════════════════════════════════
    //  PRICE BOOK + QUOTES + STORE (D1) — added for the quote builder
    //  and the extensible collection store (bugs, saved views, follows,
    //  preso deck arrangement, …). Backed by env.DB (D1 `tsi-intel`).
    // ══════════════════════════════════════════════════════════

    // Every route below needs the D1 binding. If the Worker was deployed without
    // it (no `DB` binding in wrangler.toml), fail with a clear message rather than
    // a cryptic "Cannot read properties of undefined (reading 'prepare')" 500.
    if (!env.DB && (path.startsWith('/api/prices') || path.startsWith('/api/quotes') || path.startsWith('/api/store'))) {
      return err('D1 not bound: add the `DB` binding (database tsi-intel, id e18ad8cb-ce35-42b2-ba01-8a1d31551398) to wrangler.toml and redeploy', 503, origin);
    }

    // ── GET /api/prices ── full price book (product_prices ⨝ products) ──
    if (path === '/api/prices' && request.method === 'GET') {
      const { results } = await env.DB.prepare(
        `SELECT pp.product_seed_id AS seedId, pp.currency, pp.price, pp.cost,
                p.code, p.name, p.category, p.structure
           FROM product_prices pp
           JOIN products p ON p.seed_id = pp.product_seed_id
          ORDER BY p.category, p.code`
      ).all();
      return json({ success: true, prices: results }, 200, origin);
    }

    // ── PUT /api/prices/:seedId ── upsert one price/cost ──
    const priceMatch = path.match(/^\/api\/prices\/([A-Za-z0-9_-]+)$/);
    if (priceMatch && request.method === 'PUT') {
      let body; try { body = await request.json(); } catch { return err('Invalid JSON', 400, origin); }
      const seedId = priceMatch[1];
      const currency = body.currency || 'USD';
      const price = body.price == null ? null : Number(body.price);
      const cost  = body.cost  == null ? null : Number(body.cost);
      // Guard: seedId must reference a real product.
      const prod = await env.DB.prepare(`SELECT seed_id FROM products WHERE seed_id=?`).bind(seedId).first();
      if (!prod) return err('Unknown product', 404, origin);
      await env.DB.prepare(
        `INSERT OR REPLACE INTO product_prices (product_seed_id, currency, price, cost)
         VALUES (?,?,?,?)`
      ).bind(seedId, currency, price, cost).run();
      return json({ success: true, seedId, currency, price, cost }, 200, origin);
    }

    // ── GET /api/quotes ── list (headers + line counts) ──
    if (path === '/api/quotes' && request.method === 'GET') {
      const { results } = await env.DB.prepare(
        `SELECT q.*, (SELECT COUNT(*) FROM quote_lines l WHERE l.quote_id=q.id) AS n_lines
           FROM quotes q ORDER BY q.created_at DESC`
      ).all();
      return json({ success: true, quotes: results }, 200, origin);
    }

    // ── GET /api/quotes/:id ── header + lines ──
    const quoteMatch = path.match(/^\/api\/quotes\/([A-Za-z0-9_-]+)$/);
    if (quoteMatch && request.method === 'GET') {
      const id = quoteMatch[1];
      const quote = await env.DB.prepare(`SELECT * FROM quotes WHERE id=?`).bind(id).first();
      if (!quote) return err('Quote not found', 404, origin);
      const { results: lines } = await env.DB.prepare(
        `SELECT * FROM quote_lines WHERE quote_id=? ORDER BY line_no`
      ).bind(id).all();
      return json({ success: true, quote, lines }, 200, origin);
    }

    // ── POST /api/quotes  &  PUT /api/quotes/:id ── upsert header + lines ──
    const isQuotePost = (path === '/api/quotes' && request.method === 'POST');
    const isQuotePut  = (quoteMatch && request.method === 'PUT');
    if (isQuotePost || isQuotePut) {
      let body; try { body = await request.json(); } catch { return err('Invalid JSON', 400, origin); }
      const q = body.quote || body;
      const lines = Array.isArray(body.lines) ? body.lines : (Array.isArray(q.lines) ? q.lines : []);
      const id = (isQuotePut ? quoteMatch[1] : q.id);
      if (!id) return err('Missing quote id', 400, origin);
      if (!q.customer_name) return err('customer_name required', 400, origin);
      const now = new Date().toISOString();

      // Recompute rollups server-side (never trust client math).
      let subtotal = 0;
      lines.forEach(l => { subtotal += (Number(l.qty)||0) * (Number(l.unit_price)||0); });
      let disc = (q.discount_mode === 'pct') ? subtotal * ((Number(q.discount)||0)/100) : (Number(q.discount)||0);
      disc = Math.min(Math.max(disc, 0), subtotal);
      const taxable = (subtotal - disc) + (Number(q.freight)||0);
      const total = taxable + taxable * ((Number(q.tax_pct)||0)/100);

      const existing = await env.DB.prepare(`SELECT created_at, created_by, version FROM quotes WHERE id=?`).bind(id).first();
      const createdAt = existing ? existing.created_at : now;
      const createdBy = existing ? existing.created_by : user;
      const version   = existing ? (existing.version || 1) + 1 : 1;

      const upsertQuote = env.DB.prepare(
        `INSERT OR REPLACE INTO quotes
          (id, rev, seq, customer_org_seed_id, customer_name, customer_address,
           contact_name, contact_email, contact_phone, project, description, status, currency,
           quote_date, valid_until, prepared_by, scope, assumptions, payment_terms,
           delivery_terms, notes, terms, discount, discount_mode, freight, tax_pct,
           subtotal, total, version, created_at, created_by, updated_at, updated_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(
        id, q.rev || 'R0', q.seq == null ? null : Number(q.seq),
        q.customer_org_seed_id || null, q.customer_name, q.customer_address || null,
        q.contact_name || null, q.contact_email || null, q.contact_phone || null,
        q.project || null, q.description || null, q.status || 'Draft', q.currency || 'USD',
        q.quote_date || null, q.valid_until || null, q.prepared_by || null,
        q.scope || null, q.assumptions || null, q.payment_terms || null,
        q.delivery_terms || null, q.notes || null, q.terms || null,
        Number(q.discount)||0, q.discount_mode || 'pct', Number(q.freight)||0, Number(q.tax_pct)||0,
        subtotal, total, version, createdAt, createdBy, now, user
      );

      const stmts = [ upsertQuote, env.DB.prepare(`DELETE FROM quote_lines WHERE quote_id=?`).bind(id) ];
      lines.forEach((l, i) => {
        const qty = Number(l.qty)||0, up = Number(l.unit_price)||0;
        stmts.push(env.DB.prepare(
          `INSERT INTO quote_lines (id, quote_id, line_no, product_seed_id, code, description, qty, unit, unit_price, line_total)
           VALUES (?,?,?,?,?,?,?,?,?,?)`
        ).bind(
          l.id || (id + '-L' + (i+1)), id, i+1,
          l.product_seed_id || null, l.code || null, l.description || '',
          qty, l.unit || 'ea', up, qty*up
        ));
      });
      await env.DB.batch(stmts);
      return json({ success: true, id, subtotal, total, version }, 200, origin);
    }

    // ── DELETE /api/quotes/:id ──
    if (quoteMatch && request.method === 'DELETE') {
      const id = quoteMatch[1];
      await env.DB.batch([
        env.DB.prepare(`DELETE FROM quote_lines WHERE quote_id=?`).bind(id),
        env.DB.prepare(`DELETE FROM quotes WHERE id=?`).bind(id),
      ]);
      return json({ success: true, id }, 200, origin);
    }

    // ══════════════════════════════════════════════════════════
    //  GENERIC COLLECTION STORE (D1) — extensible entity storage.
    //  One row per object in `collections(collection,id,data JSON)`.
    //  Backs the app's Store(collection) client (bugs, saved views,
    //  follows, prefs, …) so features persist without a bespoke table.
    // ══════════════════════════════════════════════════════════
    const collMatch = path.match(/^\/api\/store\/([A-Za-z0-9_-]+)$/);
    const collItemMatch = path.match(/^\/api\/store\/([A-Za-z0-9_-]+)\/(.+)$/);

    // GET /api/store/:collection — list all objects in the collection
    if (collMatch && request.method === 'GET') {
      const { results } = await env.DB.prepare(
        `SELECT data FROM collections WHERE collection=? ORDER BY updated_at DESC`
      ).bind(collMatch[1]).all();
      const items = results.map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);
      return json({ success: true, items }, 200, origin);
    }

    // POST /api/store/:collection — bulk replace the whole collection
    // Body: { items: [ {id, ...}, ... ] }
    if (collMatch && request.method === 'POST') {
      let body; try { body = await request.json(); } catch { return err('Invalid JSON', 400, origin); }
      const coll = collMatch[1];
      const items = Array.isArray(body.items) ? body.items : [];
      const now = new Date().toISOString();
      const stmts = [ env.DB.prepare(`DELETE FROM collections WHERE collection=?`).bind(coll) ];
      for (const it of items) {
        if (it == null || it.id == null) continue;
        stmts.push(env.DB.prepare(
          `INSERT OR REPLACE INTO collections (collection, id, data, updated_at, updated_by) VALUES (?,?,?,?,?)`
        ).bind(coll, String(it.id), JSON.stringify(it), now, user));
      }
      await env.DB.batch(stmts);
      return json({ success: true, count: stmts.length - 1 }, 200, origin);
    }

    // PUT /api/store/:collection/:id — upsert one object
    if (collItemMatch && request.method === 'PUT') {
      let body; try { body = await request.json(); } catch { return err('Invalid JSON', 400, origin); }
      const [, coll, id] = collItemMatch;
      const obj = { ...body, id };
      await env.DB.prepare(
        `INSERT OR REPLACE INTO collections (collection, id, data, updated_at, updated_by) VALUES (?,?,?,?,?)`
      ).bind(coll, id, JSON.stringify(obj), new Date().toISOString(), user).run();
      return json({ success: true, id }, 200, origin);
    }

    // DELETE /api/store/:collection/:id
    if (collItemMatch && request.method === 'DELETE') {
      const [, coll, id] = collItemMatch;
      await env.DB.prepare(`DELETE FROM collections WHERE collection=? AND id=?`).bind(coll, id).run();
      return json({ success: true, id }, 200, origin);
    }

    // ── POST /api/shipping/rates ── parcel rate shopping via EasyPost ──
    // Proxies to EasyPost so the API key never reaches the browser. Returns
    // 501 (not 500) when unconfigured so the client falls back to manual entry.
    if (path === '/api/shipping/rates' && request.method === 'POST') {
      const key = env.SHIPPING_API_KEY || env.EASYPOST_API_KEY;
      if (!key) return json({ error: 'Shipping not configured (set SHIPPING_API_KEY).' }, 501, origin);
      let body; try { body = await request.json(); } catch { return err('Invalid JSON', 400, origin); }
      const from = body.from || {}, to = body.to || {}, dims = body.dims || {};
      const oz = Number(body.weight_oz) || 0;
      if (!from.zip || !to.zip || !oz) return json({ error: 'from.zip, to.zip and weight_oz are required' }, 400, origin);
      const parcel = { weight: oz };
      if (dims.l && dims.w && dims.h) { parcel.length = Number(dims.l); parcel.width = Number(dims.w); parcel.height = Number(dims.h); }
      const shipment = {
        to_address:   { zip: String(to.zip),   country: (to.country || 'US') },
        from_address: { zip: String(from.zip), country: (from.country || 'US') },
        parcel,
      };
      try {
        const ep = await fetch('https://api.easypost.com/v2/shipments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Basic ' + btoa(key + ':') },
          body: JSON.stringify({ shipment }),
        });
        const data = await ep.json();
        if (!ep.ok) return json({ error: (data && data.error && data.error.message) || ('EasyPost HTTP ' + ep.status) }, 502, origin);
        const rates = (data.rates || []).map(r => ({
          carrier: r.carrier, service: r.service, rate: Number(r.rate), currency: r.currency || 'USD',
          days: (r.delivery_days != null ? r.delivery_days : (r.est_delivery_days != null ? r.est_delivery_days : null)),
        }));
        return json({ rates }, 200, origin);
      } catch (e) {
        return json({ error: 'Shipping upstream error: ' + ((e && e.message) || e) }, 502, origin);
      }
    }

    // ── GET /api/health ───────────────────────────────────────
    if (path === '/api/health') {
      return json({ status: 'ok', ts: new Date().toISOString() }, 200, origin);
    }

    return err('Not found', 404, origin);
   } catch (e) {
    // Any unhandled exception would otherwise return a CORS-less 500, which the
    // browser reports only as an opaque "Failed to fetch". Return the real error
    // WITH CORS headers so the client can surface it.
    return err('Server error: ' + (e && e.message ? e.message : String(e)), 500, origin);
   }
  }
};

async function appendUsageLog(env, event) {
  try {
    const raw = await env.TSI_DATA.get(KV_USAGE);
    const log = raw ? JSON.parse(raw) : [];
    log.unshift(event);
    if (log.length > 1000) log.splice(1000);
    await env.TSI_DATA.put(KV_USAGE, JSON.stringify(log));
  } catch {}
}
