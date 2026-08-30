# Agent adapter layer (THINK)

- `types.ts` — the `AgentAdapter` interface: `propose(userRequest)` returns
  an intent label and a list of proposed actions. An agent adapter never
  calls GoHighLevel, n8n, or Supabase, and holds none of their credentials.
- `mock-adapter.ts` — **MOCK MODE**. A deterministic, regex/keyword-based
  stand-in for real reasoning, used so the pipeline is demonstrable without
  a live OpenClaw Gateway. Not natural-language understanding — documented
  limitations are in the file's own comments. Never a substitute for the
  real integration in production.
- `openclaw-adapter.ts` — the real adapter. Calls a live OpenClaw Gateway's
  OpenResponses-compatible `POST /v1/responses` endpoint (verified against
  `docs.openclaw.ai/gateway/openresponses-http-api`), advertising exactly
  the six allowed actions in `lib/actions/allowlist.ts` as client-side
  function tools. OpenClaw can only ever propose one of those six — it has
  no other tool to call.
- `index.ts` — `getAgentAdapter()` factory, selecting via `AGENT_ADAPTER`
  (`mock` default, `openclaw` for a real Gateway — requires
  `OPENCLAW_GATEWAY_URL` and `OPENCLAW_GATEWAY_TOKEN`).

## What's verified vs. assumed

Verified directly from OpenClaw's published docs: the request shape
(`model`, `input`, `tools`, `tool_choice`), the auth header, and the
function-calling contract (a `function_call` output item per tool call).
**Not shown** in OpenClaw's own docs: a full example of the non-streaming
response envelope. Since OpenClaw documents itself as "OpenResponses-
compatible" (the same API family as OpenAI's Responses API),
`openclaw-adapter.ts` parses the standard `output` array shape from that
spec — and throws a clear, specific error if a live Gateway's response
doesn't match, rather than silently returning no actions. Verify against a
real Gateway before relying on this in production.
