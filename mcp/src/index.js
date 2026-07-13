#!/usr/bin/env node
// TSI-Intel MCP server.
// Exposes the TSI-Intel app's data to Claude: live read/write of the sales
// pipeline (opportunities) on the tsi-intel-api Worker, plus read-only search
// over the bundled accounts / contacts / products reference data.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import * as api from './worker.js';
import { config } from './worker.js';
import {
  ENUMS, filterPipeline, summarize, totals, groupTotals, weighted, nextId,
} from './pipeline.js';
import { searchAccounts, getAccount, searchContacts, searchProducts } from './reference.js';

const server = new McpServer({ name: 'tsi-intel-mcp', version: '0.1.0' });

// ── result helpers ─────────────────────────────────────────────────────────
const ok = (data) => ({ content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }] });
const fail = (msg) => ({ content: [{ type: 'text', text: `Error: ${msg}` }], isError: true });
const wrap = (fn) => async (args) => {
  try {
    return await fn(args || {});
  } catch (e) {
    return fail(e.message || String(e));
  }
};

// A single ISO timestamp per call, used for created/updated fields.
const now = () => new Date().toISOString();

// ── Pipeline: read ──────────────────────────────────────────────────────────

server.registerTool(
  'list_opportunities',
  {
    title: 'List opportunities',
    description:
      'List/filter sales-pipeline opportunities from the live TSI Worker. All ' +
      'filters are ANDed. Returns compact rows plus count/total/weighted totals ' +
      'for the matched set. Use get_opportunity for the full record.',
    inputSchema: {
      query: z.string().optional().describe('Free-text search over id, account, type, location, notes, source, tags'),
      account: z.string().optional().describe('Account name (substring match)'),
      category: z.enum(ENUMS.category).optional(),
      status: z.enum(ENUMS.status).optional().describe('O=open, W=won, L=lost'),
      stage: z.enum(ENUMS.stage).optional(),
      lead: z.string().optional().describe('Owner initials, e.g. JT, ZS'),
      source: z.string().optional(),
      tag: z.string().optional().describe('Equipment tag, e.g. DRY, WESP, TOR'),
      country: z.string().optional(),
      starred: z.boolean().optional(),
      minValue: z.number().optional(),
      maxValue: z.number().optional(),
      closeContains: z.string().optional().describe('Match the close field, e.g. "2026" or "2026-Q3"'),
      limit: z.number().int().positive().max(500).optional().describe('Max rows to return (default 50)'),
    },
  },
  wrap(async (args) => {
    const { limit = 50, ...filters } = args;
    const all = await api.listPipeline();
    const matched = filterPipeline(all, filters);
    return ok({
      ...totals(matched),
      returned: Math.min(matched.length, limit),
      opportunities: matched.slice(0, limit).map(summarize),
    });
  }),
);

server.registerTool(
  'get_opportunity',
  {
    title: 'Get opportunity',
    description: 'Fetch the full record for one opportunity by id.',
    inputSchema: { id: z.string().describe('Opportunity id, e.g. ALTE-1') },
  },
  wrap(async ({ id }) => {
    const all = await api.listPipeline();
    const o = all.find((r) => r.id === id);
    if (!o) return fail(`No opportunity with id "${id}".`);
    return ok({ ...o, _weighted: Math.round(weighted(o)) });
  }),
);

server.registerTool(
  'pipeline_summary',
  {
    title: 'Pipeline summary',
    description:
      'Aggregate the pipeline: overall count, total value, and weighted (value × ' +
      'probability) value, optionally broken down by a field. Apply the same ' +
      'filters as list_opportunities to scope it.',
    inputSchema: {
      groupBy: z.enum(['stage', 'cat', 'status', 'lead', 'acct', 'country', 'source']).optional()
        .describe('Field to break totals down by'),
      query: z.string().optional(),
      account: z.string().optional(),
      category: z.enum(ENUMS.category).optional(),
      status: z.enum(ENUMS.status).optional(),
      stage: z.enum(ENUMS.stage).optional(),
      lead: z.string().optional(),
      country: z.string().optional(),
      tag: z.string().optional(),
      starred: z.boolean().optional(),
      minValue: z.number().optional(),
      maxValue: z.number().optional(),
    },
  },
  wrap(async (args) => {
    const { groupBy, ...filters } = args;
    const all = await api.listPipeline();
    const rows = filterPipeline(all, filters);
    const out = { overall: totals(rows) };
    if (groupBy) out.byGroup = { field: groupBy, groups: groupTotals(rows, groupBy) };
    return ok(out);
  }),
);

// ── Pipeline: write ──────────────────────────────────────────────────────────

const WRITE_FIELDS = {
  acct: z.string().optional().describe('Account / customer name'),
  type: z.string().optional().describe('Opportunity title, e.g. "Dryer Island & Torreactor System"'),
  cat: z.enum(ENUMS.category).optional(),
  val: z.number().optional().describe('Deal value in currency units (e.g. 9000000)'),
  prob: z.number().min(0).max(1).optional().describe('Win probability 0–1'),
  stage: z.enum(ENUMS.stage).optional(),
  status: z.enum(ENUMS.status).optional().describe('O=open, W=won, L=lost'),
  loc: z.string().optional().describe('Display location, e.g. "Teesside, UK"'),
  city: z.string().optional(),
  state: z.string().optional(),
  country: z.string().optional(),
  close: z.string().optional().describe('Expected close, e.g. "2026-Q3", "2027", "TBD"'),
  lead: z.string().optional().describe('Owner initials'),
  source: z.string().optional(),
  currency: z.string().optional().describe('Default USD'),
  tags: z.array(z.string()).optional().describe('Equipment tags, e.g. ["DRY","TOR"]'),
  notes: z.string().optional(),
  starred: z.boolean().optional(),
};

server.registerTool(
  'create_opportunity',
  {
    title: 'Create opportunity',
    description:
      'Create a new pipeline opportunity and save it to the live Worker. An id is ' +
      'generated from the account name unless you pass one. This is written to the ' +
      'shared backend and will appear in the app for everyone.',
    inputSchema: {
      ...WRITE_FIELDS,
      acct: z.string().describe('Account / customer name (required)'),
      type: z.string().describe('Opportunity title (required)'),
      id: z.string().optional().describe('Explicit id; auto-generated if omitted'),
    },
  },
  wrap(async (args) => {
    const all = await api.listPipeline();
    const id = args.id || nextId(args.acct, all.map((r) => r.id));
    if (all.some((r) => r.id === id)) return fail(`Opportunity id "${id}" already exists — use update_opportunity.`);
    const ts = now();
    const opp = {
      id,
      cat: 'Torrefaction',
      val: 0,
      prob: 0,
      status: 'O',
      stage: 'Lead',
      currency: 'USD',
      tags: [],
      starred: false,
      ...stripUndefined(args),
      version: 1,
      createdAt: ts,
      createdBy: config.user,
      updatedAt: ts,
      updatedBy: config.user,
    };
    delete opp.id_generated;
    await api.putOpportunity(opp);
    return ok({ created: true, id, opportunity: opp });
  }),
);

server.registerTool(
  'update_opportunity',
  {
    title: 'Update opportunity',
    description:
      'Update fields on an existing opportunity and save to the live Worker. Only ' +
      'the fields you pass are changed; the rest are preserved. Bumps version and ' +
      'updated metadata. If the record was changed by someone else the Worker may ' +
      'reject with a conflict (409).',
    inputSchema: {
      id: z.string().describe('Opportunity id to update'),
      ...WRITE_FIELDS,
    },
  },
  wrap(async (args) => {
    const { id, ...changes } = args;
    const all = await api.listPipeline();
    const current = all.find((r) => r.id === id);
    if (!current) return fail(`No opportunity with id "${id}".`);
    const merged = {
      ...current,
      ...stripUndefined(changes),
      id,
      version: (Number(current.version) || 0) + 1,
      updatedAt: now(),
      updatedBy: config.user,
    };
    await api.putOpportunity(merged);
    return ok({ updated: true, id, changed: Object.keys(stripUndefined(changes)), opportunity: merged });
  }),
);

server.registerTool(
  'delete_opportunity',
  {
    title: 'Delete opportunity',
    description:
      'Permanently delete an opportunity from the live Worker. Requires confirm=true. ' +
      'Consider setting status to "L" (lost) with update_opportunity instead of deleting.',
    inputSchema: {
      id: z.string(),
      confirm: z.literal(true).describe('Must be true to actually delete'),
    },
  },
  wrap(async ({ id }) => {
    const all = await api.listPipeline();
    if (!all.some((r) => r.id === id)) return fail(`No opportunity with id "${id}".`);
    await api.deleteOpportunity(id);
    return ok({ deleted: true, id });
  }),
);

// ── Reference data (read-only) ───────────────────────────────────────────────

server.registerTool(
  'search_accounts',
  {
    title: 'Search accounts',
    description:
      'Search the bundled accounts reference data (374 accounts from the Dynamics ' +
      'CRM export). Read-only. Use get_account for full detail + contacts + child sites.',
    inputSchema: {
      query: z.string().optional().describe('Match name, formal name, city, or website'),
      account_type: z.enum(['customer', 'vendor', 'competitor', 'government', 'contact_only', 'unclassified']).optional(),
      country: z.string().optional(),
      state: z.string().optional(),
      limit: z.number().int().positive().max(200).optional(),
    },
  },
  wrap(async (args) => ok(searchAccounts(args))),
);

server.registerTool(
  'get_account',
  {
    title: 'Get account',
    description: 'Get one account by seed_id or name, with its child sites and linked contacts.',
    inputSchema: {
      seed_id: z.string().optional().describe('e.g. acct_0001'),
      name: z.string().optional().describe('Account name (exact preferred, falls back to substring)'),
    },
  },
  wrap(async (args) => {
    if (!args.seed_id && !args.name) return fail('Provide seed_id or name.');
    const res = getAccount(args);
    if (!res.found) return fail('No matching account.');
    return ok(res);
  }),
);

server.registerTool(
  'search_contacts',
  {
    title: 'Search contacts',
    description: 'Search the bundled contacts reference data (371 contacts). Read-only.',
    inputSchema: {
      query: z.string().optional().describe('Match full name, email, or job title'),
      account: z.string().optional().describe('Filter by matched account / company'),
      limit: z.number().int().positive().max(200).optional(),
    },
  },
  wrap(async (args) => ok(searchContacts(args))),
);

server.registerTool(
  'search_products',
  {
    title: 'Search products',
    description: 'Search the bundled products/equipment catalogue (131 products, 21 categories). Read-only.',
    inputSchema: {
      query: z.string().optional().describe('Match name, part number, or category'),
      category: z.string().optional(),
      limit: z.number().int().positive().max(200).optional(),
    },
  },
  wrap(async (args) => ok(searchProducts(args))),
);

// ── Bugs ─────────────────────────────────────────────────────────────────────

server.registerTool(
  'list_bugs',
  {
    title: 'List bug reports',
    description: 'List bug reports logged against the app (from the Worker /api/bugs).',
    inputSchema: {},
  },
  wrap(async () => ok(await api.listBugs())),
);

server.registerTool(
  'report_bug',
  {
    title: 'Report a bug',
    description: 'Append a bug report to the app’s shared bug log on the Worker.',
    inputSchema: {
      title: z.string(),
      detail: z.string().optional(),
      severity: z.enum(['low', 'medium', 'high']).optional(),
    },
  },
  wrap(async ({ title, detail, severity }) => {
    const existing = await api.listBugs();
    const bug = {
      id: `bug_${Date.now().toString(36)}`,
      title,
      detail: detail || '',
      severity: severity || 'medium',
      by: config.user,
      at: now(),
      status: 'open',
    };
    await api.postBugs([...existing, bug]);
    return ok({ reported: true, bug });
  }),
);

function stripUndefined(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out;
}

// ── connect ──────────────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`tsi-intel-mcp ready · worker=${config.workerUrl} · user=${config.user}`);
