// Read-only reference data: accounts, contacts, products.
//
// These are NOT stored on the Worker — the web app keeps them in each browser's
// localStorage, seeded from the repo's seed_*.json exports (Microsoft Dynamics
// CRM, cleaned). We serve those same exports so Claude can look up "who's the
// contact at Drax" / "what's the SKU for the register burner" while working the
// pipeline. Edits here would not sync anywhere live, so no write tools exist.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Candidate locations for the seed files, in priority order.
function seedCandidates(name) {
  const c = [];
  if (process.env.TSI_SEED_DIR) c.push(resolve(process.env.TSI_SEED_DIR, name));
  c.push(resolve(__dirname, '..', 'data', name)); // bundled copy, if present
  c.push(resolve(__dirname, '..', '..', name)); // repo root (mcp/../)
  c.push(resolve(process.cwd(), name));
  return c;
}

function loadSeed(name) {
  for (const path of seedCandidates(name)) {
    try {
      return JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      /* try next */
    }
  }
  throw new Error(
    `Could not find ${name}. Looked in TSI_SEED_DIR, ./data, the repo root, and cwd. ` +
    `Set TSI_SEED_DIR to the folder holding the seed_*.json files.`,
  );
}

let _accounts, _contacts, _products;
export const accounts = () => (_accounts ||= loadSeed('seed_accounts.json'));
export const contacts = () => (_contacts ||= loadSeed('seed_contacts.json'));
export const products = () => (_products ||= loadSeed('seed_products.json'));

const inc = (v, q) => String(v || '').toLowerCase().includes(q);

export function searchAccounts({ query, account_type, country, state, limit = 25 } = {}) {
  const q = query ? String(query).toLowerCase() : null;
  const rows = accounts().filter((a) => {
    if (q && !(inc(a.name, q) || inc(a.formal_name, q) || inc(a.city, q) || inc(a.website, q) || inc(a.parent_account_name, q))) return false;
    if (account_type && String(a.account_type || '') !== account_type) return false;
    if (country && !inc(a.country, String(country).toLowerCase())) return false;
    if (state && !inc(a.state, String(state).toLowerCase())) return false;
    return true;
  });
  return { count: rows.length, results: rows.slice(0, limit).map(acctBrief) };
}

const acctBrief = (a) => ({
  seed_id: a.seed_id,
  name: a.name,
  formal_name: a.formal_name || null,
  account_type: a.account_type || null,
  city: a.city || null,
  state: a.state || null,
  country: a.country || null,
  website: a.website || null,
  parent: a.parent_account_name || null,
});

export function getAccount({ seed_id, name }) {
  const all = accounts();
  let a;
  if (seed_id) a = all.find((x) => x.seed_id === seed_id);
  if (!a && name) {
    const n = String(name).toLowerCase();
    a = all.find((x) => String(x.name || '').toLowerCase() === n) ||
        all.find((x) => inc(x.name, n) || inc(x.formal_name, n));
  }
  if (!a) return { found: false };
  const children = all.filter((x) => x.parent_seed_id === a.seed_id).map(acctBrief);
  const linked = contacts()
    .filter((c) => c.matched_account_seed_id === a.seed_id)
    .map(contactBrief);
  return { found: true, account: a, children, contacts: linked };
}

const contactBrief = (c) => ({
  seed_id: c.seed_id,
  full_name: c.full_name,
  job_title: c.job_title || null,
  email: c.email || null,
  business_phone: c.business_phone || null,
  mobile_phone: c.mobile_phone || null,
  company: c.matched_account || c.company_name_raw || null,
  matched_account_seed_id: c.matched_account_seed_id || null,
});

export function searchContacts({ query, account, limit = 25 } = {}) {
  const q = query ? String(query).toLowerCase() : null;
  const acct = account ? String(account).toLowerCase() : null;
  const rows = contacts().filter((c) => {
    if (q && !(inc(c.full_name, q) || inc(c.email, q) || inc(c.job_title, q))) return false;
    if (acct && !(inc(c.matched_account, acct) || inc(c.company_name_raw, acct))) return false;
    return true;
  });
  return { count: rows.length, results: rows.slice(0, limit).map(contactBrief) };
}

export function searchProducts({ query, category, limit = 25 } = {}) {
  const q = query ? String(query).toLowerCase() : null;
  const rows = products().filter((p) => {
    if (q && !(inc(p.name, q) || inc(p.pn, q) || inc(p.category, q))) return false;
    if (category && !inc(p.category, String(category).toLowerCase())) return false;
    return true;
  });
  return {
    count: rows.length,
    results: rows.slice(0, limit).map((p) => ({
      seed_id: p.seed_id,
      pn: p.pn,
      name: p.name,
      category: p.category || null,
      structure: p.structure || null,
      price: p.price ?? null,
      status: p.status || null,
    })),
  };
}
