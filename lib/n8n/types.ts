import type { AllowedAction } from "@/lib/actions/allowlist";

/**
 * Contract between the backend and the n8n execution layer. This is the
 * same JSON shape the real n8n webhooks (n8n/workflows/*.json) accept and
 * return — the mock adapter in mock-adapter.ts implements this contract
 * in-process so the pipeline is testable without a live n8n instance.
 */
export interface N8nExecuteRequest {
  requestId: string;
  actionId: string;
  actionType: AllowedAction;
  payload: Record<string, unknown>;
}

export interface N8nExecuteResult {
  ok: boolean;
  workflowName: string;
  durationMs: number;
  response?: Record<string, unknown>;
  error?: string;
}

/**
 * Maps an allowed action to the n8n workflow that owns it, per the modular
 * workflow design in ARCHITECTURE.md.
 */
export const WORKFLOW_BY_ACTION: Record<AllowedAction, string> = {
  GET_CONTACT: "ghl-contact-workflow",
  UPDATE_CONTACT: "ghl-contact-workflow",
  GET_OPPORTUNITY: "ghl-opportunity-workflow",
  UPDATE_OPPORTUNITY: "ghl-opportunity-workflow",
  CREATE_TASK: "ghl-task-workflow",
  ADD_NOTE: "ghl-task-workflow",
};

export interface N8nClient {
  execute(request: N8nExecuteRequest): Promise<N8nExecuteResult>;
}
