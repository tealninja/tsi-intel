// TSI-Intel remote MCP server — Cloudflare Worker, Streamable HTTP transport.
// Add its URL as a Custom Connector in claude.ai (web). Shares tool definitions
// with the stdio server via ../../src/tools.js.

import { buildTools } from '../../src/tools.js';
import * as core from '../../src/reference-core.js';
import accounts from '../../../seed_accounts.json' with { type: 'json' };
import contacts from '../../../seed_contacts.json' with { type: 'json' };
import products from '../../../seed_products.json' with { type: 'json' };
import { makeApi } from './api.js';
import { dispatch } from './mcp.js';

const SERVER_INFO = { name: 'tsi-intel-mcp', version: '0.2.0' };
const REFERENCE = { accounts, contacts, products };

const ref = {
  searchAccounts: (a) => core.searchAccounts(REFERENCE, a),
  getAccount: (a) => core.getAccount(REFERENCE, a),
  searchContacts: (a) => core.searchContacts(REFERENCE, a),
  searchProducts: (a) => core.searchProducts(REFERENCE, a),
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Mcp-Session-Id, MCP-Protocol-Version',
};

const json = (obj, status = 200, extra = {}) =>
  new Response(obj === null ? '' : JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS, ...extra },
  });

function authorized(request, env) {
  const required = env.MCP_AUTH_TOKEN;
  if (!required) return true; // open if no token configured
  const hdr = request.headers.get('Authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(hdr);
  return !!m && m[1] === required;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    if (url.pathname === '/' || url.pathname === '/health') {
      return json({ ok: true, server: SERVER_INFO, endpoint: '/mcp' });
    }

    if (url.pathname !== '/mcp') return json({ error: 'not found' }, 404);

    if (!authorized(request, env)) {
      return json({ error: 'unauthorized' }, 401, { 'WWW-Authenticate': 'Bearer' });
    }

    // GET is used by Streamable HTTP to open a server->client SSE stream. These
    // tools never push, so we decline it; clients fall back to POST-only.
    if (request.method === 'GET') return json({ error: 'method not allowed' }, 405);
    if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400);
    }

    const tools = buildTools({ api: makeApi(env), ref, user: env.TSI_USER || 'JT' });
    const ctx = { tools, serverInfo: SERVER_INFO };

    // Support single messages and JSON-RPC batches.
    if (Array.isArray(body)) {
      const responses = (await Promise.all(body.map((m) => dispatch(m, ctx)))).filter((r) => r !== null);
      return responses.length ? json(responses) : new Response(null, { status: 202, headers: CORS });
    }

    const response = await dispatch(body, ctx);
    return response === null ? new Response(null, { status: 202, headers: CORS }) : json(response);
  },
};
