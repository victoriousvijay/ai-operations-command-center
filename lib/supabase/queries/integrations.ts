import "server-only";
import { getSupabaseServerClient } from "../server";
import type { Integration, IntegrationProvider, IntegrationStatus } from "@/lib/types/domain";
import { mapIntegration } from "./mappers";

export async function listIntegrations(): Promise<Integration[]> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("integrations")
    .select("*")
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to list integrations: ${error.message}`);
  }

  return (data ?? []).map(mapIntegration);
}

export async function createIntegration(params: {
  name: string;
  provider: IntegrationProvider;
  baseUrl?: string | null;
}): Promise<Integration> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("integrations")
    .insert({
      name: params.name,
      provider: params.provider,
      base_url: params.baseUrl ?? null,
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(`Failed to create integration: ${error?.message ?? "no row returned"}`);
  }

  return mapIntegration(data);
}

export async function updateIntegrationStatus(
  id: string,
  status: IntegrationStatus,
): Promise<Integration> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("integrations")
    .update({ status, last_checked_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(`Failed to update integration ${id}: ${error?.message ?? "not found"}`);
  }

  return mapIntegration(data);
}
