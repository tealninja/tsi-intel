// Drives the actual Worker fetch handler in Node using web Request/Response.
// No network: only reference tools (search_products) and protocol methods are
// exercised; pipeline tools would call the live tsi-intel-api and are covered by
// the stdio package's mock-worker test.

import assert from 'node:assert/strict';
import worker from '../src/index.js';

let n = 0;
const ok = (m) => { n++; console.log('  ✓ ' + m); };
const post = (body, headers = {}) =>
  new Request('https://mcp.example/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

const ENV = { TSI_WORKER_URL: 'http://127.0.0.1:1', TSI_USER: 'WEB', MCP_AUTH_TOKEN: 'sekret' };
const AUTH = { Authorization: 'Bearer sekret' };
const rpc = (method, params, id = 1) => ({ jsonrpc: '2.0', id, method, params });
const call = async (req, env = ENV) => {
  const res = await worker.fetch(req, env);
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

console.log('worker MCP over HTTP:');

// health
{
  const res = await worker.fetch(new Request('https://mcp.example/health'), ENV);
  const b = await res.json();
  assert.equal(res.status, 200); assert.equal(b.ok, true); ok('GET /health returns status');
}

// auth required
{
  const r = await call(post(rpc('tools/list')), ENV); // no Authorization header
  assert.equal(r.status, 401); ok('rejects missing bearer token (401)');
}

// initialize
{
  const r = await call(post(rpc('initialize', { protocolVersion: '2024-11-05' }), AUTH));
  assert.equal(r.status, 200);
  assert.equal(r.body.result.serverInfo.name, 'tsi-intel-mcp');
  assert.ok(r.body.result.capabilities.tools); ok('initialize returns serverInfo + capabilities');
}

// initialized notification -> 202, no body
{
  const res = await worker.fetch(post(rpc('notifications/initialized', {}, null), AUTH), ENV);
  assert.equal(res.status, 202); ok('notifications/initialized -> 202 no content');
}

// tools/list -> all 12 tools with JSON Schemas
{
  const r = await call(post(rpc('tools/list'), AUTH));
  const names = r.body.result.tools.map((t) => t.name).sort();
  for (const t of ['list_opportunities', 'get_opportunity', 'pipeline_summary', 'create_opportunity',
    'update_opportunity', 'delete_opportunity', 'search_accounts', 'get_account', 'search_contacts',
    'search_products', 'list_bugs', 'report_bug']) assert.ok(names.includes(t), `missing ${t}`);
  const sp = r.body.result.tools.find((t) => t.name === 'search_products');
  assert.equal(sp.inputSchema.type, 'object');
  assert.ok(sp.inputSchema.properties.query, 'search_products should expose a query param');
  ok('tools/list returns all 12 tools with JSON Schema inputs');
}

// tools/call search_products (reference data, no network)
{
  const r = await call(post(rpc('tools/call', { name: 'search_products', arguments: { query: 'burner', limit: 3 } }), AUTH));
  assert.equal(r.status, 200);
  assert.equal(r.body.result.isError ?? false, false);
  const payload = JSON.parse(r.body.result.content[0].text);
  assert.ok(payload.count >= 1, 'expected burner products'); ok('tools/call search_products round-trips');
}

// tools/call get_account with bad args -> isError result (not a transport error)
{
  const r = await call(post(rpc('tools/call', { name: 'get_account', arguments: {} }), AUTH));
  assert.equal(r.status, 200);
  assert.equal(r.body.result.isError, true); ok('tool errors surface as isError result');
}

// unknown tool -> JSON-RPC error
{
  const r = await call(post(rpc('tools/call', { name: 'nope' }), AUTH));
  assert.ok(r.body.error && r.body.error.code === -32602); ok('unknown tool -> JSON-RPC error');
}

// batch: two requests, one notification
{
  const r = await call(post([rpc('ping', {}, 10), rpc('tools/list', {}, 11), rpc('notifications/initialized', {}, null)], AUTH));
  assert.ok(Array.isArray(r.body));
  assert.equal(r.body.length, 2, 'notification should not produce a response'); ok('JSON-RPC batch handled');
}

console.log(`\n${n} worker-http checks passed.`);
