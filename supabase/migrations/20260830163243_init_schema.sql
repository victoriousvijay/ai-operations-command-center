-- AI Operations Command Center — initial schema (Phase 2)
--
-- Tables: agents, integrations, automation_requests, automation_actions,
-- execution_logs, contacts_cache.
--
-- automation_requests / automation_actions / execution_logs / contacts_cache
-- are the tables required by the project architecture spec. agents and
-- integrations are additive: a registry of agent adapters and external
-- system connection metadata. No table in this migration stores secrets —
-- GoHighLevel credentials live only in n8n's own credential store, the
-- OpenClaw Gateway token and n8n webhook secret live only in environment
-- variables.

create extension if not exists pgcrypto;

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ─────────────────────────────────────────────────────────────────────────
-- agents — registry of agent adapters backing the reasoning layer.
-- ─────────────────────────────────────────────────────────────────────────
create table agents (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  adapter_type text not null check (adapter_type in ('openclaw', 'mock')),
  description text,
  config jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table agents is
  'Registry of agent adapters (OpenClaw or the mock dev fallback). Holds no credentials — only non-secret identification/config. Real credentials (e.g. OPENCLAW_GATEWAY_TOKEN) live in environment variables.';

create trigger agents_set_updated_at
  before update on agents
  for each row execute function set_updated_at();

create index agents_adapter_type_idx on agents (adapter_type);
create index agents_status_idx on agents (status);

-- ─────────────────────────────────────────────────────────────────────────
-- integrations — connection metadata for external systems (n8n, GHL).
-- ─────────────────────────────────────────────────────────────────────────
create table integrations (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  provider text not null check (provider in ('n8n', 'gohighlevel')),
  base_url text,
  status text not null default 'active' check (status in ('active', 'disabled', 'error')),
  last_checked_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table integrations is
  'Connection metadata for external systems (n8n, GoHighLevel). Holds no credentials — GoHighLevel credentials live only in n8n''s own credential store; n8n auth is a shared secret in N8N_WEBHOOK_SECRET.';

create trigger integrations_set_updated_at
  before update on integrations
  for each row execute function set_updated_at();

create index integrations_provider_idx on integrations (provider);
create index integrations_status_idx on integrations (status);

-- ─────────────────────────────────────────────────────────────────────────
-- automation_requests — one row per user request submitted to the dashboard.
-- ─────────────────────────────────────────────────────────────────────────
create table automation_requests (
  id uuid primary key default gen_random_uuid(),
  user_request text not null,
  status text not null default 'received'
    check (status in ('received', 'interpreting', 'executing', 'success', 'partial_failure', 'failed')),
  agent_id uuid references agents (id),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

comment on table automation_requests is
  'One row per natural-language request submitted to the command dashboard.';

create index automation_requests_status_idx on automation_requests (status);
create index automation_requests_created_at_idx on automation_requests (created_at desc);
create index automation_requests_agent_id_idx on automation_requests (agent_id);

-- ─────────────────────────────────────────────────────────────────────────
-- automation_actions — one row per action proposed by the agent.
-- ─────────────────────────────────────────────────────────────────────────
create table automation_actions (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references automation_requests (id) on delete cascade,
  action_type text not null
    check (action_type in ('GET_CONTACT', 'GET_OPPORTUNITY', 'UPDATE_CONTACT', 'UPDATE_OPPORTUNITY', 'CREATE_TASK', 'ADD_NOTE')),
  target_system text not null default 'gohighlevel' check (target_system in ('gohighlevel')),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'proposed'
    check (status in ('proposed', 'pending_approval', 'validated', 'executing', 'success', 'failed')),
  response jsonb,
  integration_id uuid references integrations (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table automation_actions is
  'One row per action proposed by the agent and (if validated) dispatched to n8n. action_type is constrained to the same allowlist enforced in application code (lib/actions/allowlist.ts) — a database-level defense-in-depth check, not the only one. Destructive actions (DELETE_*, BULK_DELETE, CHANGE_CREDENTIALS) are intentionally not valid values here.';

create trigger automation_actions_set_updated_at
  before update on automation_actions
  for each row execute function set_updated_at();

create index automation_actions_request_id_idx on automation_actions (request_id);
create index automation_actions_status_idx on automation_actions (status);
create index automation_actions_action_type_idx on automation_actions (action_type);
create index automation_actions_integration_id_idx on automation_actions (integration_id);

-- ─────────────────────────────────────────────────────────────────────────
-- execution_logs — one row per n8n workflow execution.
-- ─────────────────────────────────────────────────────────────────────────
create table execution_logs (
  id uuid primary key default gen_random_uuid(),
  request_id uuid references automation_requests (id) on delete cascade,
  action_id uuid references automation_actions (id) on delete cascade,
  workflow_name text not null,
  status text not null check (status in ('success', 'failed')),
  error_message text,
  duration_ms integer,
  created_at timestamptz not null default now()
);

comment on table execution_logs is
  'One row per n8n workflow execution, written by the Execution Logger workflow (Phase 3).';

create index execution_logs_request_id_idx on execution_logs (request_id);
create index execution_logs_action_id_idx on execution_logs (action_id);
create index execution_logs_status_idx on execution_logs (status);
create index execution_logs_created_at_idx on execution_logs (created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- contacts_cache — local reference cache of GHL contacts touched by the
-- system. Not a full mirror of GoHighLevel's contact database.
-- ─────────────────────────────────────────────────────────────────────────
create table contacts_cache (
  id uuid primary key default gen_random_uuid(),
  external_id text not null,
  name text,
  email text,
  source text not null default 'gohighlevel',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (external_id, source)
);

comment on table contacts_cache is
  'Local reference cache of GoHighLevel contacts touched by the system. Not a full mirror of GHL data.';

create trigger contacts_cache_set_updated_at
  before update on contacts_cache
  for each row execute function set_updated_at();

create index contacts_cache_email_idx on contacts_cache (email);

-- ─────────────────────────────────────────────────────────────────────────
-- Row Level Security
--
-- Every table is RLS-enabled with zero policies granted to the `anon` or
-- `authenticated` Postgres roles — this application has no end-user auth
-- model, so there is no safe basis for a permissive policy yet. This makes
-- every table fully inaccessible except via the `service_role` key, which
-- Supabase provisions with BYPASSRLS and which only server-side API routes
-- ever hold (see lib/supabase/server.ts). If a later phase adds direct
-- client-side reads via the anon key (e.g. a live-updating dashboard), add
-- narrow, explicit SELECT policies at that point — do not widen this
-- default without a specific access requirement driving it.
-- ─────────────────────────────────────────────────────────────────────────
alter table agents enable row level security;
alter table integrations enable row level security;
alter table automation_requests enable row level security;
alter table automation_actions enable row level security;
alter table execution_logs enable row level security;
alter table contacts_cache enable row level security;

-- ─────────────────────────────────────────────────────────────────────────
-- Seed data: default agent registry rows, so automation_requests.agent_id
-- has valid targets before Phase 5 builds real agent registration. Purely
-- descriptive metadata — no credentials.
-- ─────────────────────────────────────────────────────────────────────────
insert into agents (name, adapter_type, description, status) values
  ('mock-dev', 'mock', 'Deterministic local development fallback (MOCK MODE). Never used as a substitute for the real integration in production.', 'active'),
  ('openclaw-main', 'openclaw', 'Primary OpenClaw Gateway agent adapter.', 'active');
