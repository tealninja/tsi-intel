// Offline test: drives the Worker's fetch handler with a fake KV and a fake contract builder API.
import worker, { TOOLS } from '../src/index.js';

let failed = 0;
const ok = (cond, label, extra = '') => { console.log((cond ? 'PASS ' : 'FAIL ') + label + (cond ? '' : ' ' + extra)); if (!cond) failed++; };

const kvStore = new Map();
const KV = { async get(k) { const v = kvStore.get(k); return v === undefined ? null : v.value; }, async put(k, value) { kvStore.set(k, { value }); }, async delete(k) { kvStore.delete(k); } };
const env = { KV, OAUTH_CLIENT_ID: 'tsi-contracts', OAUTH_CLIENT_SECRET: 'sekret', TSI_PROJECTS_TOKEN: 'svc-token', TSI_PROJECTS_URL: 'https://projects.example' };

/* fake contract builder API */
const deals = { d1: { id: 'd1', name: 'VN deal', buyer_name: 'Buyer', posture: 'balanced', depth: 'light', packaging: 'integrated', values: { governing_law: 'singapore' }, overrides: {}, concessions: [] } };
const seen = [];
globalThis.fetch = async (u, init = {}) => {
  const url = new URL(u); seen.push({ path: url.pathname + url.search, method: init.method || 'GET', auth: init.headers && init.headers.Authorization });
  const j = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json' } });
  if ((init.headers || {}).Authorization !== 'Bearer svc-token') return j({ error: 'Sign in required' }, 401);
  const p = url.pathname.replace('/api/contractbuilder', '');
  if (p === '/deals') return j({ deals: Object.values(deals) });
  let m;
  if ((m = p.match(/^\/deals\/([^/]+)$/))) { if (init.method === 'PUT') { deals[m[1]] = JSON.parse(init.body); return j({ ok: true }); } return deals[m[1]] ? j(deals[m[1]]) : j({ error: 'Not found' }, 404); }
  if ((m = p.match(/^\/deals\/([^/]+)\/render$/))) return j({ id: m[1], name: deals[m[1]].name, posture: 'balanced', depth: 'light', packaging: 'integrated', issues: { missing: 3 }, consistency: [{ message: 'note' }], custom_clauses: [], text: 'CONTRACT TEXT HERE' });
  if (p === '/review-brief') return j({ brief: 'CHECKLIST HERE' });
  if (p === '/scenarios') return j({ scenarios: [{ id: 's1', title: 'Late', condensed: 'Late delivery', expectation: 'x' }] });
  if ((m = p.match(/^\/deals\/([^/]+)\/(reviews|runs)$/)) && init.method === 'POST') return j({ ok: true, echo: JSON.parse(init.body) });
  return j({ error: 'unexpected ' + p }, 404);
};

const call = (path, init) => worker.fetch(new Request('https://mcp.example' + path, init), env);
const rpc = (token, method, params, id = 1) => call('/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) });

/* discovery and the unauthenticated challenge */
let r = await call('/health'); ok((await r.json()).tools === TOOLS.length, 'health lists the tools');
r = await call('/.well-known/oauth-authorization-server'); const md = await r.json(); ok(md.code_challenge_methods_supported[0] === 'S256' && md.token_endpoint.endsWith('/oauth/token'), 'authorization server metadata');
r = await call('/.well-known/oauth-protected-resource'); ok((await r.json()).authorization_servers[0] === 'https://mcp.example', 'protected resource metadata');
r = await call('/mcp', { method: 'POST', body: '{}' }); ok(r.status === 401 && /resource_metadata/.test(r.headers.get('WWW-Authenticate')), 'no token gets a 401 with the OAuth challenge');

/* authorize: bad client, bad redirect, bad challenge method */
const base = 'https://claude.ai/api/mcp/auth_callback';
const verifier = 'v'.repeat(48);
const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const challenge = b64(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
const q = (o) => '/oauth/authorize?' + new URLSearchParams({ response_type: 'code', client_id: 'tsi-contracts', redirect_uri: base, state: 'abc', code_challenge: challenge, code_challenge_method: 'S256', ...o });
ok((await call(q({ client_id: 'nope' }))).status === 400, 'authorize rejects an unknown client id');
ok((await call(q({ redirect_uri: 'https://evil.example/cb' }))).status === 400, 'authorize rejects a redirect outside claude.ai');
ok((await call(q({ code_challenge_method: 'plain' }))).status === 400, 'authorize rejects a plain PKCE challenge');

/* full flow */
r = await call(q({})); const page = await r.text(); ok(r.status === 200 && /Allow access/.test(page), 'authorize shows the approval page');
const code = page.match(/name="code" value="([^"]+)"/)[1];
r = await call('/oauth/approve', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'code=' + code, redirect: 'manual' });
const loc = new URL(r.headers.get('Location')); ok(r.status === 302 && loc.origin + loc.pathname === base && loc.searchParams.get('code') === code && loc.searchParams.get('state') === 'abc', 'approve redirects to the stored claude.ai callback with code and state');
const tokenBody = (o) => new URLSearchParams({ grant_type: 'authorization_code', code, client_id: 'tsi-contracts', client_secret: 'sekret', code_verifier: verifier, redirect_uri: base, ...o }).toString();
const tok = (body) => call('/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
ok((await tok(tokenBody({ client_secret: 'wrong' }))).status === 401, 'token rejects a wrong client secret');
ok((await tok(tokenBody({ code_verifier: 'x'.repeat(48) }))).status === 400, 'token rejects a wrong PKCE verifier (and burns the code)');
ok((await tok(tokenBody({}))).status === 400, 'a code cannot be reused');
r = await call(q({})); const code2 = (await r.text()).match(/name="code" value="([^"]+)"/)[1];
await call('/oauth/approve', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'code=' + code2, redirect: 'manual' });
r = await tok(tokenBody({ code: code2 })); const tj = await r.json(); ok(r.status === 200 && tj.token_type === 'Bearer' && tj.access_token.length === 64, 'token exchange succeeds with the right secret and verifier');
const token = tj.access_token;
r = await call('/mcp', { method: 'POST', headers: { Authorization: 'Bearer wrongtoken' }, body: '{}' }); ok(r.status === 401, 'a made-up access token is refused');

/* MCP */
r = await rpc(token, 'initialize', { protocolVersion: '2025-03-26' }); let j = await r.json(); ok(j.result.serverInfo.name === 'tsi-contracts-mcp' && j.result.capabilities.tools, 'initialize');
r = await call('/mcp', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) }); ok(r.status === 202, 'notifications get a 202 and no body');
r = await rpc(token, 'tools/list'); j = await r.json(); ok(j.result.tools.length === 13 && j.result.tools.every(t => t.inputSchema && t.description), 'tools/list returns 13 tools with schemas');
const names = j.result.tools.map(t => t.name);
for (const n of ['contract_list_deals', 'contract_get_deal', 'contract_update_deal', 'contract_render', 'contract_review_pack', 'contract_record_review', 'contract_record_run', 'contract_save_scenario', 'contract_save_version']) ok(names.includes(n), 'tool present: ' + n);
const text = async (res) => (await res.json()).result.content[0].text;
r = await rpc(token, 'tools/call', { name: 'contract_list_deals', arguments: {} }); ok(/VN deal/.test(await text(r)), 'contract_list_deals reads through the API');
r = await rpc(token, 'tools/call', { name: 'contract_update_deal', arguments: { deal_id: 'd1', posture: 'seller', values: { termination_fee_pct: 12, governing_law: null }, concession: { section: 'ld.delivery', from: 'balanced', to: 'seller', reason: 'test' } } });
ok(/"ok": true/.test(await text(r)) && deals.d1.posture === 'seller' && deals.d1.values.termination_fee_pct === 12 && !('governing_law' in deals.d1.values) && deals.d1.concessions.length === 1, 'contract_update_deal merges levers, sets and clears values, logs a concession');
r = await rpc(token, 'tools/call', { name: 'contract_review_pack', arguments: { deal_id: 'd1' } }); const pack = await text(r); ok(/CHECKLIST HERE/.test(pack) && /CONTRACT TEXT HERE/.test(pack) && /Late delivery/.test(pack), 'contract_review_pack bundles checklist, findings, scenarios and text');
r = await rpc(token, 'tools/call', { name: 'contract_record_review', arguments: { deal_id: 'd1', verdict: 'needs_work', summary: 's', report: 'r' } }); ok(/"source": "connector"/.test(await text(r)), 'contract_record_review posts to the API tagged as connector');
r = await rpc(token, 'tools/call', { name: 'contract_get_deal', arguments: { deal_id: 'missing' } }); j = await r.json(); ok(j.result.isError === true && /404/.test(j.result.content[0].text), 'an API error comes back as a tool error, not a crash');
r = await rpc(token, 'tools/call', { name: 'nope', arguments: {} }); j = await r.json(); ok(!!j.error, 'unknown tool is a protocol error');
ok(seen.every(s => s.auth === 'Bearer svc-token'), 'every API call carried the service token');

/* missing secret is reported clearly */
const bare = { ...env, TSI_PROJECTS_TOKEN: undefined };
r = await worker.fetch(new Request('https://mcp.example/mcp', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'contract_list_deals', arguments: {} } }) }), bare);
ok(/TSI_PROJECTS_TOKEN/.test((await r.json()).result.content[0].text), 'a missing service token is explained');

console.log(failed ? `\n${failed} FAILED` : '\nall passed'); process.exit(failed ? 1 : 0);
