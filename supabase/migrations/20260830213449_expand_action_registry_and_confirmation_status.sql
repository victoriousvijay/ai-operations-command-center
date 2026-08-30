-- Expand automation_requests.status to support the human-approval gate for
-- destructive actions (see lib/orchestration/execute.ts).
alter table automation_requests drop constraint automation_requests_status_check;
alter table automation_requests add constraint automation_requests_status_check
  check (status in ('received', 'interpreting', 'awaiting_confirmation', 'executing', 'success', 'partial_failure', 'failed'));

-- Expand automation_actions.action_type to the full controlled action
-- registry (lib/actions/allowlist.ts). Destructive actions (DELETE_*,
-- SEND_MESSAGE) are now valid values here because they are gated by an
-- explicit human confirmation step in the orchestration layer instead of
-- being excluded from the schema entirely.
alter table automation_actions drop constraint automation_actions_action_type_check;
alter table automation_actions add constraint automation_actions_action_type_check
  check (action_type in (
    'SEARCH_CONTACTS', 'GET_CONTACT', 'CREATE_CONTACT', 'UPDATE_CONTACT', 'UPSERT_CONTACT', 'DELETE_CONTACT', 'ADD_CONTACT_TAG', 'REMOVE_CONTACT_TAG',
    'SEARCH_OPPORTUNITIES', 'GET_OPPORTUNITY', 'CREATE_OPPORTUNITY', 'UPDATE_OPPORTUNITY', 'DELETE_OPPORTUNITY',
    'LIST_PIPELINES',
    'LIST_TASKS', 'GET_TASK', 'CREATE_TASK', 'UPDATE_TASK', 'DELETE_TASK',
    'ADD_NOTE',
    'LIST_CUSTOM_FIELDS', 'CREATE_CUSTOM_FIELD', 'UPDATE_CUSTOM_FIELD', 'DELETE_CUSTOM_FIELD',
    'SEARCH_CONVERSATIONS', 'GET_CONVERSATION', 'SEND_MESSAGE',
    'LIST_CALENDARS'
  ));

comment on column automation_actions.action_type is
  'Constrained to the same controlled action registry enforced in application code (lib/actions/allowlist.ts, lib/actions/registry.ts) — a database-level defense-in-depth check, not the only one. Destructive actions (DELETE_*, SEND_MESSAGE) are valid here but require an explicit confirm:true from the caller before lib/orchestration/execute.ts will dispatch them (see its awaiting_confirmation flow).';
