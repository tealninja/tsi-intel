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

// ⚠️ DEPLOY PREREQUISITES (this Worker now fails closed):
//   1. `wrangler secret put TSI_API_KEY` — without it EVERY request is 401.
//   2. The client must send `X-TSI-Key` on every call (the HTML currently does
//      not — update workerHeaders() to attach it, or the app will 401).
//   3. Set ALLOWED_ORIGINS below to the app's real origin(s) for cross-origin use.
// A shared key in client code is soft auth (stops casual discovery/scrapers);
// for real protection put the Worker behind Cloudflare Access (see TODO §5).

// Auth: shared secret in header X-TSI-Key. Fail closed — no key configured = no access.
function isAuthorized(request, env) {
  if (!env.TSI_API_KEY) return false;            // fail closed (was: allow-all dev mode)
  const key = request.headers.get('X-TSI-Key');
  return key === env.TSI_API_KEY;
}

// CORS allowlist — '*' is intentionally NOT used (it would let any site read the API).
//
// ⚠️ CUTOVER-BLOCKING: the app is served from SharePoint, so its calls to this
//    Worker are CROSS-ORIGIN. This list MUST contain the app's exact SharePoint
//    origin (scheme + host, no path), of the form:
//        'https://<tenant>.sharepoint.com'   (use the REAL tenant, not this literal)
//    If this list is empty (or missing the real origin) the browser blocks the
//    app from reading responses EVEN WITH a valid key — the app goes blank.
//    The live Worker currently returns '*', which is why it works today; locking
//    CORS is the one behavior change here beyond adding the key, so verify the
//    exact origin on the staging Worker before going live (see docs/CUTOVER.md).
//    (Confirm the tenant host from the app's address bar in SharePoint.)
const ALLOWED_ORIGINS = [
  // 'https://<your-tenant>.sharepoint.com',   // ← set to the real origin at cutover
];
function corsHeaders(origin) {
  const allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : (ALLOWED_ORIGINS[0] || '');
  const h = {
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-TSI-Key, X-TSI-User',
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
    const url    = new URL(request.url);
    const path   = url.pathname;

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    // Authenticate EVERY request, reads included (was: non-GET only, leaving all
    // GET data endpoints public). Only the health check is left open.
    if (path !== '/api/health' && !isAuthorized(request, env)) {
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
          model:      body.model      || 'claude-sonnet-4-6',
          max_tokens: body.max_tokens || 1000,
          system:     body.system     || '',
          messages:   body.messages   || [],
        })
      });

      const data = await res.json();
      return json(data, res.status, origin);
    }

    // ── GET /api/health ───────────────────────────────────────
    if (path === '/api/health') {
      return json({ status: 'ok', ts: new Date().toISOString() }, 200, origin);
    }

    return err('Not found', 404, origin);
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
