// TSI quote/price logic against D1 (tsi-intel). Framework-agnostic so the same
// functions back the MCP tools here and mirror worker.js's /api/quotes logic.
// Tables: products, product_prices, quotes, quote_lines (migrations 001–004).

export interface Env {
  DB: D1Database;
  OAUTH_KV: KVNamespace;
  MCP_OBJECT: DurableObjectNamespace;
  // Auth (see README): a shared login password for the OAuth login page.
  MCP_LOGIN_PASSWORD?: string;
}

const CUR_SYM: Record<string, string> = { USD: "$", EUR: "€", GBP: "£", CAD: "$" };
export function money(n: number, cur = "USD"): string {
  return (CUR_SYM[cur] || "$") + (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function nowISO() { return new Date().toISOString(); }
function rand6() {
  const b = new Uint8Array(4); crypto.getRandomValues(b);
  return Array.from(b).map((x) => x.toString(36)).join("").slice(0, 6).toUpperCase();
}

// ── catalog / price book ───────────────────────────────────────────────
export async function searchCatalog(env: Env, opts: { query?: string; category?: string; limit?: number }) {
  const where: string[] = [], bind: any[] = [];
  if (opts.category) { where.push("p.category = ?"); bind.push(opts.category); }
  if (opts.query) { where.push("(p.code LIKE ? OR p.name LIKE ? OR p.category LIKE ?)"); const q = `%${opts.query}%`; bind.push(q, q, q); }
  const sql = `SELECT p.seed_id, p.code, p.name, p.category, p.structure, pp.price, pp.currency
     FROM products p LEFT JOIN product_prices pp ON pp.product_seed_id = p.seed_id
     ${where.length ? "WHERE " + where.join(" AND ") : ""}
     ORDER BY p.category, p.code LIMIT ?`;
  bind.push(Math.min(Math.max(opts.limit || 40, 1), 200));
  const { results } = await env.DB.prepare(sql).bind(...bind).all();
  return results;
}
export async function getPriceBook(env: Env, category?: string) {
  const sql = `SELECT p.seed_id, p.code, p.name, p.category, p.unit AS unit, pp.price, pp.cost, pp.currency
     FROM product_prices pp JOIN products p ON p.seed_id = pp.product_seed_id
     ${category ? "WHERE p.category = ?" : ""} ORDER BY p.category, p.code`;
  const stmt = category ? env.DB.prepare(sql).bind(category) : env.DB.prepare(sql);
  const { results } = await stmt.all();
  return results;
}
// Resolve a line's product by code or seed_id; returns catalog + book price.
async function resolveProduct(env: Env, ref: { code?: string; product_seed_id?: string }) {
  if (ref.product_seed_id) {
    return env.DB.prepare(
      `SELECT p.seed_id AS product_seed_id, p.code, p.name, p.unit, pp.price
         FROM products p LEFT JOIN product_prices pp ON pp.product_seed_id=p.seed_id WHERE p.seed_id=?`
    ).bind(ref.product_seed_id).first<any>();
  }
  if (ref.code) {
    return env.DB.prepare(
      `SELECT p.seed_id AS product_seed_id, p.code, p.name, p.unit, pp.price
         FROM products p LEFT JOIN product_prices pp ON pp.product_seed_id=p.seed_id WHERE p.code=?`
    ).bind(ref.code).first<any>();
  }
  return null;
}

// ── totals (server-side; never trust caller math) ──────────────────────
export function computeTotals(q: any, lines: any[]) {
  const sub = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unit_price) || 0), 0);
  let disc = q.discount_mode === "pct" ? sub * ((Number(q.discount) || 0) / 100) : (Number(q.discount) || 0);
  disc = Math.min(Math.max(disc, 0), sub);
  const taxable = sub - disc + (Number(q.freight) || 0);
  const tax = taxable * ((Number(q.tax_pct) || 0) / 100);
  return { subtotal: sub, discount: disc, tax, total: taxable + tax };
}

async function nextQuoteId(env: Env) {
  const row = await env.DB.prepare(`SELECT COALESCE(MAX(seq),0)+1 AS n FROM quotes`).first<any>();
  const seq = row?.n || 1;
  return { id: `QUO-${String(seq).padStart(5, "0")}-${rand6()}`, seq };
}

// ── create a full quote (header + lines), resolving prices from the book ─
export interface QuoteLineInput { code?: string; product_seed_id?: string; description?: string; qty?: number; unit?: string; unit_price?: number; }
export interface QuoteInput {
  customer_name: string; customer_org_seed_id?: string; customer_address?: string;
  contact_name?: string; contact_email?: string; contact_phone?: string;
  project?: string; currency?: string; status?: string;
  quote_date?: string; valid_until?: string; prepared_by?: string;
  scope?: string; assumptions?: string; payment_terms?: string; delivery_terms?: string; notes?: string;
  discount?: number; discount_mode?: "pct" | "abs"; freight?: number; tax_pct?: number;
  lines: QuoteLineInput[];
}
export async function createQuote(env: Env, input: QuoteInput, user: string) {
  if (!input.customer_name) throw new Error("customer_name is required");
  if (!input.lines || !input.lines.length) throw new Error("at least one line item is required");
  const { id, seq } = await nextQuoteId(env);
  const now = nowISO();
  const cur = input.currency || "USD";

  // Resolve each line — auto-fill price from the price book when omitted.
  const resolved: any[] = [];
  for (const l of input.lines) {
    let code = l.code || null, seed = l.product_seed_id || null, unit = l.unit || "ea", price = l.unit_price, desc = l.description || "";
    if (seed || code) {
      const p = await resolveProduct(env, { code: l.code, product_seed_id: l.product_seed_id });
      if (p) { seed = p.product_seed_id; code = p.code; if (!desc) desc = p.name; if (!l.unit) unit = p.unit || "ea"; if (price == null) price = p.price ?? 0; }
    }
    resolved.push({ product_seed_id: seed, code, description: desc, qty: Number(l.qty) || 1, unit, unit_price: Number(price) || 0 });
  }
  const q: any = {
    discount: input.discount || 0, discount_mode: input.discount_mode || "pct",
    freight: input.freight || 0, tax_pct: input.tax_pct || 0,
  };
  const t = computeTotals(q, resolved);

  const stmts: D1PreparedStatement[] = [
    env.DB.prepare(
      `INSERT INTO quotes (id,rev,seq,customer_org_seed_id,customer_name,customer_address,contact_name,contact_email,contact_phone,
         project,status,currency,quote_date,valid_until,prepared_by,scope,assumptions,payment_terms,delivery_terms,notes,
         discount,discount_mode,freight,tax_pct,subtotal,total,version,created_at,created_by,updated_at,updated_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      id, "R0", seq, input.customer_org_seed_id || null, input.customer_name, input.customer_address || null,
      input.contact_name || null, input.contact_email || null, input.contact_phone || null,
      input.project || null, input.status || "Draft", cur,
      input.quote_date || now.slice(0, 10), input.valid_until || null, input.prepared_by || user,
      input.scope || null, input.assumptions || null, input.payment_terms || null, input.delivery_terms || null, input.notes || null,
      q.discount, q.discount_mode, q.freight, q.tax_pct, t.subtotal, t.total, 1, now, user, now, user
    ),
  ];
  resolved.forEach((l, i) => stmts.push(env.DB.prepare(
    `INSERT INTO quote_lines (id,quote_id,line_no,product_seed_id,code,description,qty,unit,unit_price,line_total)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).bind(`${id}-L${i + 1}`, id, i + 1, l.product_seed_id, l.code, l.description, l.qty, l.unit, l.unit_price, l.qty * l.unit_price)));
  await env.DB.batch(stmts);
  return { id, currency: cur, subtotal: t.subtotal, total: t.total, lines: resolved };
}

export async function addLine(env: Env, quoteId: string, l: QuoteLineInput, user: string) {
  const q = await env.DB.prepare(`SELECT * FROM quotes WHERE id=?`).bind(quoteId).first<any>();
  if (!q) throw new Error("quote not found");
  let code = l.code || null, seed = l.product_seed_id || null, unit = l.unit || "ea", price = l.unit_price, desc = l.description || "";
  if (seed || code) {
    const p = await resolveProduct(env, { code: l.code, product_seed_id: l.product_seed_id });
    if (p) { seed = p.product_seed_id; code = p.code; if (!desc) desc = p.name; if (!l.unit) unit = p.unit || "ea"; if (price == null) price = p.price ?? 0; }
  }
  const qty = Number(l.qty) || 1, up = Number(price) || 0;
  const nrow = await env.DB.prepare(`SELECT COALESCE(MAX(line_no),0)+1 AS n FROM quote_lines WHERE quote_id=?`).bind(quoteId).first<any>();
  const lineNo = nrow?.n || 1;
  await env.DB.prepare(
    `INSERT INTO quote_lines (id,quote_id,line_no,product_seed_id,code,description,qty,unit,unit_price,line_total) VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).bind(`${quoteId}-L${lineNo}`, quoteId, lineNo, seed, code, desc, qty, unit, up, qty * up).run();
  return recomputeQuote(env, quoteId, user);
}

async function recomputeQuote(env: Env, quoteId: string, user: string) {
  const q = await env.DB.prepare(`SELECT * FROM quotes WHERE id=?`).bind(quoteId).first<any>();
  const { results: lines } = await env.DB.prepare(`SELECT * FROM quote_lines WHERE quote_id=? ORDER BY line_no`).bind(quoteId).all();
  const t = computeTotals(q, lines as any[]);
  await env.DB.prepare(`UPDATE quotes SET subtotal=?, total=?, updated_at=?, updated_by=?, version=version+1 WHERE id=?`)
    .bind(t.subtotal, t.total, nowISO(), user, quoteId).run();
  return { id: quoteId, subtotal: t.subtotal, total: t.total, lines };
}

export async function listQuotes(env: Env, status?: string) {
  const sql = `SELECT id, rev, customer_name, project, status, currency, total, quote_date,
     (SELECT COUNT(*) FROM quote_lines l WHERE l.quote_id=q.id) AS n_lines
     FROM quotes q ${status ? "WHERE status=?" : ""} ORDER BY created_at DESC LIMIT 100`;
  const stmt = status ? env.DB.prepare(sql).bind(status) : env.DB.prepare(sql);
  const { results } = await stmt.all();
  return results;
}
export async function getQuote(env: Env, id: string) {
  const quote = await env.DB.prepare(`SELECT * FROM quotes WHERE id=?`).bind(id).first();
  if (!quote) throw new Error("quote not found");
  const { results: lines } = await env.DB.prepare(`SELECT * FROM quote_lines WHERE quote_id=? ORDER BY line_no`).bind(id).all();
  return { quote, lines };
}
export async function setStatus(env: Env, id: string, status: string, user: string) {
  const ok = ["Draft", "Sent", "Accepted", "Declined", "Expired"];
  if (!ok.includes(status)) throw new Error("status must be one of " + ok.join(", "));
  const r = await env.DB.prepare(`UPDATE quotes SET status=?, updated_at=?, updated_by=?, version=version+1 WHERE id=?`)
    .bind(status, nowISO(), user, id).run();
  if (!r.meta.changes) throw new Error("quote not found");
  return { id, status };
}
