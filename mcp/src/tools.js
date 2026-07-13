// Transport-neutral tool definitions. buildTools() returns an array of specs:
//   { name, title, description, input (zod raw shape), run(args) -> data }
// The stdio server (src/index.js) and the Cloudflare Worker (worker/) both consume
// these, so the tool surface and behaviour stay identical across transports.
//
// Dependencies are injected so this file has no I/O and no environment coupling:
//   api  — pipeline/bugs client: listPipeline, putOpportunity, deleteOpportunity,
//          listBugs, postBugs
//   ref  — reference search: searchAccounts, getAccount, searchContacts, searchProducts
//   user — attribution string written to createdBy/updatedBy
//   now  — () => ISO timestamp (injectable for testing)

import { z } from 'zod';
import {
  ENUMS, filterPipeline, summarize, totals, groupTotals, weighted, nextId,
} from './pipeline.js';

const stripUndefined = (obj) => {
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out;
};

export function buildTools({ api, ref, user = 'JT', now = () => new Date().toISOString() }) {
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

  const FILTERS = {
    query: z.string().optional().describe('Free-text over id, account, type, location, notes, source, tags'),
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
  };

  return [
    {
      name: 'list_opportunities',
      title: 'List opportunities',
      description:
        'List/filter sales-pipeline opportunities from the live TSI Worker. All filters ' +
        'are ANDed. Returns compact rows plus count/total/weighted totals for the matched ' +
        'set. Use get_opportunity for the full record.',
      input: { ...FILTERS, limit: z.number().int().positive().max(500).optional().describe('Max rows (default 50)') },
      async run(args) {
        const { limit = 50, ...filters } = args;
        const all = await api.listPipeline();
        const matched = filterPipeline(all, filters);
        return { ...totals(matched), returned: Math.min(matched.length, limit), opportunities: matched.slice(0, limit).map(summarize) };
      },
    },
    {
      name: 'get_opportunity',
      title: 'Get opportunity',
      description: 'Fetch the full record for one opportunity by id.',
      input: { id: z.string().describe('Opportunity id, e.g. ALTE-1') },
      async run({ id }) {
        const all = await api.listPipeline();
        const o = all.find((r) => r.id === id);
        if (!o) throw new Error(`No opportunity with id "${id}".`);
        return { ...o, _weighted: Math.round(weighted(o)) };
      },
    },
    {
      name: 'pipeline_summary',
      title: 'Pipeline summary',
      description:
        'Aggregate the pipeline: overall count, total value, and weighted (value × ' +
        'probability) value, optionally broken down by a field. Apply the same filters as ' +
        'list_opportunities to scope it.',
      input: {
        groupBy: z.enum(['stage', 'cat', 'status', 'lead', 'acct', 'country', 'source']).optional()
          .describe('Field to break totals down by'),
        ...FILTERS,
      },
      async run(args) {
        const { groupBy, limit, ...filters } = args;
        const all = await api.listPipeline();
        const rows = filterPipeline(all, filters);
        const out = { overall: totals(rows) };
        if (groupBy) out.byGroup = { field: groupBy, groups: groupTotals(rows, groupBy) };
        return out;
      },
    },
    {
      name: 'create_opportunity',
      title: 'Create opportunity',
      description:
        'Create a new pipeline opportunity and save it to the live Worker. An id is ' +
        'generated from the account name unless you pass one. Written to the shared backend ' +
        '— it appears in the app for everyone.',
      input: {
        ...WRITE_FIELDS,
        acct: z.string().describe('Account / customer name (required)'),
        type: z.string().describe('Opportunity title (required)'),
        id: z.string().optional().describe('Explicit id; auto-generated if omitted'),
      },
      async run(args) {
        const all = await api.listPipeline();
        const id = args.id || nextId(args.acct, all.map((r) => r.id));
        if (all.some((r) => r.id === id)) throw new Error(`Opportunity id "${id}" already exists — use update_opportunity.`);
        const ts = now();
        const opp = {
          id, cat: 'Torrefaction', val: 0, prob: 0, status: 'O', stage: 'Lead',
          currency: 'USD', tags: [], starred: false,
          ...stripUndefined(args),
          version: 1, createdAt: ts, createdBy: user, updatedAt: ts, updatedBy: user,
        };
        await api.putOpportunity(opp);
        return { created: true, id, opportunity: opp };
      },
    },
    {
      name: 'update_opportunity',
      title: 'Update opportunity',
      description:
        'Update fields on an existing opportunity and save to the live Worker. Only the ' +
        'fields you pass change; the rest are preserved. Bumps version and updated metadata. ' +
        'The Worker may reject with a conflict (409) if the record changed underneath you.',
      input: { id: z.string().describe('Opportunity id to update'), ...WRITE_FIELDS },
      async run(args) {
        const { id, ...changes } = args;
        const all = await api.listPipeline();
        const current = all.find((r) => r.id === id);
        if (!current) throw new Error(`No opportunity with id "${id}".`);
        const clean = stripUndefined(changes);
        const merged = { ...current, ...clean, id, version: (Number(current.version) || 0) + 1, updatedAt: now(), updatedBy: user };
        await api.putOpportunity(merged);
        return { updated: true, id, changed: Object.keys(clean), opportunity: merged };
      },
    },
    {
      name: 'delete_opportunity',
      title: 'Delete opportunity',
      description:
        'Permanently delete an opportunity from the live Worker. Requires confirm=true. ' +
        'Consider setting status to "L" (lost) with update_opportunity instead.',
      input: { id: z.string(), confirm: z.literal(true).describe('Must be true to actually delete') },
      async run({ id }) {
        const all = await api.listPipeline();
        if (!all.some((r) => r.id === id)) throw new Error(`No opportunity with id "${id}".`);
        await api.deleteOpportunity(id);
        return { deleted: true, id };
      },
    },
    {
      name: 'search_accounts',
      title: 'Search accounts',
      description:
        'Search the bundled accounts reference data (374 accounts from the Dynamics CRM ' +
        'export). Read-only. Use get_account for full detail + contacts + child sites.',
      input: {
        query: z.string().optional().describe('Match name, formal name, city, or website'),
        account_type: z.enum(['customer', 'vendor', 'competitor', 'government', 'contact_only', 'unclassified']).optional(),
        country: z.string().optional(),
        state: z.string().optional(),
        limit: z.number().int().positive().max(200).optional(),
      },
      run: (args) => ref.searchAccounts(args),
    },
    {
      name: 'get_account',
      title: 'Get account',
      description: 'Get one account by seed_id or name, with its child sites and linked contacts.',
      input: {
        seed_id: z.string().optional().describe('e.g. acct_0001'),
        name: z.string().optional().describe('Account name (exact preferred, falls back to substring)'),
      },
      run(args) {
        if (!args.seed_id && !args.name) throw new Error('Provide seed_id or name.');
        const res = ref.getAccount(args);
        if (!res.found) throw new Error('No matching account.');
        return res;
      },
    },
    {
      name: 'search_contacts',
      title: 'Search contacts',
      description: 'Search the bundled contacts reference data (371 contacts). Read-only.',
      input: {
        query: z.string().optional().describe('Match full name, email, or job title'),
        account: z.string().optional().describe('Filter by matched account / company'),
        limit: z.number().int().positive().max(200).optional(),
      },
      run: (args) => ref.searchContacts(args),
    },
    {
      name: 'search_products',
      title: 'Search products',
      description: 'Search the bundled products/equipment catalogue (131 products, 21 categories). Read-only.',
      input: {
        query: z.string().optional().describe('Match name, part number, or category'),
        category: z.string().optional(),
        limit: z.number().int().positive().max(200).optional(),
      },
      run: (args) => ref.searchProducts(args),
    },
    {
      name: 'list_bugs',
      title: 'List bug reports',
      description: 'List bug reports logged against the app (from the Worker /api/bugs).',
      input: {},
      run: () => api.listBugs(),
    },
    {
      name: 'report_bug',
      title: 'Report a bug',
      description: 'Append a bug report to the app’s shared bug log on the Worker.',
      input: {
        title: z.string(),
        detail: z.string().optional(),
        severity: z.enum(['low', 'medium', 'high']).optional(),
      },
      async run({ title, detail, severity }) {
        const existing = await api.listBugs();
        const bug = { id: `bug_${Date.now().toString(36)}`, title, detail: detail || '', severity: severity || 'medium', by: user, at: now(), status: 'open' };
        await api.postBugs([...existing, bug]);
        return { reported: true, bug };
      },
    },
  ];
}
