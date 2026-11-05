// TSI Intel — remote MCP server (Cloudflare Worker + D1).
// Lets you build/read quotes by chatting with Claude on claude.ai via a custom
// connector — no API tokens, just your Claude subscription.
//
// Shape follows Cloudflare's documented pattern:
//   OAuthProvider({ apiHandlers: { "/mcp": TsiQuotesMCP.serve("/mcp") }, ... })
// The OAuth library handles the protocol (dynamic client registration, token
// issuance, PKCE); we only supply the login step (defaultHandler below).

import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { z } from "zod";
import {
  Env, money, searchCatalog, getPriceBook, createQuote, addLine,
  listQuotes, getQuote, setStatus,
} from "./db";

type Props = { user: string };
const APP_URL = "https://tsi-intel.teal-john.workers.dev"; // static app (for deep links)

function jtext(obj: unknown) { return { content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }] }; }
function jerr(e: unknown) { return { content: [{ type: "text" as const, text: "Error: " + (e instanceof Error ? e.message : String(e)) }], isError: true }; }

export class TsiQuotesMCP extends McpAgent<Env, unknown, Props> {
  server = new McpServer({ name: "TSI Quotes", version: "1.0.0" });

  async init() {
    const env = this.env;
    const user = () => (this.props?.user || "claude");

    this.server.tool(
      "search_catalog",
      "Search the TSI product catalog (131 items across 21 categories). Returns code, name, category and list price where set.",
      { query: z.string().optional().describe("free text — matches code, name, or category"),
        category: z.string().optional().describe("exact category, e.g. 'Torrefaction Samples'"),
        limit: z.number().optional() },
      async (a) => { try { return jtext(await searchCatalog(env, a)); } catch (e) { return jerr(e); } }
    );

    this.server.tool(
      "get_price_book",
      "Return the current D1 price book (products that have a price), seeded from the Biocarbon sample price list. Use this so quotes carry real numbers.",
      { category: z.string().optional() },
      async (a) => { try { return jtext(await getPriceBook(env, a.category)); } catch (e) { return jerr(e); } }
    );

    this.server.tool(
      "create_quote",
      "Create a new customer quote (header + line items) in the database. Prices auto-fill from the price book when unit_price is omitted; lines with no code/product_seed_id are custom lines. Returns the quote number and total.",
      {
        customer_name: z.string(),
        contact_name: z.string().optional(), contact_email: z.string().optional(),
        project: z.string().optional(), currency: z.enum(["USD", "EUR", "GBP", "CAD"]).optional(),
        lines: z.array(z.object({
          code: z.string().optional().describe("catalog code e.g. TS-011; omit for a custom line"),
          product_seed_id: z.string().optional(),
          description: z.string().optional(),
          qty: z.number(),
          unit: z.string().optional(),
          unit_price: z.number().optional().describe("omit to auto-fill from the price book"),
        })).min(1),
        discount: z.number().optional(), discount_mode: z.enum(["pct", "abs"]).optional(),
        freight: z.number().optional(), tax_pct: z.number().optional(),
        scope: z.string().optional(), assumptions: z.string().optional(),
        payment_terms: z.string().optional(), delivery_terms: z.string().optional(), notes: z.string().optional(),
      },
      async (a) => {
        try {
          const r = await createQuote(env, a as any, user());
          return { content: [{ type: "text", text: `Created ${r.id} — total ${money(r.total, r.currency)} (${r.lines.length} lines).\nView: ${APP_URL}/#quotes\n\n` + JSON.stringify(r, null, 2) }] };
        } catch (e) { return jerr(e); }
      }
    );

    this.server.tool(
      "add_quote_line",
      "Add one line item to an existing quote and return the recomputed totals.",
      { quote_id: z.string(), code: z.string().optional(), product_seed_id: z.string().optional(),
        description: z.string().optional(), qty: z.number(), unit: z.string().optional(), unit_price: z.number().optional() },
      async (a) => { try { const { quote_id, ...l } = a; return jtext(await addLine(env, quote_id, l, user())); } catch (e) { return jerr(e); } }
    );

    this.server.tool(
      "list_quotes",
      "List quotes (most recent first), optionally filtered by status.",
      { status: z.enum(["Draft", "Sent", "Accepted", "Declined", "Expired"]).optional() },
      async (a) => { try { return jtext(await listQuotes(env, a.status)); } catch (e) { return jerr(e); } }
    );

    this.server.tool(
      "get_quote",
      "Fetch one quote with all its line items by quote number (e.g. QUO-00001-AB12CD).",
      { id: z.string() },
      async (a) => { try { return jtext(await getQuote(env, a.id)); } catch (e) { return jerr(e); } }
    );

    this.server.tool(
      "set_quote_status",
      "Change a quote's status (Draft, Sent, Accepted, Declined, Expired).",
      { id: z.string(), status: z.enum(["Draft", "Sent", "Accepted", "Declined", "Expired"]) },
      async (a) => { try { return jtext(await setStatus(env, a.id, a.status, user())); } catch (e) { return jerr(e); } }
    );
  }
}

// ── OAuth login (defaultHandler) ────────────────────────────────────────
// Minimal shared-password gate. The OAuth library (env.OAUTH_PROVIDER) does the
// protocol; we only prove "who is connecting". Swap for GitHub/Google upstream
// or Cloudflare Access if you want per-user identity (see README).
const loginPage = (qs: string, err = "") => `<!doctype html><html><head><meta charset="utf-8">
<title>TSI Quotes — Connect</title><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:system-ui,sans-serif;background:#19446C;color:#fff;display:grid;place-items:center;height:100vh;margin:0}
.card{background:#fff;color:#404040;padding:28px 30px;border-radius:10px;width:320px;box-shadow:0 8px 30px rgba(0,0,0,.3)}
h1{font-size:17px;color:#19446C;margin:0 0 4px}p{font-size:12px;color:#888;margin:0 0 18px}
input{width:100%;padding:10px;border:1px solid #ccc;border-radius:6px;font-size:14px;margin-bottom:12px;box-sizing:border-box}
button{width:100%;padding:11px;background:#00929F;color:#fff;border:0;border-radius:6px;font-size:14px;font-weight:600;cursor:pointer}
.err{color:#C05234;font-size:12px;margin-bottom:10px}</style></head>
<body><form class="card" method="POST" action="/authorize?${qs}">
<h1>Connect to TSI Quotes</h1><p>Enter the shared access password to link this connector to Claude.</p>
${err ? `<div class="err">${err}</div>` : ""}
<input type="password" name="password" placeholder="Access password" autofocus>
<button type="submit">Authorize</button></form></body></html>`;

const AuthHandler = {
  async fetch(request: Request, env: Env & { OAUTH_PROVIDER: any }): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/") return new Response("TSI Quotes MCP server. Connect via /mcp in an MCP client.", { status: 200 });
    if (url.pathname !== "/authorize") return new Response("Not found", { status: 404 });

    const qs = url.searchParams.toString();
    if (request.method === "GET") {
      return new Response(loginPage(qs), { headers: { "Content-Type": "text/html" } });
    }
    // POST — verify password, then complete the OAuth authorization.
    const form = await request.formData();
    const pass = String(form.get("password") || "");
    const expected = env.MCP_LOGIN_PASSWORD || "";
    if (!expected || pass !== expected) {
      return new Response(loginPage(qs, expected ? "Incorrect password." : "Server missing MCP_LOGIN_PASSWORD secret."), {
        status: 401, headers: { "Content-Type": "text/html" },
      });
    }
    const oauthReq = await env.OAUTH_PROVIDER.parseAuthRequest(request);
    const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
      request: oauthReq,
      userId: "tsi",
      metadata: { label: "TSI Quotes" },
      scope: oauthReq.scope,
      props: { user: "tsi" } as Props,
    });
    return Response.redirect(redirectTo, 302);
  },
};

export default new OAuthProvider({
  apiHandlers: { "/mcp": TsiQuotesMCP.serve("/mcp") as any },
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
  defaultHandler: AuthHandler as any,
});
