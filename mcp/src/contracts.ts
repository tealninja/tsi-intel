// Contract builder tools for the TSI MCP server. They call the contract builder API on
// tsiprojects.bodhistoys.com (api/contractbuilder.js in the tsi-projects repo) with a
// service token, so the deal sheets, rendered documents, scenarios and walk-through runs
// live in one place (D1 "tsi-contracts"). Secrets on this Worker:
//   wrangler secret put TSI_PROJECTS_TOKEN   (same value as CONTRACT_API_TOKEN on tsi-projects)
// Optional var: TSI_PROJECTS_URL (default https://tsiprojects.bodhistoys.com).

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

type CEnv = { TSI_PROJECTS_URL?: string; TSI_PROJECTS_TOKEN?: string };

function jtext(obj: unknown) { return { content: [{ type: "text" as const, text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 2) }] }; }
function jerr(e: unknown) { return { content: [{ type: "text" as const, text: "Error: " + (e instanceof Error ? e.message : String(e)) }], isError: true }; }

async function api(env: CEnv, path: string, init?: RequestInit): Promise<any> {
  if (!env.TSI_PROJECTS_TOKEN) throw new Error("TSI_PROJECTS_TOKEN secret is not set on this Worker");
  const base = (env.TSI_PROJECTS_URL || "https://tsiprojects.bodhistoys.com").replace(/\/$/, "");
  const r = await fetch(base + "/api/contractbuilder" + path, {
    ...init,
    headers: { Authorization: "Bearer " + env.TSI_PROJECTS_TOKEN, "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${text.slice(0, 300)}`);
  try { return JSON.parse(text); } catch { return text; }
}

export function registerContractTools(server: McpServer, env: CEnv) {
  server.tool(
    "contract_list_deals",
    "List the deal sheets in the TSI contract builder (id, name, buyer, posture, depth, packaging, last update, saved version count).",
    {},
    async () => { try { return jtext(await api(env, "/deals")); } catch (e) { return jerr(e); } }
  );

  server.tool(
    "contract_get_deal",
    "Return one deal sheet in full: levers (posture, depth, packaging), every set value, per-clause posture overrides, concession log and custom clauses.",
    { deal_id: z.string() },
    async (a) => { try { return jtext(await api(env, `/deals/${encodeURIComponent(a.deal_id)}`)); } catch (e) { return jerr(e); } }
  );

  server.tool(
    "contract_render",
    "Render a deal as the contract text (clean view: what the buyer would see) or the working view (with rationale and drafting notes). Returns the text plus a count of blanks, reserved sections and dangling references. Use the clean view for scenario walk-throughs and consistency checks.",
    { deal_id: z.string(), view: z.enum(["clean", "working"]).optional() },
    async (a) => {
      try {
        const r = await api(env, `/deals/${encodeURIComponent(a.deal_id)}/render?view=${a.view || "clean"}`);
        return jtext(`Deal ${r.name || r.id} — ${r.posture} / ${r.depth} / ${r.packaging}\nIssues: ${JSON.stringify(r.issues)}\n\n${r.text}`);
      } catch (e) { return jerr(e); }
    }
  );

  server.tool(
    "contract_update_deal",
    "Change a deal sheet: set levers, set or clear values (pass null to clear), override a clause's posture, or add a concession-log entry. Only the fields given are changed. Values must use the variable names from the deal sheet (see contract_get_deal).",
    {
      deal_id: z.string(),
      name: z.string().optional(), buyer_name: z.string().optional(),
      posture: z.enum(["seller", "balanced", "buyer"]).optional(),
      depth: z.enum(["light", "standard", "full"]).optional(),
      packaging: z.enum(["exhibits", "integrated"]).optional(),
      values: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional().describe("variable name → value; null clears"),
      overrides: z.record(z.union([z.enum(["seller", "balanced", "buyer"]), z.null()])).optional().describe("section id → posture; null removes the override"),
      concession: z.object({ section: z.string(), title: z.string().optional(), from: z.string(), to: z.string(), reason: z.string() }).optional(),
    },
    async (a) => {
      try {
        const deal = await api(env, `/deals/${encodeURIComponent(a.deal_id)}`);
        for (const k of ["name", "buyer_name", "posture", "depth", "packaging"] as const) if (a[k] !== undefined) (deal as any)[k] = a[k];
        deal.values = deal.values || {}; deal.overrides = deal.overrides || {}; deal.concessions = deal.concessions || [];
        for (const [k, v] of Object.entries(a.values || {})) { if (v === null) delete deal.values[k]; else deal.values[k] = v; }
        for (const [k, v] of Object.entries(a.overrides || {})) { if (v === null) delete deal.overrides[k]; else deal.overrides[k] = v; }
        if (a.concession) deal.concessions.push({ ...a.concession, at: new Date().toISOString() });
        deal.updatedAt = new Date().toISOString();
        await api(env, `/deals/${encodeURIComponent(a.deal_id)}`, { method: "PUT", body: JSON.stringify(deal) });
        return jtext({ ok: true, deal_id: a.deal_id, posture: deal.posture, depth: deal.depth, packaging: deal.packaging, values_set: Object.keys(deal.values).length });
      } catch (e) { return jerr(e); }
    }
  );

  server.tool(
    "contract_create_deal",
    "Create a new deal sheet with defaults (balanced / standard / exhibits) and return its id. Set values afterwards with contract_update_deal.",
    { name: z.string(), buyer_name: z.string().optional(), posture: z.enum(["seller", "balanced", "buyer"]).optional(), depth: z.enum(["light", "standard", "full"]).optional(), packaging: z.enum(["exhibits", "integrated"]).optional() },
    async (a) => {
      try {
        const id = Math.random().toString(36).slice(2, 10);
        const now = new Date().toISOString();
        const deal = { id, name: a.name, buyer_name: a.buyer_name || "", seller_name: "Teal Sales Incorporated dba TSI", posture: a.posture || "balanced", depth: a.depth || "standard", packaging: a.packaging || "exhibits", values: {}, overrides: {}, concessions: [], notes: "", createdAt: now, updatedAt: now };
        await api(env, `/deals/${id}`, { method: "PUT", body: JSON.stringify(deal) });
        return jtext({ ok: true, deal_id: id });
      } catch (e) { return jerr(e); }
    }
  );

  server.tool(
    "contract_list_scenarios",
    "List the saved test scenarios (real situations kept as told and as condensed, with what TSI expects the contract to do). Walk these through a rendered deal and record the outcome with contract_record_run.",
    {},
    async () => { try { return jtext(await api(env, "/scenarios")); } catch (e) { return jerr(e); } }
  );

  server.tool(
    "contract_save_scenario",
    "Create or update a test scenario. Keep the situation as John told it; the condensed statement is the concise version agreed with him; expectation is what TSI expects the contract to do.",
    { scenario_id: z.string().optional().describe("omit to create"), title: z.string(), situation: z.string(), condensed: z.string(), expectation: z.string().optional(), tags: z.string().optional(), source: z.string().optional() },
    async (a) => {
      try {
        const id = a.scenario_id || Math.random().toString(36).slice(2, 10);
        await api(env, `/scenarios/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(a) });
        return jtext({ ok: true, scenario_id: id });
      } catch (e) { return jerr(e); }
    }
  );

  server.tool(
    "contract_record_run",
    "Record the outcome of walking one scenario through a deal: which clauses apply in what order, what each party owes, and whether TSI would accept the outcome at this posture. The verdict is one of acceptable, gap, ambiguous, not_balanced, not_computable. The run appears in the builder under the deal's Scenarios tab.",
    { deal_id: z.string(), scenario_id: z.string(), verdict: z.enum(["acceptable", "gap", "ambiguous", "not_balanced", "not_computable"]), report: z.string(), version_id: z.number().optional() },
    async (a) => { try { return jtext(await api(env, `/deals/${encodeURIComponent(a.deal_id)}/runs`, { method: "POST", body: JSON.stringify(a) })); } catch (e) { return jerr(e); } }
  );

  server.tool(
    "contract_list_runs",
    "List the scenario walk-throughs recorded for a deal, newest first.",
    { deal_id: z.string() },
    async (a) => { try { return jtext(await api(env, `/deals/${encodeURIComponent(a.deal_id)}/runs`)); } catch (e) { return jerr(e); } }
  );

  server.tool(
    "contract_save_version",
    "Freeze the current deal sheet and its clean document as a labelled version (for example before sending to the buyer).",
    { deal_id: z.string(), label: z.string() },
    async (a) => {
      try {
        const r = await api(env, `/deals/${encodeURIComponent(a.deal_id)}/render?view=clean&format=html`);
        return jtext(await api(env, `/deals/${encodeURIComponent(a.deal_id)}/versions`, { method: "POST", body: JSON.stringify({ label: a.label, html: typeof r === "string" ? r : "" }) }));
      } catch (e) { return jerr(e); }
    }
  );
}
