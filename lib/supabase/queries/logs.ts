import "server-only";
import { getSupabaseServerClient } from "../server";
import type { ExecutionLog } from "@/lib/types/domain";
import { mapExecutionLog } from "./mappers";

export async function createExecutionLog(params: {
  requestId: string | null;
  actionId: string | null;
  workflowName: string;
  status: "success" | "failed";
  errorMessage?: string | null;
  durationMs?: number | null;
}): Promise<ExecutionLog> {
  const supabase = getSupabaseServerClient();

  const { data, error } = await supabase
    .from("execution_logs")
    .insert({
      request_id: params.requestId,
      action_id: params.actionId,
      workflow_name: params.workflowName,
      status: params.status,
      error_message: params.errorMessage ?? null,
      duration_ms: params.durationMs ?? null,
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(`Failed to create execution log: ${error?.message ?? "no row returned"}`);
  }

  return mapExecutionLog(data);
}

export async function listExecutionLogs(
  params: { requestId?: string; limit?: number } = {},
): Promise<ExecutionLog[]> {
  const supabase = getSupabaseServerClient();

  let query = supabase
    .from("execution_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(params.limit ?? 100);

  if (params.requestId) {
    query = query.eq("request_id", params.requestId);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to list execution logs: ${error.message}`);
  }

  return (data ?? []).map(mapExecutionLog);
}
