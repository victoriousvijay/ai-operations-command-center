import "server-only";
import { getSupabaseServerClient } from "../server";
import type { AgentAdapterType, AutomationAction, AutomationRequest, RequestStatus } from "@/lib/types/domain";
import { mapAutomationAction, mapAutomationRequest } from "./mappers";

export async function findAutomationRequestByIdempotencyKey(
  idempotencyKey: string,
): Promise<AutomationRequest | null> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("automation_requests")
    .select("*")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to look up idempotency key: ${error.message}`);
  }

  return data ? mapAutomationRequest(data) : null;
}

export async function createAutomationRequest(params: {
  userRequest: string;
  agentAdapterType: AgentAdapterType;
  idempotencyKey?: string | null;
}): Promise<AutomationRequest> {
  const supabase = getSupabaseServerClient();

  const { data: agent, error: agentError } = await supabase
    .from("agents")
    .select("id")
    .eq("adapter_type", params.agentAdapterType)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  if (agentError) {
    throw new Error(`Failed to resolve agent: ${agentError.message}`);
  }

  const { data, error } = await supabase
    .from("automation_requests")
    .insert({
      user_request: params.userRequest,
      status: "received",
      agent_id: agent?.id ?? null,
      idempotency_key: params.idempotencyKey ?? null,
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(
      `Failed to create automation request: ${error?.message ?? "no row returned"}`,
    );
  }

  return mapAutomationRequest(data);
}

export async function updateAutomationRequest(
  id: string,
  updates: Partial<{
    status: RequestStatus;
    intent: string | null;
    completedAt: string | null;
  }>,
): Promise<void> {
  const supabase = getSupabaseServerClient();
  const { error } = await supabase
    .from("automation_requests")
    .update({
      ...(updates.status !== undefined ? { status: updates.status } : {}),
      ...(updates.intent !== undefined ? { intent: updates.intent } : {}),
      ...(updates.completedAt !== undefined ? { completed_at: updates.completedAt } : {}),
    })
    .eq("id", id);

  if (error) {
    throw new Error(`Failed to update automation request ${id}: ${error.message}`);
  }
}

export async function listAutomationRequests(
  params: { limit?: number } = {},
): Promise<Array<AutomationRequest & { actions: AutomationAction[] }>> {
  const supabase = getSupabaseServerClient();

  const { data, error } = await supabase
    .from("automation_requests")
    .select("*, automation_actions(*)")
    .order("created_at", { ascending: false })
    .limit(params.limit ?? 50);

  if (error) {
    throw new Error(`Failed to list automation requests: ${error.message}`);
  }

  return (data ?? []).map((row) => {
    const { automation_actions, ...requestRow } = row;
    return {
      ...mapAutomationRequest(requestRow),
      actions: (automation_actions ?? []).map(mapAutomationAction),
    };
  });
}

export async function getAutomationRequestById(
  id: string,
): Promise<(AutomationRequest & { actions: AutomationAction[] }) | null> {
  const supabase = getSupabaseServerClient();

  const { data, error } = await supabase
    .from("automation_requests")
    .select("*, automation_actions(*)")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load automation request ${id}: ${error.message}`);
  }
  if (!data) return null;

  const { automation_actions, ...requestRow } = data;
  return {
    ...mapAutomationRequest(requestRow),
    actions: (automation_actions ?? []).map(mapAutomationAction),
  };
}
