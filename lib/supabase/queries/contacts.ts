import "server-only";
import { getSupabaseServerClient } from "../server";
import type { CachedContact } from "@/lib/types/domain";
import { mapContact } from "./mappers";

export async function listContacts(params: { limit?: number } = {}): Promise<CachedContact[]> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("contacts_cache")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(params.limit ?? 50);

  if (error) {
    throw new Error(`Failed to list cached contacts: ${error.message}`);
  }

  return (data ?? []).map(mapContact);
}

export async function upsertContact(params: {
  externalId: string;
  name?: string | null;
  email?: string | null;
  source?: string;
}): Promise<CachedContact> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("contacts_cache")
    .upsert(
      {
        external_id: params.externalId,
        name: params.name ?? null,
        email: params.email ?? null,
        source: params.source ?? "gohighlevel",
      },
      { onConflict: "external_id,source" },
    )
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(`Failed to upsert cached contact: ${error?.message ?? "no row returned"}`);
  }

  return mapContact(data);
}
