/**
 * Single source of truth for actions the agent is permitted to propose.
 *
 * This list is used in two places, independently:
 *   1. As the client-side "function tool" schema advertised to OpenClaw —
 *      the agent physically cannot propose a tool that isn't in this list.
 *   2. As a server-side allowlist check in the backend orchestration route
 *      (Phase 7), so the restriction does not depend solely on the agent's
 *      configuration or good behavior (defense in depth).
 *
 * Destructive actions (DELETE_CONTACT, DELETE_OPPORTUNITY, BULK_DELETE,
 * CHANGE_CREDENTIALS) are intentionally NOT included. They are out of scope
 * for this system's agent surface. If a destructive action is ever needed,
 * it must go through an explicit propose -> human approval -> execute gate,
 * never direct agent -> n8n execution.
 */
export const ALLOWED_ACTIONS = [
  "GET_CONTACT",
  "GET_OPPORTUNITY",
  "UPDATE_CONTACT",
  "UPDATE_OPPORTUNITY",
  "CREATE_TASK",
  "ADD_NOTE",
] as const;

export type AllowedAction = (typeof ALLOWED_ACTIONS)[number];

export function isAllowedAction(action: string): action is AllowedAction {
  return (ALLOWED_ACTIONS as readonly string[]).includes(action);
}
