// TSI Contracts — remote MCP server (Cloudflare Worker).
//
// A separate connector for the contract builder (tsiprojects.bodhistoys.com/contractbuilder/).
// It does NOT touch the TSI Intel CRM connector (tsi-intel-mcp). Every tool calls the contract
// builder API on tsiprojects.bodhistoys.com with a service token, so the page, the database and
// this connector always agree.
//
// Transport: MCP over HTTP (JSON-RPC 2.0 by POST to / or /mcp).
// Auth: OAuth 2.0 authorization code with PKCE and a static client id and secret, the same
// pattern the TSI Intel connector uses (enter the id and secret under "Advanced settings" when
// adding the custom connector in claude.ai).
//
// Bindings and settings (see wrangler.jsonc and README.md):
//   KV                  OAuth codes and tokens
//   OAUTH_CLIENT_ID     var, default "tsi-contracts"
//   OAUTH_CLIENT_SECRET secret
//   TSI_PROJECTS_TOKEN  secret, equal to CONTRACT_API_TOKEN on the tsi-projects Worker
//   TSI_PROJECTS_URL    var, default https://tsiprojects.bodhistoys.com

const VERSION = '1.0.0';
const TOKEN_TTL = 60 * 60 * 24 * 30;
const CODE_TTL = 300;
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Mcp-Session-Id, MCP-Protocol-Version',
  'Access-Control-Expose-Headers': 'WWW-Authenticate, Mcp-Session-Id',
};

const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...CORS, ...extra } });
const html = (body, status = 200) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...CORS } });
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function randomToken(bytes = 32) {
  const a = new Uint8Array(bytes); crypto.getRandomValues(a);
  return Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
}
function b64url(buf) {
  let s = ''; for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function sha256b64url(text) { return b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))); }
function safeEqual(a, b) {
  a = String(a ?? ''); b = String(b ?? '');
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/* ── OAuth ──────────────────────────────────────────────────── */

function redirectAllowed(uri) {
  try {
    const u = new URL(uri);
    if (u.protocol === 'https:' && (u.hostname === 'claude.ai' || u.hostname === 'claude.com' || u.hostname.endsWith('.claude.ai') || u.hostname.endsWith('.claude.com'))) return true;
    if ((u.hostname === 'localhost' || u.hostname === '127.0.0.1') && u.protocol === 'http:') return true; // local testing only
  } catch { /* not a URL */ }
  return false;
}

function metadata(origin) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: ['contracts'],
  };
}

function authorizePage({ code, redirectHost }) {
  return html(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TSI Contracts: authorize</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#FAF8F4;font:14px/1.5 Inter,system-ui,sans-serif;color:#404040}
.card{background:#fff;border:0.5px solid rgba(64,64,64,.25);border-radius:8px;padding:32px;max-width:420px;width:calc(100% - 32px)}
h1{font:400 24px/1.2 'DM Serif Display',Georgia,serif;color:#19446C;margin:0 0 8px}p{margin:0 0 24px;color:#646464}
button{background:#19446C;color:#fff;border:0;border-radius:6px;padding:12px 24px;font:500 15px Inter,system-ui,sans-serif;cursor:pointer;width:100%}button:hover{opacity:.92}
.muted{font-size:12px;margin:16px 0 0}</style></head><body><div class="card"><h1>TSI Contracts</h1>
<p>Claude is asking to read and update contract deal sheets, scenarios and reviews on tsiprojects.bodhistoys.com.</p>
<form method="POST" action="/oauth/approve"><input type="hidden" name="code" value="${esc(code)}"><button type="submit">Allow access</button></form>
<p class="muted">You will return to ${esc(redirectHost)}. Only continue if you started this from your own Claude settings.</p></div></body></html>`);
}

async function handleAuthorize(url, env) {
  const clientId = url.searchParams.get('client_id') || '';
  const redirectUri = url.searchParams.get('redirect_uri') || '';
  const state = url.searchParams.get('state') || '';
  const challenge = url.searchParams.get('code_challenge') || '';
  const method = url.searchParams.get('code_challenge_method') || (challenge ? 'plain' : '');
  if (!safeEqual(clientId, env.OAUTH_CLIENT_ID || 'tsi-contracts')) return json({ error: 'invalid_client' }, 400);
  if (url.searchParams.get('response_type') !== 'code') return json({ error: 'unsupported_response_type' }, 400);
  if (!redirectAllowed(redirectUri)) return json({ error: 'invalid_redirect_uri' }, 400);
  if (challenge && method !== 'S256') return json({ error: 'invalid_request', error_description: 'Only S256 code challenges are supported' }, 400);
  const code = randomToken(24);
  await env.KV.put(`code:${code}`, JSON.stringify({ redirectUri, state, challenge, clientId }), { expirationTtl: CODE_TTL });
  return authorizePage({ code, redirectHost: new URL(redirectUri).host });
}

async function handleApprove(request, env) {
  const form = await request.formData();
  const code = String(form.get('code') || '');
  const raw = await env.KV.get(`code:${code}`);
  if (!raw) return html('<p>This authorization request expired. Start again from Claude.</p>', 400);
  const { redirectUri, state } = JSON.parse(raw);
  const to = new URL(redirectUri);
  to.searchParams.set('code', code);
  if (state) to.searchParams.set('state', state);
  return new Response(null, { status: 302, headers: { Location: to.toString(), 'Cache-Control': 'no-store' } });
}

async function handleToken(request, env) {
  let params;
  const ct = request.headers.get('content-type') || '';
  if (ct.includes('application/json')) params = new URLSearchParams(await request.json().catch(() => ({})));
  else params = new URLSearchParams(await request.text());
  let clientId = params.get('client_id'), clientSecret = params.get('client_secret');
  const basic = request.headers.get('Authorization') || '';
  if (basic.startsWith('Basic ')) {
    try { const [id, ...rest] = atob(basic.slice(6)).split(':'); clientId = clientId || decodeURIComponent(id); clientSecret = clientSecret || decodeURIComponent(rest.join(':')); } catch { /* ignore */ }
  }
  if (!safeEqual(clientId, env.OAUTH_CLIENT_ID || 'tsi-contracts') || !env.OAUTH_CLIENT_SECRET || !safeEqual(clientSecret, env.OAUTH_CLIENT_SECRET)) return json({ error: 'invalid_client' }, 401);
  if (params.get('grant_type') !== 'authorization_code') return json({ error: 'unsupported_grant_type' }, 400);
  const code = params.get('code') || '';
  const raw = code ? await env.KV.get(`code:${code}`) : null;
  if (!raw) return json({ error: 'invalid_grant' }, 400);
  await env.KV.delete(`code:${code}`); // one use
  const rec = JSON.parse(raw);
  if (rec.challenge) {
    const verifier = params.get('code_verifier') || '';
    if (!verifier || !safeEqual(await sha256b64url(verifier), rec.challenge)) return json({ error: 'invalid_grant', error_description: 'PKCE verification failed' }, 400);
  }
  if (params.get('redirect_uri') && params.get('redirect_uri') !== rec.redirectUri) return json({ error: 'invalid_grant', error_description: 'redirect_uri mismatch' }, 400);
  const token = randomToken(32);
  await env.KV.put(`token:${token}`, '1', { expirationTtl: TOKEN_TTL });
  return json({ access_token: token, token_type: 'Bearer', expires_in: TOKEN_TTL, scope: 'contracts' }, 200, { 'Cache-Control': 'no-store' });
}

async function tokenValid(request, env) {
  const h = request.headers.get('Authorization') || '';
  const t = h.replace(/^Bearer\s+/i, '').trim();
  return !!t && (await env.KV.get(`token:${t}`)) === '1';
}

/* ── Contract builder API client ───────────────────────────── */

async function api(env, path, init) {
  if (!env.TSI_PROJECTS_TOKEN) throw new Error('TSI_PROJECTS_TOKEN secret is not set on this Worker');
  const base = (env.TSI_PROJECTS_URL || 'https://tsiprojects.bodhistoys.com').replace(/\/$/, '');
  const r = await fetch(base + '/api/contractbuilder' + path, {
    ...init,
    headers: { Authorization: 'Bearer ' + env.TSI_PROJECTS_TOKEN, 'Content-Type': 'application/json', 'User-Agent': 'tsi-contracts-mcp', ...(init && init.headers || {}) },
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${text.slice(0, 300)}`);
  try { return JSON.parse(text); } catch { return text; }
}
const enc = encodeURIComponent;
const put = (env, path, body) => api(env, path, { method: 'PUT', body: JSON.stringify(body) });
const post = (env, path, body) => api(env, path, { method: 'POST', body: JSON.stringify(body) });
const newId = () => Math.random().toString(36).slice(2, 10);

/* ── Tools ──────────────────────────────────────────────────── */

const S = (description) => ({ type: 'string', description });
const POSTURE = { type: 'string', enum: ['seller', 'balanced', 'buyer'] };
const DEPTH = { type: 'string', enum: ['light', 'standard', 'full'] };
const PACK = { type: 'string', enum: ['exhibits', 'integrated'] };
const obj = (properties, required = []) => ({ type: 'object', properties, required });

export const TOOLS = [
  { name: 'contract_list_deals', description: 'List the deal sheets in the TSI contract builder: id, name, buyer, posture, depth, packaging, last update and saved version count.', inputSchema: obj({}),
    run: (env) => api(env, '/deals') },
  { name: 'contract_get_deal', description: 'Return one deal sheet in full: levers (posture, depth, packaging), every value that has been set, per-clause posture overrides, concession log, custom and added clauses.', inputSchema: obj({ deal_id: S('Deal id from contract_list_deals') }, ['deal_id']),
    run: (env, a) => api(env, `/deals/${enc(a.deal_id)}`) },
  { name: 'contract_create_deal', description: 'Create a new deal sheet with defaults (balanced, standard, exhibits) and return its id. Set values afterwards with contract_update_deal.', inputSchema: obj({ name: S('Project or deal name'), buyer_name: S('Buyer legal name'), posture: POSTURE, depth: DEPTH, packaging: PACK }, ['name']),
    run: async (env, a) => {
      const id = newId(), now = new Date().toISOString();
      const deal = { id, name: a.name, buyer_name: a.buyer_name || '', seller_name: 'Teal Sales Incorporated dba TSI', posture: a.posture || 'balanced', depth: a.depth || 'standard', packaging: a.packaging || 'exhibits', values: {}, overrides: {}, concessions: [], notes: '', createdAt: now, updatedAt: now };
      await put(env, `/deals/${id}`, deal); return { ok: true, deal_id: id };
    } },
  { name: 'contract_update_deal', description: 'Change a deal sheet. Only the fields given are changed: levers, values (null clears one), per-clause posture overrides (null removes one), or a concession-log entry. Value names are the variable names shown in contract_get_deal and the builder.', inputSchema: obj({
      deal_id: S('Deal id'), name: S('Deal name'), buyer_name: S('Buyer legal name'), posture: POSTURE, depth: DEPTH, packaging: PACK,
      values: { type: 'object', description: 'Variable name to value; null clears the value', additionalProperties: true },
      overrides: { type: 'object', description: 'Section id to posture (seller, balanced or buyer); null removes the override', additionalProperties: true },
      concession: obj({ section: S('Section id'), title: S('Clause title'), from: S('Posture it moved from'), to: S('Posture it moved to'), reason: S('Why') }, ['section', 'from', 'to', 'reason']),
    }, ['deal_id']),
    run: async (env, a) => {
      const deal = await api(env, `/deals/${enc(a.deal_id)}`);
      for (const k of ['name', 'buyer_name', 'posture', 'depth', 'packaging']) if (a[k] !== undefined) deal[k] = a[k];
      deal.values = deal.values || {}; deal.overrides = deal.overrides || {}; deal.concessions = deal.concessions || [];
      for (const [k, v] of Object.entries(a.values || {})) { if (v === null) delete deal.values[k]; else deal.values[k] = v; }
      for (const [k, v] of Object.entries(a.overrides || {})) { if (v === null) delete deal.overrides[k]; else deal.overrides[k] = v; }
      if (a.concession) deal.concessions.push({ ...a.concession, at: new Date().toISOString() });
      deal.updatedAt = new Date().toISOString();
      await put(env, `/deals/${enc(a.deal_id)}`, deal);
      return { ok: true, deal_id: a.deal_id, posture: deal.posture, depth: deal.depth, packaging: deal.packaging, values_set: Object.keys(deal.values).length };
    } },
  { name: 'contract_render', description: 'Render a deal as contract text: clean view (what the buyer sees) or working view (with rationale and drafting notes). Returns the text with counts of blanks, reserved sections and dangling references, plus consistency notes.', inputSchema: obj({ deal_id: S('Deal id'), view: { type: 'string', enum: ['clean', 'working'] } }, ['deal_id']),
    run: async (env, a) => {
      const r = await api(env, `/deals/${enc(a.deal_id)}/render?view=${a.view || 'clean'}`);
      return `Deal ${r.name || r.id}: ${r.posture} / ${r.depth} / ${r.packaging}\nIssues: ${JSON.stringify(r.issues)}\nConsistency notes: ${JSON.stringify((r.consistency || []).map(c => c.message))}\n\n${r.text}`;
    } },
  { name: 'contract_review_pack', description: 'Everything needed for a sensibility review of one deal in one call: the review checklist, the levers, issue counts and rule-based consistency notes, custom clauses, the saved scenarios and the full clean contract text. Follow the checklist: findings first with section references; walk each scenario through the text and record it with contract_record_run; record the overall result with contract_record_review. Say plainly what depends on foreign law and should go to counsel; do not assert foreign law.', inputSchema: obj({ deal_id: S('Deal id'), include_text: { type: 'boolean', description: 'Default true. False reviews only the notes and scenarios.' } }, ['deal_id']),
    run: async (env, a) => {
      const id = enc(a.deal_id);
      const [brief, render, scen] = await Promise.all([api(env, '/review-brief'), api(env, `/deals/${id}/render?view=clean`), api(env, '/scenarios')]);
      const head = { deal: { id: render.id, name: render.name, posture: render.posture, depth: render.depth, packaging: render.packaging }, issues: render.issues, consistency_notes: render.consistency, custom_clauses: render.custom_clauses,
        scenarios: (scen.scenarios || []).map(s => ({ id: s.id, title: s.title, condensed: s.condensed, expectation: s.expectation })) };
      return `=== REVIEW CHECKLIST ===\n${brief.brief}\n\n=== DEAL AND FINDINGS SO FAR ===\n${JSON.stringify(head, null, 2)}${a.include_text === false ? '' : `\n\n=== CONTRACT TEXT (clean view) ===\n${render.text}`}`;
    } },
  { name: 'contract_record_review', description: 'Record the OVERALL result of a review of a deal: verdict (ready, needs_work or not_ready), a one-line summary and the full report in markdown (findings first with section references, then what was checked and found clean, then questions for counsel). It appears in the builder under the deal\'s Review tab.', inputSchema: obj({ deal_id: S('Deal id'), verdict: { type: 'string', enum: ['ready', 'needs_work', 'not_ready'] }, summary: S('One line'), report: S('Full report, markdown'), version_id: { type: 'number', description: 'Saved version reviewed, if any' } }, ['deal_id', 'verdict', 'summary', 'report']),
    run: (env, a) => post(env, `/deals/${enc(a.deal_id)}/reviews`, { ...a, source: 'connector' }) },
  { name: 'contract_list_reviews', description: 'List the overall review results recorded for a deal, newest first.', inputSchema: obj({ deal_id: S('Deal id') }, ['deal_id']),
    run: (env, a) => api(env, `/deals/${enc(a.deal_id)}/reviews`) },
  { name: 'contract_list_scenarios', description: 'List the saved test scenarios: real situations as told and as condensed, with what TSI expects the contract to do.', inputSchema: obj({}),
    run: (env) => api(env, '/scenarios') },
  { name: 'contract_save_scenario', description: 'Create or update a test scenario. Keep the situation as John told it; the condensed statement is the concise version agreed with him; expectation is what TSI expects the contract to do.', inputSchema: obj({ scenario_id: S('Omit to create'), title: S('Short name'), situation: S('As told'), condensed: S('Concise statement'), expectation: S('What the contract should do'), tags: S('Comma-separated'), source: S('Project or year') }, ['title', 'situation', 'condensed']),
    run: async (env, a) => { const id = a.scenario_id || newId(); await put(env, `/scenarios/${enc(id)}`, a); return { ok: true, scenario_id: id }; } },
  { name: 'contract_record_run', description: 'Record the outcome of walking one scenario through a deal: the clauses that apply in order, what each party owes and whether TSI would accept the outcome at this posture. Verdict is acceptable, gap, ambiguous, not_balanced or not_computable.', inputSchema: obj({ deal_id: S('Deal id'), scenario_id: S('Scenario id'), verdict: { type: 'string', enum: ['acceptable', 'gap', 'ambiguous', 'not_balanced', 'not_computable'] }, report: S('The walk-through'), version_id: { type: 'number' } }, ['deal_id', 'scenario_id', 'verdict', 'report']),
    run: (env, a) => post(env, `/deals/${enc(a.deal_id)}/runs`, a) },
  { name: 'contract_list_runs', description: 'List the scenario walk-throughs recorded for a deal, newest first.', inputSchema: obj({ deal_id: S('Deal id') }, ['deal_id']),
    run: (env, a) => api(env, `/deals/${enc(a.deal_id)}/runs`) },
  { name: 'contract_save_version', description: 'Freeze the current deal sheet and its clean document as a labelled version, for example before sending to the buyer.', inputSchema: obj({ deal_id: S('Deal id'), label: S('For example: Sent to buyer 2026-11-12') }, ['deal_id', 'label']),
    run: async (env, a) => {
      const html = await api(env, `/deals/${enc(a.deal_id)}/render?view=clean&format=html`);
      return post(env, `/deals/${enc(a.deal_id)}/versions`, { label: a.label, html: typeof html === 'string' ? html : '' });
    } },
];

/* ── MCP over JSON-RPC ──────────────────────────────────────── */

const rpcOk = (id, result) => ({ jsonrpc: '2.0', id, result });
const rpcErr = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

export async function handleRpc(msg, env) {
  const { id, method, params } = msg || {};
  if (id === undefined || id === null) return null; // notification: no response
  switch (method) {
    case 'initialize':
      return rpcOk(id, { protocolVersion: (params && params.protocolVersion) || '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'tsi-contracts-mcp', version: VERSION } });
    case 'ping': return rpcOk(id, {});
    case 'tools/list':
      return rpcOk(id, { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    case 'tools/call': {
      const tool = TOOLS.find(t => t.name === (params && params.name));
      if (!tool) return rpcErr(id, -32602, `Unknown tool: ${params && params.name}`);
      try {
        const out = await tool.run(env, (params && params.arguments) || {});
        return rpcOk(id, { content: [{ type: 'text', text: typeof out === 'string' ? out : JSON.stringify(out, null, 2) }] });
      } catch (e) {
        return rpcOk(id, { content: [{ type: 'text', text: 'Error: ' + (e && e.message || e) }], isError: true });
      }
    }
    default: return rpcErr(id, -32601, `Method not found: ${method}`);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = url.origin;
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (url.pathname === '/health') return json({ status: 'ok', service: 'tsi-contracts-mcp', version: VERSION, tools: TOOLS.length });
    if (url.pathname === '/.well-known/oauth-authorization-server') return json(metadata(origin));
    if (url.pathname === '/.well-known/oauth-protected-resource' || url.pathname === '/.well-known/oauth-protected-resource/mcp')
      return json({ resource: origin, authorization_servers: [origin], bearer_methods_supported: ['header'] });
    if (url.pathname === '/oauth/authorize' && request.method === 'GET') return handleAuthorize(url, env);
    if (url.pathname === '/oauth/approve' && request.method === 'POST') return handleApprove(request, env);
    if (url.pathname === '/oauth/token' && request.method === 'POST') return handleToken(request, env);

    if (url.pathname === '/' || url.pathname === '/mcp') {
      if (!(await tokenValid(request, env)))
        return json({ error: 'unauthorized' }, 401, { 'WWW-Authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"` });
      if (request.method === 'POST') {
        let body; try { body = await request.json(); } catch { return json(rpcErr(null, -32700, 'Parse error'), 400); }
        if (Array.isArray(body)) {
          const out = (await Promise.all(body.map(m => handleRpc(m, env)))).filter(Boolean);
          return out.length ? json(out) : new Response(null, { status: 202, headers: CORS });
        }
        const res = await handleRpc(body, env);
        return res ? json(res) : new Response(null, { status: 202, headers: CORS });
      }
      return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST', ...CORS } });
    }
    return new Response(`TSI Contracts MCP server v${VERSION}`, { headers: { 'Content-Type': 'text/plain', ...CORS } });
  },
};
