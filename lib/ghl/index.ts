import "server-only";
import { MockGhlClient, RealGhlClient } from "./client";
import type { GhlClient } from "./types";

export * from "./types";

let cached: GhlClient | null = null;

/**
 * Selects the GHL adapter explicitly via GHL_ADAPTER (default "mock").
 * Requires GHL_ADAPTER=real to ever call the live API — presence of a
 * token alone does not switch modes, so a demo never silently hits a real
 * CRM by accident.
 */
export function getGhlClient(): GhlClient {
  if (cached) return cached;

  const mode = process.env.GHL_ADAPTER === "real" ? "real" : "mock";

  if (mode === "mock") {
    cached = new MockGhlClient();
    return cached;
  }

  const token = process.env.GHL_PRIVATE_INTEGRATION_TOKEN;
  if (!token) {
    throw new Error(
      "GHL_ADAPTER=real but GHL_PRIVATE_INTEGRATION_TOKEN is not set.",
    );
  }

  cached = new RealGhlClient({
    baseUrl: process.env.GHL_API_BASE_URL ?? "https://services.leadconnectorhq.com",
    version: process.env.GHL_API_VERSION ?? "2021-07-28",
    token,
  });
  return cached;
}
