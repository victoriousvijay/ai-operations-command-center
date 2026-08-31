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
 * how. Pipeline create/update/delete were blocked by scope until this
 * token was granted pipeline write access — verified live afterward with a
 * real create → rename+add-stage → delete round-trip (see
 * lib/ghl/client.ts's class doc comment for the one real API quirk found
 * doing that: PUT requires the full stages array every time).
 *
 * Destructive actions (DELETE_CONTACT, DELETE_OPPORTUNITY, DELETE_TASK,
 * DELETE_CUSTOM_FIELD, DELETE_PIPELINE, DELETE_PIPELINE_STAGE) are
 * included, but MUTATION_TIER marks them "destructive" —
 * lib/orchestration/execute.ts refuses to run them without an explicit
 * confirm:true from the caller (see the confirmation flow in that file and
 * in app/components/Dashboard.tsx).
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
  "ASSIGN_LEAD",
  // Opportunities
  "SEARCH_OPPORTUNITIES",
  "GET_OPPORTUNITY",
  "CREATE_OPPORTUNITY",
  "UPDATE_OPPORTUNITY",
  "DELETE_OPPORTUNITY",
  // Pipelines
  "LIST_PIPELINES",
  "CREATE_PIPELINE",
  "UPDATE_PIPELINE",
  "DELETE_PIPELINE",
  "CREATE_PIPELINE_STAGE",
  "UPDATE_PIPELINE_STAGE",
  "DELETE_PIPELINE_STAGE",
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
  // Calendars
  "LIST_CALENDARS",
  "CREATE_CALENDAR",
  "DELETE_CALENDAR",
  // Appointments — full create/reschedule/cancel/delete verified live
  // against a real, temporary calendar (see lib/ghl/client.ts's class doc
  // comment for the one real API quirk: POST requires
  // ignoreFreeSlotValidation:true unless the calendar has real open hours
  // configured, or GHL rejects every slot as unavailable).
  "SEARCH_APPOINTMENTS",
  "GET_APPOINTMENT",
  "CREATE_APPOINTMENT",
  "UPDATE_APPOINTMENT",
  "DELETE_APPOINTMENT",
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
  ASSIGN_LEAD: "mutating",

  SEARCH_OPPORTUNITIES: "readonly",
  GET_OPPORTUNITY: "readonly",
  CREATE_OPPORTUNITY: "mutating",
  UPDATE_OPPORTUNITY: "mutating",
  DELETE_OPPORTUNITY: "destructive",

  LIST_PIPELINES: "readonly",
  CREATE_PIPELINE: "mutating",
  UPDATE_PIPELINE: "mutating",
  DELETE_PIPELINE: "destructive",
  CREATE_PIPELINE_STAGE: "mutating",
  UPDATE_PIPELINE_STAGE: "mutating",
  // Removing a stage can strand opportunities that were sitting in it —
  // treat as destructive even though it isn't a delete of the pipeline itself.
  DELETE_PIPELINE_STAGE: "destructive",

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
  CREATE_CALENDAR: "mutating",
  // Removing a calendar removes every appointment booked on it too.
  DELETE_CALENDAR: "destructive",

  SEARCH_APPOINTMENTS: "readonly",
  GET_APPOINTMENT: "readonly",
  CREATE_APPOINTMENT: "mutating",
  // Covers both reschedule (new start/end time) and cancel
  // (appointmentStatus: "cancelled") — neither erases the record, unlike
  // DELETE_APPOINTMENT, so this stays "mutating" not "destructive".
  UPDATE_APPOINTMENT: "mutating",
  DELETE_APPOINTMENT: "destructive",
};
