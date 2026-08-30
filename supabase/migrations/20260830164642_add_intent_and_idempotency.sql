-- AI Operations Command Center — extend automation_requests for the
-- orchestration pipeline (Phase 3+): the agent's interpreted intent
-- (e.g. "CRM_UPDATE", shown on the dashboard) and an optional
-- idempotency key so a client-supplied key prevents duplicate execution
-- of the same logical request.

alter table automation_requests
  add column intent text,
  add column idempotency_key text;

-- Partial unique index: only enforced when a caller actually supplies a
-- key. Requests without one (the common case for the plain dashboard
-- form) are unaffected.
create unique index automation_requests_idempotency_key_idx
  on automation_requests (idempotency_key)
  where idempotency_key is not null;

comment on column automation_requests.intent is
  'Agent-interpreted intent label (e.g. CRM_UPDATE), set once the agent has responded.';
comment on column automation_requests.idempotency_key is
  'Optional caller-supplied key. A repeated request with the same key returns the original result instead of re-executing.';
