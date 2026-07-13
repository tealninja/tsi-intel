// Node loader for the reference datasets. Reads the repo's seed_*.json exports
// and exposes them as a `data` object plus search helpers that delegate to the
// pure core (reference-core.js), which is shared with the Cloudflare Worker build.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import * as core from './reference-core.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

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

let _data;
export function referenceData() {
  return (_data ||= {
    accounts: loadSeed('seed_accounts.json'),
    contacts: loadSeed('seed_contacts.json'),
    products: loadSeed('seed_products.json'),
  });
}

export const searchAccounts = (args) => core.searchAccounts(referenceData(), args);
export const getAccount = (args) => core.getAccount(referenceData(), args);
export const searchContacts = (args) => core.searchContacts(referenceData(), args);
export const searchProducts = (args) => core.searchProducts(referenceData(), args);
