import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";

let cached: SupabaseClient<Database> | null = null;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/**
 * Server-only Supabase client authenticated with the service role key.
 * The service role key bypasses Row Level Security and must never reach
 * client components, the browser bundle, or logs. The `server-only`
 * import above makes accidentally importing this module from client code
 * a build-time error, not a runtime leak.
 *
 * Only call this from server-side code: route handlers, server components,
 * server actions.
 */
export function getSupabaseServerClient(): SupabaseClient<Database> {
  if (cached) return cached;

  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  cached = createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return cached;
}
