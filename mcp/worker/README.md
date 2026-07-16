# TSI-Intel remote MCP server (Cloudflare Worker)

This is the **web-console** build: a remote MCP server you deploy to Cloudflare
and add to **claude.ai** as a Custom Connector. It exposes the same 12 tools as
the local stdio server (`../src/index.js`) — they share `../src/tools.js` — so
pipeline reads/writes and reference search behave identically.

- Transport: MCP **Streamable HTTP** at `POST /mcp`
- Auth: a bearer token you set (`MCP_AUTH_TOKEN`), sent by claude.ai as a request header
- Data: calls the same `tsi-intel-api` Worker for the pipeline; bundles the
  `seed_*.json` reference data at build time

## Prerequisites

- A Cloudflare account + [`wrangler`](https://developers.cloudflare.com/workers/wrangler/) logged in (`npx wrangler login`)
- A Claude paid plan (Pro, Max, Team, or Enterprise). On Team/Enterprise, an
  Owner enables custom connectors in **Organization settings → Connectors**.

## Deploy

```bash
cd mcp/worker
npm install
npm test                                  # offline handler test (no network)

# Set a bearer token (this is what protects the endpoint). Pick a long random string:
npx wrangler secret put MCP_AUTH_TOKEN     # paste the token when prompted

npx wrangler deploy
```

`wrangler deploy` prints the URL, e.g.
`https://tsi-intel-mcp.teal-john.workers.dev`. Your MCP endpoint is that
URL **+ `/mcp`**.

Sanity check it's up (no token needed for health):

```bash
curl https://tsi-intel-mcp.teal-john.workers.dev/health
```

## Connect it in claude.ai (web)

1. In claude.ai: **Settings → Connectors → Add custom connector**
   (Team/Enterprise: **Organization settings → Connectors**).
2. **URL:** `https://tsi-intel-mcp.teal-john.workers.dev/mcp`
3. Open **Advanced settings → Request headers** and add one header:
   - Name: `Authorization`
   - Value: `Bearer <the MCP_AUTH_TOKEN you set>`
4. Save. The `tsi-intel` tools now appear in the connectors menu (🔌) in any chat.

Then ask, e.g. *"Using tsi-intel, show my open pipeline over $50M grouped by stage"*
or *"create a Dryer System opportunity for Newco Energy, ~$5M, 40%."*

## Configuration

Set as plain vars in `wrangler.jsonc`, or override per-deploy with `wrangler secret put`:

| Var | Default | Purpose |
| --- | --- | --- |
| `MCP_AUTH_TOKEN` | _(unset)_ | Bearer token required on every `/mcp` request. **If unset, the endpoint is open** — set it. |
| `TSI_WORKER_URL` | `https://tsi-intel-api.teal-john.workers.dev` | Backend the pipeline tools call |
| `TSI_USER` | `JT` | Attribution written to `createdBy`/`updatedBy` |
| `TSI_API_KEY` | _(unset)_ | Only if the backend enforces `X-TSI-Key` |

## Local dev

```bash
npx wrangler dev          # serves http://localhost:8787/mcp
```

## Security notes

- **Set `MCP_AUTH_TOKEN`.** Without it the endpoint — including pipeline
  writes/deletes — is reachable by anyone who knows the URL.
- Writes are live and shared: `create`/`update`/`delete` hit the production
  backend and show up in the app for everyone. Prefer `status: "L"` over deleting.
- Rotate the token any time with `npx wrangler secret put MCP_AUTH_TOKEN` and
  update the header in claude.ai.
