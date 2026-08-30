# n8n workflows

Four modular workflows, matching `WORKFLOW_BY_ACTION` in
[`lib/n8n/types.ts`](../../lib/n8n/types.ts) and the architecture's
THINK/DO split — these are the real "DO" layer when `N8N_ADAPTER=http`.
When `N8N_ADAPTER=mock` (the default), `MockN8nClient` in
[`lib/n8n/client.ts`](../../lib/n8n/client.ts) runs the equivalent
validate → call GHL → log contract in-process instead.

## Status: actually deployed, credentials pending

These four workflows are **live in a real, connected n8n Cloud account**
(`vijaysharma04.app.n8n.cloud`) — built via the n8n MCP server, not just
exported as static files. They are currently **inactive** because no
credentials are attached yet. The JSON files here are an exact snapshot of
what's deployed.

| Workflow | n8n workflow ID | Production webhook URL | Handles |
|---|---|---|---|
| `execution-logger-workflow` | `l1AmbDI9rZG36jGx` | (called via Execute Sub-workflow, not a webhook) | shared logging sub-workflow |
| `ghl-contact-workflow` | `7fXGzZ3t5LDxmzEZ` | `.../webhook/ghl-contact-workflow` | `GET_CONTACT`, `UPDATE_CONTACT` |
| `ghl-opportunity-workflow` | `3x7is9oXX7zk5IB7` | `.../webhook/ghl-opportunity-workflow` | `GET_OPPORTUNITY`, `UPDATE_OPPORTUNITY` |
| `ghl-task-workflow` | `A50aS059Vd31QRz3` | `.../webhook/ghl-task-workflow` | `CREATE_TASK`, `ADD_NOTE` |

Each of the three GHL workflows follows: Webhook (header-auth) → validate
input (Code node) → branch on action type (If node) → call the matching
GoHighLevel endpoint (`services.leadconnectorhq.com`, verified live — see
[`lib/ghl/README.md`](../../lib/ghl/README.md)) → call
`execution-logger-workflow` (Execute Sub-workflow node) → respond with
structured JSON (Respond to Webhook node). `execution-logger-workflow`
itself uses n8n's native **Supabase node** (not a raw HTTP call) to insert
into `execution_logs`.

## To finish setup (3 remaining steps)

1. **n8n Webhook Shared Secret** — a Header Auth credential attached to
   each workflow's Webhook node. Create one credential named
   "n8n Webhook Shared Secret" with a header value matching this app's
   `N8N_WEBHOOK_SECRET`, then attach it to the Webhook node in all three
   GHL workflows (they were created referencing this credential by name;
   n8n will prompt you to select/create it).
2. **GoHighLevel Bearer Token** — a Header Auth credential (`Authorization:
   Bearer <your Private Integration token>`) attached to the six GHL
   `HTTP Request` nodes across the three workflows. **Note**: this n8n
   instance's credential validation may reject a plain Header Auth
   credential for a Bearer scheme — if so, use a **Custom Auth** /
   templated credential instead, with template
   `{"headers":{"Authorization":"Bearer {{api_key}}"}}`, and repoint each
   HTTP Request node's `genericAuthType` to `httpTemplatedCustomAuth`.
3. **Supabase** — a native Supabase credential (project URL + service role
   key) attached to the `Insert into execution_logs` node in
   `execution-logger-workflow`.

Then activate all four workflows, and set in this app's `.env.local`:
`N8N_ADAPTER=http`, `N8N_BASE_URL=https://vijaysharma04.app.n8n.cloud`,
`N8N_WEBHOOK_SECRET=<the value from step 1>`.

## Request/response contract

Every workflow receives the same shape from
[`HttpN8nClient`](../../lib/n8n/client.ts):

```json
{ "requestId": "...", "actionId": "...", "actionType": "UPDATE_OPPORTUNITY", "payload": { "...": "..." } }
```

and responds with `{ "ok": true, "response": { "...": "..." } }`, or a
non-2xx status on failure — `HttpN8nClient` treats any non-2xx response as
a failed execution and records the response body as the error.
