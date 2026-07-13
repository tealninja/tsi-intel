// End-to-end pipeline write-path test against a mock backend that faithfully
// mirrors the REAL tsi-intel-api Worker semantics (verified from its source):
//   PUT /api/pipeline/:id  — new record appended; existing record 409s when
//                            incoming.version < stored.version, else stored
//                            version = existing.version + 1 (server-computed).
//   POST /api/pipeline     — full replace with { records } (how deletes work).
// Drives the stdio MCP server as a real client over stdio.

import http from 'node:http';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
let store = { schema_version: 2, records: [
  { id: 'ALTE-1', acct: 'Alfanar', cat: 'Torrefaction', type: 'FEED', val: 9e6, prob: 0.75, status: 'O', stage: 'Negotiation', version: 3, tags: ['TRI'], lead: 'JT' },
] };

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const user = req.headers['x-tsi-user'] || 'unknown';
    const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    const body = () => JSON.parse(Buffer.concat(chunks).toString() || '{}');

    if (req.method === 'GET' && req.url === '/api/pipeline') {
      send(200, store);
      // Simulate a concurrent edit landing right after this read: bump the
      // stored version so the caller's next PUT is based on a now-stale version.
      if (globalThis.__armConflict) {
        globalThis.__armConflict = false;
        const r = store.records.find((x) => x.id === 'ALTE-1');
        if (r) r.version = (r.version || 0) + 5;
      }
      return;
    }
    if (req.method === 'POST' && req.url === '/api/pipeline') {
      const b = body(); store = { schema_version: 2, records: b.records || [], saved_by: user };
      return send(200, { success: true, saved: store.records.length });
    }
    const m = req.url.match(/^\/api\/pipeline\/(.+)$/);
    if (req.method === 'PUT' && m) {
      const id = decodeURIComponent(m[1]); const incoming = body();
      const idx = store.records.findIndex((r) => r.id === id);
      if (idx === -1) { store.records.push({ ...incoming, createdBy: user }); return send(200, { success: true, id, version: incoming.version }); }
      const existing = store.records[idx];
      if (incoming.version !== undefined && existing.version !== undefined && incoming.version < existing.version) {
        return send(409, { success: false, conflict: true, serverVersion: existing.version });
      }
      store.records[idx] = { ...existing, ...incoming, version: (existing.version || 0) + 1, updatedBy: user };
      return send(200, { success: true, id, version: store.records[idx].version });
    }
    send(404, { error: 'not found' });
  });
});

await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

const client = new Client({ name: 'pw', version: '1.0.0' });
await client.connect(new StdioClientTransport({
  command: process.execPath,
  args: [resolve(__dirname, '..', 'src', 'index.js')],
  env: { ...process.env, TSI_WORKER_URL: base, TSI_USER: 'MCPBOT' },
  stderr: 'ignore',
}));

const call = async (name, args, wantError = false) => {
  const r = await client.callTool({ name, arguments: args });
  if (!wantError) assert.equal(r.isError ?? false, false, `${name}: ${r.content?.[0]?.text}`);
  return { text: r.content[0].text, data: (() => { try { return JSON.parse(r.content[0].text); } catch { return null; } })(), isError: !!r.isError };
};
let n = 0; const ok = (m) => { n++; console.log('  ✓ ' + m); };

console.log('pipeline write path (faithful mock of tsi-intel-api):');

// create -> generated id, version 1, appears in store
let c = (await call('create_opportunity', { acct: 'Newco Energy', type: 'Dryer System', cat: 'Dryer System', val: 5e6, prob: 0.4 })).data;
assert.equal(c.id, 'NEWC-1');
assert.equal(store.records.find((r) => r.id === 'NEWC-1').version, 1);
assert.equal(store.records.find((r) => r.id === 'NEWC-1').createdBy, 'MCPBOT');
ok('create_opportunity appends new record with version 1 + attribution');

// update -> sends BASE version, server bumps to +1, fields merged & preserved
let u = (await call('update_opportunity', { id: 'ALTE-1', prob: 0.9, stage: 'PO Received' })).data;
const alte = store.records.find((r) => r.id === 'ALTE-1');
assert.equal(alte.version, 4);            // server bumped 3 -> 4
assert.equal(alte.prob, 0.9);
assert.equal(alte.acct, 'Alfanar');       // preserved
assert.equal(u.newVersion, 4);
ok('update_opportunity sends base version; server bumps 3→4; fields preserved');

// conflict: a concurrent edit lands between the tool's read and its write
globalThis.__armConflict = true;
let conflict = await call('update_opportunity', { id: 'ALTE-1', prob: 0.5 }, true);
assert.equal(conflict.isError, true);
assert.match(conflict.text, /409|conflict/i);
ok('update_opportunity surfaces a 409 conflict instead of silently overwriting');

// delete -> full-replace POST removes the record (no per-record DELETE exists)
let d = (await call('delete_opportunity', { id: 'NEWC-1', confirm: true })).data;
assert.equal(d.deleted, true);
assert.ok(!store.records.some((r) => r.id === 'NEWC-1'));
assert.ok(store.records.some((r) => r.id === 'ALTE-1'));  // others kept
ok('delete_opportunity rewrites pipeline without the record, keeping the rest');

// summary reflects live store
let s = (await call('pipeline_summary', { groupBy: 'stage' })).data;
assert.equal(s.overall.count, store.records.length);
ok('pipeline_summary reflects post-mutation store');

await client.close();
server.close();
console.log(`\n${n} pipeline-write checks passed.`);
