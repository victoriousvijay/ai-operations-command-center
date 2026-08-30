import "server-only";
import { HttpN8nClient, MockN8nClient } from "./client";
import type { N8nClient } from "./types";

export * from "./types";
export { validatePayload, payloadSchemas } from "./validation";
export { resolveContactId } from "./client";

let cached: N8nClient | null = null;

/**
 * Selects the n8n adapter explicitly via N8N_ADAPTER (default "mock").
 * Requires N8N_ADAPTER=http and both N8N_BASE_URL/N8N_WEBHOOK_SECRET to
 * dispatch to a real n8n instance.
 */
export function getN8nClient(): N8nClient {
  if (cached) return cached;

  const mode = process.env.N8N_ADAPTER === "http" ? "http" : "mock";

  if (mode === "mock") {
    cached = new MockN8nClient();
    return cached;
  }

  const baseUrl = process.env.N8N_BASE_URL;
  const webhookSecret = process.env.N8N_WEBHOOK_SECRET;
  if (!baseUrl || !webhookSecret) {
    throw new Error(
      "N8N_ADAPTER=http but N8N_BASE_URL or N8N_WEBHOOK_SECRET is not set.",
    );
  }

  cached = new HttpN8nClient(baseUrl, webhookSecret);
  return cached;
}
