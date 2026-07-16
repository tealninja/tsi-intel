// Pipeline (opportunity) domain helpers: enums, filtering, aggregation, id gen.
// Field shape mirrors the records the web app stores on the Worker:
//   id, acct, cat, type, loc, city, state, country, val, prob, close,
//   lead, source, status, stage, tags[], notes, currency, starred,
//   version, createdAt, createdBy, updatedAt, updatedBy, ...

export const ENUMS = {
  // status: O = open, W = won, L = lost
  status: ['O', 'W', 'L'],
  stage: ['Lead', 'Qualified', 'Proposal', 'Negotiation', 'PO Received'],
  category: [
    'Torrefaction', 'Dryer Island', 'Dryer System', 'Emissions',
    'Aftermarket/CO', 'Finishing/Mods', 'Inspection', 'Won',
  ],
  // Equipment tags (from the app's TAG_DEFS).
  tags: {
    SGF: 'Step Grate Furnace', RB: 'Register Burner', SB: 'Suspension Burner',
    TOH: 'Thermal Oil Heater', DRY: 'Dryer', DRI: 'Dryer Island',
    FTD: 'Flash Tube Dryer', WESP: 'WESP', RTO: 'RTO', RCO: 'RCO',
    ME: 'Mist Eliminator', CYC: 'Cyclones', TOR: 'Torreactor',
    TRI: 'Torreactor Island', IG: 'Isolation Gates', FL: 'Finishing Line',
    REC: 'Recycle System', COM: 'Commissioning', MI: 'Mechanical Install',
    EI: 'Electrical Install', GEN: 'Genset', STG: 'Steam Generator',
  },
};

const STATUS_LABEL = { O: 'Open', W: 'Won', L: 'Lost' };

/** Weighted value = val * prob (expected value). */
export function weighted(o) {
  return (Number(o.val) || 0) * (Number(o.prob) || 0);
}

/** A compact one-line-ish view of an opportunity for list results. */
export function summarize(o) {
  return {
    id: o.id,
    acct: o.acct,
    type: o.type,
    cat: o.cat,
    val: o.val ?? null,
    prob: o.prob ?? null,
    weighted: Math.round(weighted(o)),
    stage: o.stage ?? null,
    status: o.status ?? null,
    statusLabel: STATUS_LABEL[o.status] || o.status || null,
    loc: o.loc ?? null,
    country: o.country ?? null,
    close: o.close ?? null,
    lead: o.lead ?? null,
    tags: o.tags ?? [],
    starred: !!o.starred,
    updatedAt: o.updatedAt ?? null,
  };
}

function textOf(o) {
  return [o.id, o.acct, o.type, o.cat, o.loc, o.city, o.state, o.country, o.notes, o.source, o.lead, (o.tags || []).join(' ')]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

/**
 * Filter a pipeline array. All criteria are ANDed; string matches are
 * case-insensitive substring (except status/stage which are exact).
 */
export function filterPipeline(rows, f = {}) {
  const q = f.query ? String(f.query).toLowerCase() : null;
  const acct = f.account ? String(f.account).toLowerCase() : null;
  const cat = f.category ? String(f.category).toLowerCase() : null;
  const country = f.country ? String(f.country).toLowerCase() : null;
  const lead = f.lead ? String(f.lead).toLowerCase() : null;
  const source = f.source ? String(f.source).toLowerCase() : null;
  const tag = f.tag ? String(f.tag).toUpperCase() : null;

  return rows.filter((o) => {
    if (q && !textOf(o).includes(q)) return false;
    if (acct && !String(o.acct || '').toLowerCase().includes(acct)) return false;
    if (cat && String(o.cat || '').toLowerCase() !== cat) return false;
    if (f.status && String(o.status || '') !== f.status) return false;
    if (f.stage && String(o.stage || '') !== f.stage) return false;
    if (country && !String(o.country || '').toLowerCase().includes(country)) return false;
    if (lead && String(o.lead || '').toLowerCase() !== lead) return false;
    if (source && !String(o.source || '').toLowerCase().includes(source)) return false;
    if (tag && !(o.tags || []).map((t) => String(t).toUpperCase()).includes(tag)) return false;
    if (typeof f.starred === 'boolean' && !!o.starred !== f.starred) return false;
    if (typeof f.minValue === 'number' && (Number(o.val) || 0) < f.minValue) return false;
    if (typeof f.maxValue === 'number' && (Number(o.val) || 0) > f.maxValue) return false;
    if (f.closeContains && !String(o.close || '').toLowerCase().includes(String(f.closeContains).toLowerCase())) return false;
    return true;
  });
}

/** Totals over a set of rows. */
export function totals(rows) {
  return {
    count: rows.length,
    totalValue: rows.reduce((s, o) => s + (Number(o.val) || 0), 0),
    weightedValue: Math.round(rows.reduce((s, o) => s + weighted(o), 0)),
  };
}

/** Group rows by a field and total each group. */
export function groupTotals(rows, field) {
  const groups = {};
  for (const o of rows) {
    const key = (o[field] ?? '—') || '—';
    (groups[key] ||= []).push(o);
  }
  return Object.entries(groups)
    .map(([key, list]) => ({ key, ...totals(list) }))
    .sort((a, b) => b.totalValue - a.totalValue);
}

const slug = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 4) || 'OPP';

/**
 * Generate a new opportunity id in the app's "<PREFIX>-<n>" style, derived from
 * the account name, avoiding collisions with existing ids.
 */
export function nextId(account, existingIds) {
  const prefix = slug(account);
  const taken = new Set(existingIds);
  const re = new RegExp('^' + prefix + '-(\\d+)$');
  let max = 0;
  for (const id of taken) {
    const m = re.exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  let n = max + 1;
  let candidate = `${prefix}-${n}`;
  while (taken.has(candidate)) candidate = `${prefix}-${++n}`;
  return candidate;
}
