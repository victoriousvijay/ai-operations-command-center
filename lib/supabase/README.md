# Supabase client layer

- `types.ts` — hand-authored `Database` types (including `Relationships`
  metadata for embedded-select typing), kept in sync with
  `supabase/migrations/*.sql`.
- `server.ts` — server-only client using `SUPABASE_SERVICE_ROLE_KEY`
  (bypasses RLS). Guarded by the `server-only` package so importing it from
  client code fails at build time.
- `browser.ts` — anon-key client for future client-side use. Not imported
  anywhere yet — every table denies the `anon` role via RLS until a later
  phase adds explicit policies.
- `queries/` — typed query helpers, one file per table domain:
  `requests.ts`, `actions.ts`, `logs.ts`, `agents.ts`, `integrations.ts`,
  `contacts.ts`, plus `mappers.ts` (row → domain type conversion) and an
  `index.ts` barrel export. Used by `app/api/*` route handlers and
  `lib/orchestration/execute.ts`.

All Supabase access in this app happens server-side — there is no direct
client-side Supabase access wired up.
