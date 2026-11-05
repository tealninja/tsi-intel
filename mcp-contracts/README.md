# TSI Contracts: remote MCP connector

Lets Claude on claude.ai (your Pro/Max membership, no API key) read and update contract builder
deals, run reviews and record the results back into the dashboard at
`tsiprojects.bodhistoys.com/contractbuilder/`.

This is a **separate Worker (`tsi-contracts-mcp`) and a separate connector** from the TSI Intel
CRM connector (`tsi-intel-mcp`). Deploying it does not touch the CRM connector.

> Do not deploy anything from `../mcp/` for this. The live `tsi-intel-mcp` Worker is a different
> build from the code in that folder; deploying from there would replace the live CRM connector.

## Tools (13)

| Tool | What it does |
| --- | --- |
| `contract_list_deals`, `contract_get_deal`, `contract_create_deal` | Read and create deal sheets |
| `contract_update_deal` | Set levers, values, per-clause posture, concession-log entries |
| `contract_render` | The contract text of a deal (clean or working view) with issue counts |
| `contract_review_pack` | Checklist, deal, findings so far, scenarios and the clean text in one call |
| `contract_record_review`, `contract_list_reviews` | Overall review result (verdict, summary, report) |
| `contract_list_scenarios`, `contract_save_scenario` | The scenario library |
| `contract_record_run`, `contract_list_runs` | Scenario walk-throughs per deal |
| `contract_save_version` | Freeze a labelled version with its clean document |

## Set up (about 10 minutes)

You need Node and `wrangler` logged in to the Cloudflare account (`npx wrangler login`), the same
as for the other Workers.

**1. Make two secrets.** Any long random strings. In a terminal: `openssl rand -hex 32`, twice.
Call them TOKEN (service token) and SECRET (connector client secret). Keep them in your
password manager.

**2. Give the contract builder the service token.** Cloudflare dashboard: Workers & Pages,
`tsi-projects`, Settings, Variables and Secrets, Add, type Secret, name `CONTRACT_API_TOKEN`,
value TOKEN. (Or from the tsi-projects repo: `npx wrangler secret put CONTRACT_API_TOKEN`.)
Without it the connector cannot reach the deals.

**3. Deploy this Worker.**

```bash
cd mcp-contracts
npx wrangler deploy
```

It prints the URL, for example `https://tsi-contracts-mcp.teal-john.workers.dev`.

**4. Set its two secrets.**

```bash
npx wrangler secret put TSI_PROJECTS_TOKEN     # paste TOKEN (same value as step 2)
npx wrangler secret put OAUTH_CLIENT_SECRET    # paste SECRET
```

**5. Check it is up.** Open `<URL>/health`. Expect `{"status":"ok", ... "tools":13}`.

**6. Add it in claude.ai.** Settings, Connectors, Add custom connector.
- Name: `TSI Contracts`
- URL: `<URL>/mcp`
- Advanced settings: OAuth Client ID `tsi-contracts`, OAuth Client Secret = SECRET
- Add, then Connect. A page titled "TSI Contracts" opens: press **Allow access**.

**7. Try it.** In a new chat, switch the connector on and ask: *"List my contract deals."* Then:
*"Review deal testbal1 with contract_review_pack, record each scenario with contract_record_run
and the overall result with contract_record_review."* The results appear in the builder under
the deal's Review tab and Scenarios tab. The dashboard's **Run in Claude** button opens a chat
with exactly this prompt filled in.

## If something fails

| Symptom | Likely cause |
| --- | --- |
| Tools return `Error: 401 Sign in required` | `CONTRACT_API_TOKEN` on tsi-projects and `TSI_PROJECTS_TOKEN` here are not the same value |
| Tools return `TSI_PROJECTS_TOKEN secret is not set` | Step 4 not done, or done before the first deploy; run it again |
| claude.ai says it cannot connect or authorize | Client ID must be exactly `tsi-contracts`; the secret must match `OAUTH_CLIENT_SECRET`; URL must end in `/mcp` |
| The Allow access page says the request expired | Start Connect again from claude.ai (codes last five minutes) |
| Tools list is empty in a chat | Switch the connector on for that chat (the plug menu) |

To rotate: change the secret in both places with `wrangler secret put`; claude.ai asks you to
reconnect. Access tokens last 30 days.

## Develop and test

`npm test` runs an offline test of the OAuth flow (PKCE, redirect allow-list, code reuse), the
MCP protocol and every tool against a fake API. `npx wrangler dev` runs it locally.

Security notes: the Worker only talks to the contract builder API with the service token; the
authorize step only redirects to claude.ai or claude.com; authorization codes are single use,
last five minutes and are bound to a PKCE challenge; the client secret is required to exchange
a code.
