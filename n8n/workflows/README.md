# n8n workflows

Three GoHighLevel-facing workflows, matching `WORKFLOW_BY_ACTION` in
[`lib/n8n/types.ts`](../../lib/n8n/types.ts), plus one shared logging
workflow — these are the real "DO" layer when `N8N_ADAPTER=http`. When
`N8N_ADAPTER=mock` (the default), `MockN8nClient` in
[`lib/n8n/client.ts`](../../lib/n8n/client.ts) runs the equivalent
validate → call GHL → log contract in-process instead.

## Status: live, active, generic executor

All four workflows are **live and active in a real, connected n8n Cloud
account** (`vijaysharma04.app.n8n.cloud`), fully credentialed, and
live-tested end to end (including a real create → tag → delete round-trip
against GoHighLevel dispatched through these exact workflows).

| Workflow | n8n workflow ID | Production webhook URL | Handles |
|---|---|---|---|
| `execution-logger-workflow` | `l1AmbDI9rZG36jGx` | (called via Execute Sub-workflow, not a webhook) | shared logging sub-workflow |
| `ghl-contact-workflow` | `7fXGzZ3t5LDxmzEZ` | `.../webhook/ghl-contact-workflow` | all `*_CONTACT`, `*_CUSTOM_FIELD`, `*_CONVERSATION*`, `SEND_MESSAGE`, `LIST_CALENDARS` |
| `ghl-opportunity-workflow` | `3x7is9oXX7zk5IB7` | `.../webhook/ghl-opportunity-workflow` | all `*_OPPORTUNITY`, all `*_PIPELINE*` |
| `ghl-task-workflow` | `A50aS059Vd31QRz3` | `.../webhook/ghl-task-workflow` | all `*_TASK`, `ADD_NOTE` |

### Generic executor design

Each of the three GHL workflows follows the same shape:

```
Webhook (header-auth: X-Webhook-Secret)
  → Validate Input (Code node) — checks requestId/actionId/actionType/
     payload/ghlRequest are present, and that actionType is one this
     workflow is allowed to handle (a fixed list per workflow — defense in
     depth, not the only check)
  → GHL API Call (ONE generic HTTP Request node) — method, url, and body
     all come from `ghlRequest` in the incoming payload, which the Next.js
     backend already built via lib/actions/registry.ts. This node does not
     know or care which action type it's running; it just executes exactly
     what it was told, against services.leadconnectorhq.com with the
     project's GHL credential and the required `Version: 2021-07-28` header.
  → Log Execution (Execute Sub-workflow → execution-logger-workflow, which
     uses n8n's native Supabase node) — set to `continueRegularOutput` so a
     logging hiccup never swallows a successful GHL response (found and
     fixed during live testing: without this, a Supabase insert failure
     left the webhook returning an empty body even though the GHL call had
     already succeeded).
  → Respond to Webhook — reads the result explicitly from the `GHL API
     Call` node by name (`$('GHL API Call').item.json`), not from
     whatever node happens to run immediately before it, so the audit log's
     own success/failure never changes what the caller sees. Always
     responds HTTP 200; failure is signaled via the JSON body's own
     `ok:false`, since n8n Cloud's edge proxy replaces non-2xx bodies with
     a generic error page (confirmed live during earlier development).
```

**Why this design**: adding a new GoHighLevel action never requires
touching n8n. A new case in `buildGhlRequest()`
(`lib/actions/registry.ts`) plus one line in the relevant workflow's
`Validate Input` allowed-list is the entire change — no new HTTP node, no
new branch, no new workflow. This is how the registry grew from 7 actions
to 28 without creating a single new n8n workflow.

## Credentials (already attached)

- **Webhook auth**: `Header Auth account` (`X-Webhook-Secret` header,
  matching `N8N_WEBHOOK_SECRET`) — on each workflow's Webhook node.
- **GoHighLevel auth**: `Header Auth account 2` (`Authorization: Bearer
  <this project's own Private Integration Token>`) — on each workflow's
  `GHL API Call` node. **Never** the `Bearer Auth account` credential in
  this n8n instance — that belongs to a different project.
- **Supabase**: a native Supabase credential (project URL + service role
  key) on `execution-logger-workflow`'s `Insert into execution_logs` node.

To point this app at a different n8n instance: recreate the same three
credentials there, redeploy these workflow definitions (or rebuild them
following the shape above), and set `N8N_BASE_URL`/`N8N_WEBHOOK_SECRET` in
`.env.local`.

## Request/response contract

Every workflow receives the same shape from
[`HttpN8nClient`](../../lib/n8n/client.ts) (built by
`attachGhlRequest()`):

```json
{
  "requestId": "...",
  "actionId": "...",
  "actionType": "UPDATE_OPPORTUNITY",
  "payload": { "...": "..." },
  "ghlRequest": { "method": "PUT", "path": "/opportunities/abc123", "body": { "...": "..." } }
}
```

and responds `{ "ok": true, "response": { "...": "..." } }` on success, or
`{ "ok": false, "error": { "message": "...", "httpCode": 502 } }` on
failure — always HTTP 200; `HttpN8nClient` trusts the body's own `ok`
field over the HTTP status.

## A fifth, unrelated workflow

`Lead Qualification & CRM Sync` also exists in this same n8n account (an
AI lead-scoring + GHL sync pipeline built earlier). It is **not** part of
this action-registry architecture, is not referenced anywhere in this
codebase, and was left untouched.
