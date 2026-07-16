// Pipeline/bugs client for the Cloudflare Worker runtime. Same contract as the
// Node client (../../src/worker.js) but reads config from the Worker `env`
// binding instead of process.env.

const DEFAULT_WORKER_URL = 'https://tsi-intel-api.teal-john.workers.dev';

export function makeConfig(env = {}) {
  return {
    workerUrl: (env.TSI_WORKER_URL || DEFAULT_WORKER_URL).replace(/\/+$/, ''),
    apiKey: env.TSI_API_KEY || '',
    user: env.TSI_USER || 'JT',
  };
}

export function makeApi(env = {}) {
  const cfg = makeConfig(env);
  const headers = () => {
    const h = { 'Content-Type': 'application/json' };
    if (cfg.apiKey) h['X-TSI-Key'] = cfg.apiKey;
    if (cfg.user) h['X-TSI-User'] = cfg.user;
    return h;
  };

  async function request(method, path, body) {
    let res;
    try {
      res = await fetch(cfg.workerUrl + path, {
        method,
        headers: headers(),
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      throw new Error(`Cannot reach the TSI Worker at ${cfg.workerUrl} (${e.message}).`);
    }
    const text = await res.text();
    if (!res.ok) throw new Error(`Worker ${res.status} ${res.statusText}${text ? ` — ${text.slice(0, 400)}` : ''}`);
    if (!text) return null;
    try { return JSON.parse(text); } catch { return text; }
  }

  return {
    config: cfg,
    async listPipeline() {
      const data = await request('GET', '/api/pipeline');
      if (Array.isArray(data)) return data;
      if (data && Array.isArray(data.records)) return data.records;
      return [];
    },
    putOpportunity(opp) {
      if (!opp || !opp.id) throw new Error('putOpportunity requires an id');
      return request('PUT', '/api/pipeline/' + encodeURIComponent(opp.id), opp);
    },
    savePipeline(records) {
      return request('POST', '/api/pipeline', { schema_version: 2, records });
    },
    async listBugs() {
      const data = await request('GET', '/api/bugs');
      return Array.isArray(data) ? data : [];
    },
    postBugs(bugs) {
      return request('POST', '/api/bugs', bugs);
    },
  };
}
