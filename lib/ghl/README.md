# GoHighLevel adapter layer

- `types.ts` — the `GhlClient` interface and request/response shapes,
  scoped to exactly the operations the allowlist needs (get/update contact,
  get/update opportunity, create task, add note).
- `client.ts` — `RealGhlClient` (verified against the live API — see below)
  and `MockGhlClient` (**MOCK MODE**, deterministic fake responses).
- `index.ts` — `getGhlClient()` factory, selecting via `GHL_ADAPTER`
  (`mock` default, `real` for the live API — requires
  `GHL_PRIVATE_INTEGRATION_TOKEN`). Presence of a token alone does not
  switch modes, so a demo never accidentally calls a real CRM.

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
```

This confirms the host is real and live, the `Version` header is required
and checked before auth, and `Authorization: Bearer <token>` is the auth
scheme (with GHL tokens being JWTs). Endpoint paths (`GET`/`PUT
/contacts/:id`, `PUT /opportunities/:id`, `POST /contacts/:id/tasks`,
`POST /contacts/:id/notes`) come from GoHighLevel's public API
documentation and were cross-checked for consistency across it.

The exact base URL and version header stay environment-configurable
(`GHL_API_BASE_URL`, `GHL_API_VERSION`) rather than hardcoded as
unconditional fact, since GoHighLevel can revise the version string over
time — see `.env.example`.

`RealGhlClient` never logs or returns the access token; error messages
include only the response body from GHL (truncated), never request
headers.
