import "server-only";
import { getSupabaseServerClient } from "../server";
import type { AllowedAction } from "@/lib/actions/allowlist";
import type { ActionStatus, AutomationAction } from "@/lib/types/domain";
import type { Json } from "../types";
import { mapAutomationAction } from "./mappers";

export async function createAutomationAction(params: {
  requestId: string;
  actionType: AllowedAction;
  payload: Record<string, unknown>;
  status?: ActionStatus;
}): Promise<AutomationAction> {
  const supabase = getSupabaseServerClient();

  const { data, error } = await supabase
    .from("automation_actions")
    .insert({
      request_id: params.requestId,
      action_type: params.actionType,
      payload: params.payload as Json,
      status: params.status ?? "proposed",
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(
      `Failed to create automation action: ${error?.message ?? "no row returned"}`,
    );
  }

  return mapAutomationAction(data);
}

export async function updateAutomationAction(
  id: string,
  updates: Partial<{
    status: ActionStatus;
    response: Record<string, unknown> | null;
    integrationId: string | null;
  }>,
): Promise<void> {
  const supabase = getSupabaseServerClient();
  const { error } = await supabase
    .from("automation_actions")
    .update({
      ...(updates.status !== undefined ? { status: updates.status } : {}),
      ...(updates.response !== undefined ? { response: updates.response as Json | null } : {}),
      ...(updates.integrationId !== undefined ? { integration_id: updates.integrationId } : {}),
    })
    .eq("id", id);

  if (error) {
    throw new Error(`Failed to update automation action ${id}: ${error.message}`);
  }
}
