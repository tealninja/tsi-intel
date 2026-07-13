# TSI-Intel MCP server

An [MCP](https://modelcontextprotocol.io) server that lets Claude work with the
TSI-Intel app directly — read and edit the sales **pipeline (opportunities)** on
the live `tsi-intel-api` Worker, and search the **accounts / contacts /
products** reference data.

## Two ways to run it

Both expose the **same 12 tools** (defined once in `src/tools.js`):

| Where you use Claude | Run this | How to connect |
| --- | --- | --- |
| **Claude Desktop / Claude Code** (local) | this package — stdio server (`src/index.js`) | see [Setup](#setup) below |
| **claude.ai (web console)** | the Cloudflare Worker in [`worker/`](worker/README.md) — remote server | add its URL as a Custom Connector |

The web console can only talk to a **remote** MCP server (a public HTTPS
endpoint), so a local stdio process won't do — deploy the Worker for that. See
[`worker/README.md`](worker/README.md).

## What it can and can't touch

| Data | Where it lives | This server |
| --- | --- | --- |
| **Pipeline / opportunities** | `tsi-intel-api` Cloudflare Worker (shared) | **read + write** — edits round-trip to the app for everyone |
| **Bugs** | same Worker (`/api/bugs`) | read + append |
| **Accounts / contacts / products** | each browser's `localStorage`, seeded from `seed_*.json` | **read-only search** |

> The app keeps accounts, contacts and products in the browser's `localStorage`,
> not on the Worker — so an MCP server has nothing live to write to. Those tools
> serve the repo's `seed_*.json` exports for lookup; edits there would not sync
> anywhere. The pipeline is the one shared, mutable store, and it's fully
> read/write here.

## Tools

**Pipeline (live):**
- `list_opportunities` — filter by account, category, status, stage, lead, tag,
  country, value range, free-text; returns rows + count/total/weighted totals
- `get_opportunity` — full record by id
- `pipeline_summary` — totals and weighted (value × probability) value, optionally
  grouped by stage / category / status / lead / account / country / source
- `create_opportunity` — create + save (auto-generates an id from the account)
- `update_opportunity` — partial update; preserves other fields, bumps version
- `delete_opportunity` — delete (requires `confirm: true`)

**Reference (read-only):**
- `search_accounts`, `get_account` (with child sites + linked contacts)
- `search_contacts`
- `search_products`

**Bugs:** `list_bugs`, `report_bug`

## Setup

```bash
cd mcp
npm install
npm test        # offline smoke test (no Worker needed)
```

Requires Node 18+.

### Configuration (environment variables)

| Var | Default | Purpose |
| --- | --- | --- |
| `TSI_WORKER_URL` | `https://tsi-intel-api.teal-john.workers.dev` | The API Worker base URL |
| `TSI_USER` | `JT` | Your initials — written to `createdBy`/`updatedBy` and the `X-TSI-User` header |
| `TSI_API_KEY` | _(empty)_ | Only if the Worker enforces `X-TSI-Key` |
| `TSI_SEED_DIR` | repo root | Folder holding the `seed_*.json` files (auto-detected) |

### Claude Desktop

Add to `claude_desktop_config.json`
(macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "tsi-intel": {
      "command": "node",
      "args": ["/absolute/path/to/tsi-intel/mcp/src/index.js"],
      "env": { "TSI_USER": "JT" }
    }
  }
}
```

Restart Claude Desktop. The tools appear under the 🔌 menu.

### Claude Code

```bash
claude mcp add tsi-intel -- node /absolute/path/to/tsi-intel/mcp/src/index.js
```

or add to `.mcp.json` at the repo root:

```json
{
  "mcpServers": {
    "tsi-intel": {
      "command": "node",
      "args": ["mcp/src/index.js"],
      "env": { "TSI_USER": "JT" }
    }
  }
}
```

## Try it

Once connected, ask Claude things like:

- "Show me my open pipeline over $50M, grouped by stage."
- "What's the weighted value of everything ZS leads?"
- "Bump the Alfanar FEED opportunity to 90% probability and move it to Negotiation."
- "Create a new Dryer System opportunity for Newco Energy, ~$5M, 40%."
- "Who's the contact at Drax and what's the SKU for the register burner?"

## Notes

- **Writes are live and shared.** `create`/`update`/`delete` hit the production
  Worker and show up in the app for everyone. Prefer setting `status: "L"` (lost)
  over deleting.
- Concurrency: the Worker may reject an update with **409** if the record changed
  underneath you; re-read and retry.
- The value field is raw currency units (e.g. `9000000` = $9M).
