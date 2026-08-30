# GoHighLevel adapter layer

- `types.ts` — the `GhlClient` interface and request/response shapes,
  scoped to exactly the operations the allowlist needs (get/update contact,
  search contacts, get/update opportunity, create task, add note).
- `client.ts` — `RealGhlClient` (verified against the live API — see below)
  and `MockGhlClient` (**MOCK MODE**, deterministic fake responses).
- `index.ts` — `getGhlClient()` factory, selecting via `GHL_ADAPTER`
  (`mock` default, `real` for the live API — requires
  `GHL_PRIVATE_INTEGRATION_TOKEN`). Presence of a token alone does not
  switch modes, so a demo never accidentally calls a real CRM.

## Real contact lookup by name/email

The mock agent (`lib/agent/mock-adapter.ts`) can't know a real GHL contact
ID — it synthesizes a placeholder like `mock-contact-john-smith` and tags
the payload with a `contactLookupHint` (the name or email it found in the
request text). Before any contact-touching action reaches `RealGhlClient`,
`lib/n8n/client.ts`'s `resolveContactId` — mirroring the "Find Contact"
step in the architecture's own n8n workflow design — resolves that hint
against `searchContacts` and swaps in the real ID it finds. If nothing
matches, or `GHL_LOCATION_ID` isn't configured, the action fails with a
specific, actionable message rather than a generic "not found" — and
either way, a real contact ID supplied directly (via the dashboard's
manual override field, or `contactIdOverride` on `POST /api/execute`)
skips resolution entirely and is used as-is.

## What was verified, and how

Before writing `RealGhlClient`, the base URL and required headers were
confirmed against the live API with direct HTTP requests (not just docs):

```
$ curl https://services.leadconnectorhq.com/contacts/test
{"statusCode":401,"message":"version header was not found."}

$ curl https://services.leadconnectorhq.com/contacts/test -H "Version: 2021-07-28"
{"statusCode":401,"message":"No Authorization header found for authentication!"}

$ curl https://services.leadconnectorhq.com/contacts/test -H "Version: 2021-07-28" -H "Authorization: Bearer x"
{"statusCode":401,"message":"Invalid JWT"}

$ curl https://services.leadconnectorhq.com/contacts/test -H "Version: 2021-07-28" -H "Authorization: Bearer pit-<a real Private Integration Token>"
{"error":"Contact with id test not found","status":400}
```

This confirms the host is real and live, the `Version` header is required
and checked before auth, and `Authorization: Bearer <token>` is the auth
scheme. One earlier assumption this corrected: a garbage bearer value
returns `"Invalid JWT"`, which reads like GHL tokens are JWTs — but a real
Private Integration Token (`pit-<uuid>`, not JWT-shaped) authenticates
fine, past that same error. `"Invalid JWT"` is just GHL's generic
malformed-credential message, not evidence of the token format — a
correction worth recording since it would have been easy to keep
believing the first, plausible-but-wrong inference.

Endpoint paths (`GET`/`PUT /contacts/:id`, `PUT /opportunities/:id`,
`POST /contacts/:id/tasks`, `POST /contacts/:id/notes`) come from
GoHighLevel's public API documentation and were cross-checked for
consistency across it. `POST /contacts/search` was confirmed live the same
way: an unscoped call returns `{"message":"The token does not have access
to this location."}` — a permission error, not a 404 — meaning the route
exists and only needs a valid `locationId`. This token's scope has no way
to introspect its own location (`/locations/search` and `/users/search`
both return 401 "not authorized for this scope"), so `GHL_LOCATION_ID`
must come from the GoHighLevel UI, not be guessed or derived.

The exact base URL and version header stay environment-configurable
(`GHL_API_BASE_URL`, `GHL_API_VERSION`) rather than hardcoded as
unconditional fact, since GoHighLevel can revise the version string over
time — see `.env.example`.

`RealGhlClient` never logs or returns the access token; error messages
include only the response body from GHL (truncated), never request
headers.
