// Offline smoke test — no Worker needed.
// 1. Unit-tests pipeline helpers against a fixture.
// 2. Exercises reference search against the real seed_*.json files.
// 3. Boots the actual MCP server over stdio, lists tools, and calls a
//    Worker-free tool (search_products) end-to-end.

import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import { filterPipeline, totals, groupTotals, nextId, weighted } from '../src/pipeline.js';
import { searchAccounts, getAccount, searchContacts, searchProducts } from '../src/reference.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log(`  ✓ ${name}`); };

const FIX = [
  { id: 'ALTE-1', acct: 'Alfanar', cat: 'Torrefaction', val: 9e6, prob: 0.75, status: 'O', stage: 'Negotiation', country: 'UK', tags: ['TRI'], lead: 'JT' },
  { id: 'ALTE-2', acct: 'Alfanar', cat: 'Torrefaction', val: 2.2e8, prob: 0.1, status: 'O', stage: 'Qualified', country: 'UK', tags: ['MI', 'EI'], lead: 'JT' },
  { id: 'Z-01', acct: 'Bionow', cat: 'Dryer Island', val: 1.14e8, prob: 0.5, status: 'W', stage: 'PO Received', country: 'USA', tags: ['DRI', 'DRY'], lead: 'ZS' },
];

console.log('pipeline helpers:');
check('filter by account', () => assert.equal(filterPipeline(FIX, { account: 'alfa' }).length, 2));
check('filter by status exact', () => assert.equal(filterPipeline(FIX, { status: 'W' }).length, 1));
check('filter by tag (case-insensitive)', () => assert.equal(filterPipeline(FIX, { tag: 'dri' }).length, 1));
check('filter by query over notes/loc/tags', () => assert.equal(filterPipeline(FIX, { query: 'bionow' }).length, 1));
check('minValue filter', () => assert.equal(filterPipeline(FIX, { minValue: 1e8 }).length, 2));
check('weighted value', () => assert.equal(weighted(FIX[0]), 6.75e6));
check('totals', () => {
  const t = totals(FIX);
  assert.equal(t.count, 3);
  assert.equal(t.totalValue, 9e6 + 2.2e8 + 1.14e8);
});
check('groupTotals by lead', () => {
  const g = groupTotals(FIX, 'lead');
  assert.equal(g.find((x) => x.key === 'JT').count, 2);
});
check('nextId derives + avoids collisions', () => {
  assert.equal(nextId('Alfanar', ['ALFA-1', 'ALFA-2']), 'ALFA-3');
  assert.equal(nextId('New Customer Co', []), 'NEWC-1');
});

console.log('reference data (real seed files):');
check('search_accounts finds by name', () => {
  const r = searchAccounts({ query: 'drax', limit: 5 });
  assert.ok(r.count >= 1, 'expected at least one Drax account');
});
check('search_accounts filter by type', () => {
  const r = searchAccounts({ account_type: 'customer', limit: 500 });
  assert.ok(r.count > 0);
});
check('get_account returns contacts array', () => {
  const first = searchAccounts({ limit: 1 }).results[0];
  const r = getAccount({ seed_id: first.seed_id });
  assert.equal(r.found, true);
  assert.ok(Array.isArray(r.contacts));
});
check('search_contacts works', () => assert.ok(searchContacts({ limit: 1 }).count >= 1));
check('search_products works', () => assert.ok(searchProducts({ limit: 1 }).count >= 1));

console.log('MCP server over stdio:');
const client = new Client({ name: 'smoke', version: '1.0.0' });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [resolve(__dirname, '..', 'src', 'index.js')],
  // Point at an unreachable Worker so any accidental network call fails fast;
  // the tools we exercise here (search_products) never touch it.
  env: { ...process.env, TSI_WORKER_URL: 'http://127.0.0.1:1', TSI_USER: 'SMOKE' },
  stderr: 'ignore',
});
await client.connect(transport);
try {
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  check('server registered all tools', () => {
    for (const t of [
      'list_opportunities', 'get_opportunity', 'pipeline_summary',
      'create_opportunity', 'update_opportunity', 'delete_opportunity',
      'search_accounts', 'get_account', 'search_contacts', 'search_products',
      'list_bugs', 'report_bug',
    ]) assert.ok(names.includes(t), `missing tool ${t}`);
  });
  const res = await client.callTool({ name: 'search_products', arguments: { query: 'burner', limit: 3 } });
  check('search_products round-trips over MCP', () => {
    assert.equal(res.isError ?? false, false);
    const payload = JSON.parse(res.content[0].text);
    assert.ok(payload.count >= 1);
  });
} finally {
  await client.close();
}

console.log(`\n${passed} checks passed.`);
