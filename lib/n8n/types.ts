import type { AllowedAction } from "@/lib/actions/allowlist";
import type { GhlRequestTemplate } from "@/lib/actions/registry";

/**
 * Contract between the backend and the n8n execution layer. This is the
 * same JSON shape the real n8n webhooks (n8n/workflows/*.json) accept and
 * return — the mock adapter in mock-adapter.ts implements this contract
 * in-process so the pipeline is testable without a live n8n instance.
 *
 * `ghlRequest` is the pre-built, fully-resolved GoHighLevel HTTP request
 * (see lib/actions/registry.ts) — the real n8n workflows execute exactly
 * this and nothing else; n8n never decides what to call.
 */
export interface N8nExecuteRequest {
  requestId: string;
  actionId: string;
  actionType: AllowedAction;
  payload: Record<string, unknown>;
  ghlRequest: GhlRequestTemplate;
}

export interface N8nExecuteResult {
  ok: boolean;
  workflowName: string;
  durationMs: number;
  response?: Record<string, unknown>;
  error?: string;
}

/**
 * Maps an allowed action to the n8n workflow that owns it. Each of these
 * three workflows now contains one generic, credentialed "GHL API Call"
 * HTTP Request node that executes whatever `ghlRequest` it's given — so
 * adding a new action here never requires a new n8n workflow or a new
 * branch inside one, only a case in lib/actions/registry.ts's
 * buildGhlRequest(). See n8n/workflows/README.md for the workflow design.
 */
export const WORKFLOW_BY_ACTION: Record<AllowedAction, string> = {
  SEARCH_CONTACTS: "ghl-contact-workflow",
  GET_CONTACT: "ghl-contact-workflow",
  CREATE_CONTACT: "ghl-contact-workflow",
  UPDATE_CONTACT: "ghl-contact-workflow",
  UPSERT_CONTACT: "ghl-contact-workflow",
  DELETE_CONTACT: "ghl-contact-workflow",
  ADD_CONTACT_TAG: "ghl-contact-workflow",
  REMOVE_CONTACT_TAG: "ghl-contact-workflow",
  ASSIGN_LEAD: "ghl-contact-workflow",
  LIST_CUSTOM_FIELDS: "ghl-contact-workflow",
  CREATE_CUSTOM_FIELD: "ghl-contact-workflow",
  UPDATE_CUSTOM_FIELD: "ghl-contact-workflow",
  DELETE_CUSTOM_FIELD: "ghl-contact-workflow",
  SEARCH_CONVERSATIONS: "ghl-contact-workflow",
  GET_CONVERSATION: "ghl-contact-workflow",
  SEND_MESSAGE: "ghl-contact-workflow",
  LIST_CALENDARS: "ghl-contact-workflow",
  CREATE_CALENDAR: "ghl-contact-workflow",
  DELETE_CALENDAR: "ghl-contact-workflow",
  SEARCH_APPOINTMENTS: "ghl-contact-workflow",
  GET_APPOINTMENT: "ghl-contact-workflow",
  CREATE_APPOINTMENT: "ghl-contact-workflow",
  UPDATE_APPOINTMENT: "ghl-contact-workflow",
  DELETE_APPOINTMENT: "ghl-contact-workflow",
  LIST_WORKFLOWS: "ghl-contact-workflow",
  ADD_CONTACT_TO_WORKFLOW: "ghl-contact-workflow",
  REMOVE_CONTACT_FROM_WORKFLOW: "ghl-contact-workflow",
  LIST_CAMPAIGNS: "ghl-contact-workflow",

  SEARCH_OPPORTUNITIES: "ghl-opportunity-workflow",
  GET_OPPORTUNITY: "ghl-opportunity-workflow",
  CREATE_OPPORTUNITY: "ghl-opportunity-workflow",
  UPDATE_OPPORTUNITY: "ghl-opportunity-workflow",
  DELETE_OPPORTUNITY: "ghl-opportunity-workflow",
  LIST_PIPELINES: "ghl-opportunity-workflow",
  CREATE_PIPELINE: "ghl-opportunity-workflow",
  UPDATE_PIPELINE: "ghl-opportunity-workflow",
  DELETE_PIPELINE: "ghl-opportunity-workflow",
  CREATE_PIPELINE_STAGE: "ghl-opportunity-workflow",
  UPDATE_PIPELINE_STAGE: "ghl-opportunity-workflow",
  DELETE_PIPELINE_STAGE: "ghl-opportunity-workflow",

  LIST_TASKS: "ghl-task-workflow",
  GET_TASK: "ghl-task-workflow",
  CREATE_TASK: "ghl-task-workflow",
  UPDATE_TASK: "ghl-task-workflow",
  DELETE_TASK: "ghl-task-workflow",
  ADD_NOTE: "ghl-task-workflow",
};

export interface N8nClient {
  execute(request: N8nExecuteRequest): Promise<N8nExecuteResult>;
}
