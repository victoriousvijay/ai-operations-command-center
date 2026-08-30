/**
 * Single source of truth for actions the agent (or a file-upload plan) is
 * permitted to propose.
 *
 * This list is used in several places, independently:
 *   1. As the client-side "function tool" schema advertised to OpenClaw —
 *      the agent physically cannot propose a tool that isn't in this list.
 *   2. As a server-side allowlist check in the backend orchestration route,
 *      so the restriction does not depend solely on the agent's
 *      configuration or good behavior (defense in depth).
 *   3. As the key into lib/actions/registry.ts, which is the ONLY place
 *      that turns an action type into a real GoHighLevel HTTP request. The
 *      agent (or a parsed file) can never construct or influence a raw
 *      method/path/body itself — it can only select one of these labels
 *      and supply parameters, which the registry then validates and maps.
 *
 * Only actions verified live against this project's own GoHighLevel
 * Private Integration Token are listed here — see MUTATION_TIER below and
 * lib/actions/registry.ts's per-action comments for what was verified and
 * how. Actions that exist in GHL's API but are NOT reachable with the
 * currently granted scopes (pipeline create/update/delete, pipeline stage
 * create/update/delete — this token has pipelines READ but not WRITE) are
 * intentionally left out rather than pretended to work. See README.md's
 * "GHL scopes" section for exactly what is missing and how to grant it.
 *
 * Destructive actions (DELETE_CONTACT, DELETE_OPPORTUNITY, DELETE_TASK,
 * DELETE_CUSTOM_FIELD) are included, but MUTATION_TIER marks them
 * "destructive" — lib/orchestration/execute.ts refuses to run them without
 * an explicit confirm:true from the caller (see the confirmation flow in
 * that file and in app/components/Dashboard.tsx).
 */
export const ALLOWED_ACTIONS = [
  // Contacts
  "SEARCH_CONTACTS",
  "GET_CONTACT",
  "CREATE_CONTACT",
  "UPDATE_CONTACT",
  "UPSERT_CONTACT",
  "DELETE_CONTACT",
  "ADD_CONTACT_TAG",
  "REMOVE_CONTACT_TAG",
  // Opportunities
  "SEARCH_OPPORTUNITIES",
  "GET_OPPORTUNITY",
  "CREATE_OPPORTUNITY",
  "UPDATE_OPPORTUNITY",
  "DELETE_OPPORTUNITY",
  // Pipelines (read-only — see comment above)
  "LIST_PIPELINES",
  // Tasks
  "LIST_TASKS",
  "GET_TASK",
  "CREATE_TASK",
  "UPDATE_TASK",
  "DELETE_TASK",
  // Notes
  "ADD_NOTE",
  // Custom fields
  "LIST_CUSTOM_FIELDS",
  "CREATE_CUSTOM_FIELD",
  "UPDATE_CUSTOM_FIELD",
  "DELETE_CUSTOM_FIELD",
  // Conversations
  "SEARCH_CONVERSATIONS",
  "GET_CONVERSATION",
  "SEND_MESSAGE",
  // Calendars (read-only — no calendar exists in this location to test
  // appointment mutations against yet; see README.md)
  "LIST_CALENDARS",
] as const;

export type AllowedAction = (typeof ALLOWED_ACTIONS)[number];

export function isAllowedAction(action: string): action is AllowedAction {
  return (ALLOWED_ACTIONS as readonly string[]).includes(action);
}

/**
 * How much confirmation an action needs before it may execute, per
 * ARCHITECTURE.md's safety model:
 *   - "readonly": search/get/list — always safe to run directly.
 *   - "mutating": creates/updates — run after normal payload validation.
 *   - "destructive": deletes (or anything that reaches a real person, like
 *     SEND_MESSAGE) — lib/orchestration/execute.ts requires an explicit
 *     confirm:true before dispatching these, and the dashboard always shows
 *     an Approve/Cancel step for them.
 */
export const MUTATION_TIER: Record<AllowedAction, "readonly" | "mutating" | "destructive"> = {
  SEARCH_CONTACTS: "readonly",
  GET_CONTACT: "readonly",
  CREATE_CONTACT: "mutating",
  UPDATE_CONTACT: "mutating",
  UPSERT_CONTACT: "mutating",
  DELETE_CONTACT: "destructive",
  ADD_CONTACT_TAG: "mutating",
  REMOVE_CONTACT_TAG: "mutating",

  SEARCH_OPPORTUNITIES: "readonly",
  GET_OPPORTUNITY: "readonly",
  CREATE_OPPORTUNITY: "mutating",
  UPDATE_OPPORTUNITY: "mutating",
  DELETE_OPPORTUNITY: "destructive",

  LIST_PIPELINES: "readonly",

  LIST_TASKS: "readonly",
  GET_TASK: "readonly",
  CREATE_TASK: "mutating",
  UPDATE_TASK: "mutating",
  DELETE_TASK: "destructive",

  ADD_NOTE: "mutating",

  LIST_CUSTOM_FIELDS: "readonly",
  CREATE_CUSTOM_FIELD: "mutating",
  UPDATE_CUSTOM_FIELD: "mutating",
  DELETE_CUSTOM_FIELD: "destructive",

  SEARCH_CONVERSATIONS: "readonly",
  GET_CONVERSATION: "readonly",
  // Sends a real message to a real customer — always require confirmation
  // regardless of how the action was proposed.
  SEND_MESSAGE: "destructive",

  LIST_CALENDARS: "readonly",
};
