/**
 * Domain types for the automation pipeline, mirroring the Supabase schema
 * in supabase/migrations/*.sql. These are our own application types
 * (camelCase), not a third-party API contract.
 */
import type { AllowedAction } from "@/lib/actions/allowlist";

export type RequestStatus =
  | "received"
  | "interpreting"
  | "executing"
  | "success"
  | "partial_failure"
  | "failed";

export type ActionStatus =
  | "proposed"
  | "pending_approval"
  | "validated"
  | "executing"
  | "success"
  | "failed";

export type AgentAdapterType = "openclaw" | "mock";
export type AgentStatus = "active" | "disabled";

export interface Agent {
  id: string;
  name: string;
  adapterType: AgentAdapterType;
  description: string | null;
  status: AgentStatus;
  createdAt: string;
  updatedAt: string;
}

export type IntegrationProvider = "n8n" | "gohighlevel";
export type IntegrationStatus = "active" | "disabled" | "error";

export interface Integration {
  id: string;
  name: string;
  provider: IntegrationProvider;
  baseUrl: string | null;
  status: IntegrationStatus;
  lastCheckedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationRequest {
  id: string;
  userRequest: string;
  status: RequestStatus;
  agentId: string | null;
  intent: string | null;
  idempotencyKey: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface AutomationAction {
  id: string;
  requestId: string;
  actionType: AllowedAction;
  targetSystem: "gohighlevel";
  payload: Record<string, unknown>;
  status: ActionStatus;
  response: Record<string, unknown> | null;
  integrationId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExecutionLog {
  id: string;
  requestId: string | null;
  actionId: string | null;
  workflowName: string;
  status: "success" | "failed";
  errorMessage: string | null;
  durationMs: number | null;
  createdAt: string;
}

export interface CachedContact {
  id: string;
  externalId: string;
  name: string | null;
  email: string | null;
  source: string;
  createdAt: string;
  updatedAt: string;
}

/** Proposed action from the agent, before allowlist validation or execution. */
export interface ProposedAction {
  type: AllowedAction;
  payload: Record<string, unknown>;
}

/** What the agent (THINK layer) returns for a user request. */
export interface AgentProposal {
  intent: string;
  actions: ProposedAction[];
}

/** One action's outcome in the final structured API response. */
export interface ExecutedActionResult {
  type: AllowedAction;
  status: ActionStatus;
  error?: string;
}

/** Structured response shape for POST /api/execute, matching the architecture spec. */
export interface ExecuteResult {
  requestId: string;
  status: RequestStatus;
  intent: string | null;
  actions: ExecutedActionResult[];
}
