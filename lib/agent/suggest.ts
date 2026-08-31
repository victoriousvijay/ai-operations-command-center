import "server-only";
import { getAgentAdapter } from "@/lib/agent";
import type { AllowedAction } from "@/lib/actions/allowlist";

export interface CommandSuggestion {
  /** Plain-English restatement of the structured action, for the user to confirm before it runs. */
  label: string;
  type: AllowedAction;
  payload: Record<string, unknown>;
}

/**
 * Turns loose, casual English into one or more candidate structured
 * commands the user picks from before anything executes — this is the
 * "refine my sentence into a real command" feature. It does NOT invent a
 * new agent API: it reuses the exact same AgentAdapter.propose() contract
 * (OpenClaw's verified OpenResponses tool-calling, or the deterministic
 * mock parser) every other part of this app already uses. The only new
 * thing is *how* the request is framed for a real OpenClaw Gateway: it's
 * told that if the instruction is genuinely ambiguous, it should call
 * more than one candidate tool instead of silently guessing a single one
 * — each resulting function_call becomes one selectable suggestion here,
 * rather than a sequential multi-step plan (this endpoint proposes; it
 * never executes more than the one action the user actually selects).
 *
 * The mock adapter has no real understanding, so wrapping its input in
 * extra instructional prose would only reduce its (already narrow) regex
 * match rate — it gets the user's raw text unchanged, and returns
 * whatever single interpretation (or none) it finds.
 */
export async function suggestCommands(userRequest: string): Promise<CommandSuggestion[]> {
  const agent = getAgentAdapter();
  const input = agent.isMock
    ? userRequest
    : `A user typed this instruction for a CRM automation tool: "${userRequest}"\n\n` +
      `If it could reasonably map to more than one of your available actions, call up to 3 of the ` +
      `most plausible ones so a human can pick the correct one — never silently guess a single ` +
      `interpretation when the instruction is genuinely ambiguous. If it is unambiguous, call just ` +
      `the one correct action. Never call an action the instruction doesn't actually support.`;

  const proposal = await agent.propose(input);
  return proposal.actions.map((action) => ({
    label: describeAction(action.type, action.payload),
    type: action.type,
    payload: action.payload,
  }));
}

/** Plain-English summary of a structured action, for the suggestion picker. */
function describeAction(type: AllowedAction, p: Record<string, unknown>): string {
  const who = (p.contactLookupHint as string) || (p.contactId as string) || "the contact";
  const firstTag = Array.isArray(p.tags) ? (p.tags[0] as string) : undefined;

  switch (type) {
    case "SEARCH_CONTACTS":
      return `Search contacts for "${p.query}"`;
    case "GET_CONTACT":
      return `Look up ${who}'s contact details`;
    case "CREATE_CONTACT":
      return `Create a new contact${p.name ? ` for ${p.name}` : p.email ? ` (${p.email})` : ""}`;
    case "UPDATE_CONTACT":
      return `Update ${who}'s contact details`;
    case "UPSERT_CONTACT":
      return `Create or update a contact${p.name ? ` for ${p.name}` : p.email ? ` (${p.email})` : ""}`;
    case "DELETE_CONTACT":
      return `Delete ${who}'s contact — destructive, needs confirmation`;
    case "ADD_CONTACT_TAG":
      return `Add the "${firstTag ?? "?"}" tag to ${who}`;
    case "REMOVE_CONTACT_TAG":
      return `Remove the "${firstTag ?? "?"}" tag from ${who}`;
    case "ASSIGN_LEAD":
      return `Assign ${who} to ${p.assignedToNameHint ?? p.assignedToUserId ?? "?"}`;
    case "SEARCH_OPPORTUNITIES":
      return `Search ${who}'s opportunities`;
    case "GET_OPPORTUNITY":
      return `Look up opportunity ${p.opportunityId}`;
    case "CREATE_OPPORTUNITY":
      return `Create an opportunity for ${who}${p.stageNameHint ? ` in stage "${p.stageNameHint}"` : ""}${p.pipelineNameHint ? ` (${p.pipelineNameHint})` : ""}${p.monetaryValue ? `, worth ${p.monetaryValue}` : ""}`;
    case "UPDATE_OPPORTUNITY":
      return typeof p.bulkPipelineNameHint === "string"
        ? `Move all opportunities in "${p.bulkPipelineNameHint}" to "${p.stageNameHint ?? "?"}"`
        : `Move ${who}'s opportunity to "${p.stageNameHint ?? p.name ?? "?"}"`;
    case "DELETE_OPPORTUNITY":
      return `Delete ${who}'s opportunity — destructive, needs confirmation`;
    case "LIST_PIPELINES":
      return "List all pipelines";
    case "CREATE_PIPELINE":
      return `Create a new pipeline "${p.name}" with stages: ${Array.isArray(p.stages) ? (p.stages as Array<{ name: string }>).map((s) => s.name).join(", ") : "?"}`;
    case "UPDATE_PIPELINE":
      return `Rename pipeline "${p.pipelineNameHint ?? p.pipelineId}" to "${p.name}"`;
    case "DELETE_PIPELINE":
      return `Delete pipeline "${p.pipelineNameHint ?? p.pipelineId}" — destructive, needs confirmation`;
    case "CREATE_PIPELINE_STAGE":
      return `Add a "${p.stageName}" stage to pipeline "${p.pipelineNameHint ?? p.pipelineId}"`;
    case "UPDATE_PIPELINE_STAGE":
      return `Rename stage "${p.stageNameHint}" to "${p.newStageName}" in "${p.pipelineNameHint ?? p.pipelineId}"`;
    case "DELETE_PIPELINE_STAGE":
      return `Remove stage "${p.stageNameHint}" from "${p.pipelineNameHint ?? p.pipelineId}" — destructive, needs confirmation`;
    case "LIST_TASKS":
      return `List ${who}'s tasks`;
    case "GET_TASK":
      return `Look up task ${p.taskId} for ${who}`;
    case "CREATE_TASK":
      return `Create a task for ${who}: "${p.title ?? ""}"`;
    case "UPDATE_TASK":
      return `Update task ${p.taskId} for ${who}`;
    case "DELETE_TASK":
      return `Delete task ${p.taskId} for ${who} — destructive, needs confirmation`;
    case "ADD_NOTE":
      return `Add a note to ${who}: "${typeof p.body === "string" ? p.body.slice(0, 60) : ""}"`;
    case "LIST_CUSTOM_FIELDS":
      return "List all custom fields";
    case "CREATE_CUSTOM_FIELD":
      return `Create a custom field "${p.name}"`;
    case "UPDATE_CUSTOM_FIELD":
      return `Rename custom field ${p.customFieldId} to "${p.name}"`;
    case "DELETE_CUSTOM_FIELD":
      return `Delete custom field ${p.customFieldId} — destructive, needs confirmation`;
    case "SEARCH_CONVERSATIONS":
      return `Search ${who}'s conversations`;
    case "GET_CONVERSATION":
      return `Look up conversation ${p.conversationId}`;
    case "SEND_MESSAGE":
      return `Send a ${p.type ?? "SMS"} to ${who}: "${typeof p.message === "string" ? p.message.slice(0, 60) : ""}" — destructive, needs confirmation`;
    case "LIST_CALENDARS":
      return "List all calendars";
    case "CREATE_CALENDAR":
      return `Create a new calendar "${p.name}"`;
    case "DELETE_CALENDAR":
      return `Delete calendar "${p.calendarNameHint ?? p.calendarId}" — destructive, needs confirmation`;
    case "SEARCH_APPOINTMENTS":
      return `List appointments on "${p.calendarNameHint ?? p.calendarId}"`;
    case "GET_APPOINTMENT":
      return `Look up appointment ${p.appointmentId}`;
    case "CREATE_APPOINTMENT":
      return `Book an appointment for ${who} on "${p.calendarNameHint ?? p.calendarId}"${p.startTime ? ` at ${p.startTime}` : ""}`;
    case "UPDATE_APPOINTMENT":
      return p.appointmentStatus === "cancelled"
        ? `Cancel appointment ${p.appointmentId}`
        : `Reschedule appointment ${p.appointmentId}${p.startTime ? ` to ${p.startTime}` : ""}`;
    case "DELETE_APPOINTMENT":
      return `Delete appointment ${p.appointmentId} — destructive, needs confirmation`;
    default:
      return `${type}`;
  }
}
