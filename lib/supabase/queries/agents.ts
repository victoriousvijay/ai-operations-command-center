import "server-only";
import { getSupabaseServerClient } from "../server";
import type { Agent, AgentAdapterType, AgentStatus } from "@/lib/types/domain";
import { mapAgent } from "./mappers";

export async function listAgents(): Promise<Agent[]> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("agents")
    .select("*")
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to list agents: ${error.message}`);
  }

  return (data ?? []).map(mapAgent);
}

export async function createAgent(params: {
  name: string;
  adapterType: AgentAdapterType;
  description?: string | null;
}): Promise<Agent> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("agents")
    .insert({
      name: params.name,
      adapter_type: params.adapterType,
      description: params.description ?? null,
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(`Failed to create agent: ${error?.message ?? "no row returned"}`);
  }

  return mapAgent(data);
}

export async function updateAgentStatus(id: string, status: AgentStatus): Promise<Agent> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("agents")
    .update({ status })
    .eq("id", id)
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(`Failed to update agent ${id}: ${error?.message ?? "not found"}`);
  }

  return mapAgent(data);
}
