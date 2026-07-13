// Thin client for the TSI-Intel API Worker (Cloudflare).
//
// This is the SAME backend the web app (tsi-intel.html) talks to, so edits made
// here round-trip to the live app. The only server-backed, shared, mutable store
// is the sales pipeline (opportunities) under /api/pipeline, plus a /api/bugs log.
// Accounts/contacts/products live in each browser's localStorage and are NOT here
// — those are served read-only from the bundled seed files (see reference.js).

const DEFAULT_WORKER_URL = 'https://tsi-intel-api.teal-john.workers.dev';

export const config = {
  workerUrl: (process.env.TSI_WORKER_URL || DEFAULT_WORKER_URL).replace(/\/+$/, ''),
  apiKey: process.env.TSI_API_KEY || '',
  // Attribution written into createdBy/updatedBy and the X-TSI-User header.
  user: process.env.TSI_USER || 'JT',
};

function headers(extra = {}) {
  const h = { 'Content-Type': 'application/json', ...extra };
  if (config.apiKey) h['X-TSI-Key'] = config.apiKey;
  if (config.user) h['X-TSI-User'] = config.user;
  return h;
}

class WorkerError extends Error {
  constructor(status, statusText, body) {
    super(`Worker ${status} ${statusText}${body ? ` — ${body}` : ''}`);
    this.name = 'WorkerError';
    this.status = status;
  }
}

async function request(method, path, body) {
  const url = config.workerUrl + path;
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    throw new Error(
      `Cannot reach the TSI Worker at ${config.workerUrl} (${e.message}). ` +
      `Check TSI_WORKER_URL and that this machine has network access to it.`,
    );
  }
  const text = await res.text();
  if (!res.ok) throw new WorkerError(res.status, res.statusText, text.slice(0, 400));
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// ── Pipeline (opportunities) ──────────────────────────────────────────────

/** GET the whole pipeline. Normalizes {records:[...]} or a bare array. */
export async function listPipeline() {
  const data = await request('GET', '/api/pipeline');
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.records)) return data.records;
  return [];
}

/** Upsert one opportunity by id (PUT /api/pipeline/:id). Returns worker response. */
export function putOpportunity(opp) {
  if (!opp || !opp.id) throw new Error('putOpportunity requires an id');
  return request('PUT', '/api/pipeline/' + encodeURIComponent(opp.id), opp);
}

/** DELETE /api/pipeline/:id. */
export function deleteOpportunity(id) {
  return request('DELETE', '/api/pipeline/' + encodeURIComponent(id));
}

// ── Bugs ──────────────────────────────────────────────────────────────────

export async function listBugs() {
  const data = await request('GET', '/api/bugs');
  return Array.isArray(data) ? data : [];
}

export function postBugs(bugs) {
  return request('POST', '/api/bugs', bugs);
}

export { WorkerError };
