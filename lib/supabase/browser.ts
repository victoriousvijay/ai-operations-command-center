import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";

let cached: SupabaseClient<Database> | null = null;

/**
 * Public (anon-key) Supabase client, safe to use from client components.
 * The anon key is designed to be publishable — access control is enforced
 * by Row Level Security, not by keeping this key secret.
 *
 * As of Phase 2, no RLS policy grants the `anon` role any access (see the
 * migration's RLS section) — every table is locked to service-role access
 * only, so this client cannot currently read or write anything. It exists
 * so a later phase (e.g. a dashboard subscribing to live updates) can
 * enable narrow, explicit policies without introducing a new client
 * abstraction. Not used anywhere yet.
 */
export function getSupabaseBrowserClient(): SupabaseClient<Database> {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }

  cached = createClient<Database>(url, anonKey);
  return cached;
}
