import type {
  Agent,
  AutomationAction,
  AutomationRequest,
  CachedContact,
  ExecutionLog,
  Integration,
} from "@/lib/types/domain";
import type {
  AgentRow,
  AutomationActionRow,
  AutomationRequestRow,
  ContactsCacheRow,
  ExecutionLogRow,
  IntegrationRow,
} from "../types";

export function mapAgent(row: AgentRow): Agent {
  return {
    id: row.id,
    name: row.name,
    adapterType: row.adapter_type,
    description: row.description,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapIntegration(row: IntegrationRow): Integration {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    baseUrl: row.base_url,
    status: row.status,
    lastCheckedAt: row.last_checked_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapAutomationRequest(row: AutomationRequestRow): AutomationRequest {
  return {
    id: row.id,
    userRequest: row.user_request,
    status: row.status,
    agentId: row.agent_id,
    intent: row.intent,
    idempotencyKey: row.idempotency_key,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

export function mapAutomationAction(row: AutomationActionRow): AutomationAction {
  return {
    id: row.id,
    requestId: row.request_id,
    actionType: row.action_type,
    targetSystem: row.target_system,
    payload: (row.payload as Record<string, unknown>) ?? {},
    status: row.status,
    response: (row.response as Record<string, unknown> | null) ?? null,
    integrationId: row.integration_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapExecutionLog(row: ExecutionLogRow): ExecutionLog {
  return {
    id: row.id,
    requestId: row.request_id,
    actionId: row.action_id,
    workflowName: row.workflow_name,
    status: row.status,
    errorMessage: row.error_message,
    durationMs: row.duration_ms,
    createdAt: row.created_at,
  };
}

export function mapContact(row: ContactsCacheRow): CachedContact {
  return {
    id: row.id,
    externalId: row.external_id,
    name: row.name,
    email: row.email,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
