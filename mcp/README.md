# TSI Quotes — Remote MCP Server

Chat with Claude on **claude.ai** to build and manage quotes, using your Claude
subscription (no API tokens). This is a Cloudflare Worker that exposes MCP tools
backed by the shared **D1** database (`tsi-intel`) — the same store the app and
API use, so quotes created here appear in the app's **Quotes** tab.

## Tools exposed

| Tool | What it does |
|------|--------------|
| `search_catalog` | Search the 131-item product catalog by text/category |
| `get_price_book` | Current D1 prices (seeded from the Biocarbon sample price list) |
| `create_quote` | Create a quote + lines; prices auto-fill from the price book; custom lines allowed |
| `add_quote_line` | Append a line to an existing quote, recompute totals |
| `list_quotes` / `get_quote` | Read quotes back |
| `set_quote_status` | Draft → Sent → Accepted / Declined / Expired |

Example prompt in claude.ai once connected:
> *"Build a quote for Idemitsu — 5 tons of high-torrefied chips, proximate +
> calorific testing on 2 samples, and sealed super sacks. Standard Biocarbon
> terms."* → Claude calls `get_price_book` + `create_quote` and returns the
> quote number and total.

## Architecture

`OAuthProvider` (from `@cloudflare/workers-oauth-provider`) wraps the MCP handler
(`TsiQuotesMCP.serve("/mcp")`, an `McpAgent` Durable Object). The OAuth library
handles the protocol (dynamic client registration, tokens, PKCE) that claude.ai
needs; `src/index.ts`'s `AuthHandler` only supplies the **login step** — a shared
password gate. Quote/price logic lives in `src/db.ts` and mirrors
`worker.js`'s `/api/quotes` (totals recomputed server-side).

## Deploy

> Prereqs: Node 18+, `wrangler` logged in to the Cloudflare account that owns the
> `tsi-intel` D1 database. This is a **separate Worker** from the static site — it
> does not affect the app deploy.

```bash
cd mcp
npm install

# 1) KV for the OAuth grant/token store — paste the id into wrangler.jsonc
wrangler kv namespace create OAUTH_KV

# 2) Shared login password (kept out of git)
wrangler secret put MCP_LOGIN_PASSWORD

# 3) Deploy
npm run deploy   # → https://tsi-intel-mcp.<subdomain>.workers.dev
```

If the `agents` / `@modelcontextprotocol/sdk` / `workers-oauth-provider` versions
have moved since this was written, run `npm install <pkg>@latest` for the three —
the tool code in `src/db.ts` is framework-agnostic and won't change.

## Connect it in claude.ai

1. **Settings → Connectors → Add custom connector** (Pro/Max/Team/Enterprise;
   Team/Enterprise require an Owner).
2. URL: `https://tsi-intel-mcp.<subdomain>.workers.dev/mcp`
3. Claude opens the login page → enter the `MCP_LOGIN_PASSWORD` → authorize.
4. Start a chat and ask Claude to build a quote. Tools appear under the connector.

## Auth options (pick per your security needs)

- **Shared password (default here)** — simplest; the password is the only guard.
- **Cloudflare Access managed OAuth** *(recommended for production)* — put this
  Worker behind a Zero Trust Access application and validate the Access JWT;
  Cloudflare handles per-user identity (Google/email OTP/etc.). See Cloudflare's
  "Secure MCP servers with Access". Then you can drop the password gate.
- **GitHub/Google upstream OAuth** — swap `AuthHandler` for the upstream-IdP
  variant from Cloudflare's remote-MCP OAuth demo.

## Security notes

- The Worker is public; the password (or Access) is the only barrier — treat the
  secret like a production credential and rotate it if shared.
- Every tool call recomputes quote totals server-side; client math is never trusted.
- Writes go straight to the production `tsi-intel` D1. Consider a staging D1 for testing.
