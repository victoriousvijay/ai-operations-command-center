# n8n client layer

- `types.ts` — the `N8nExecuteRequest`/`N8nExecuteResult` contract shared
  with the real n8n workflows in `n8n/workflows/`, plus
  `WORKFLOW_BY_ACTION` mapping each allowed action to its workflow.
- `validation.ts` — per-action zod payload schemas. In production these
  validations run inside the n8n workflow itself; `MockN8nClient` runs the
  same schemas in-process so validation is genuinely exercised locally.
- `client.ts` — `HttpN8nClient` (real, POSTs to an authenticated n8n
  webhook) and `MockN8nClient` (runs validate → call GHL → respond
  in-process, calling the same `lib/ghl` adapter a real n8n workflow
  would call).
- `index.ts` — `getN8nClient()` factory, selecting via `N8N_ADAPTER`
  (`mock` default, `http` for a real instance — requires `N8N_BASE_URL`
  and `N8N_WEBHOOK_SECRET`).

GoHighLevel credentials never pass through this module — `MockN8nClient`
calls `lib/ghl`'s adapter (which holds them, mock or real), and
`HttpN8nClient` only ever sends `requestId`/`actionId`/`actionType`/
`payload` plus the shared webhook secret; the real GHL token lives only in
n8n's own credential store on the other side of that webhook.
