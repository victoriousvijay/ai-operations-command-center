import "server-only";
import { MockAgentAdapter } from "./mock-adapter";
import { OpenClawAdapter } from "./openclaw-adapter";
import type { AgentAdapter } from "./types";

export type { AgentAdapter } from "./types";

let cached: AgentAdapter | null = null;

/**
 * Selects the agent adapter via AGENT_ADAPTER (default "mock"). Requires
 * AGENT_ADAPTER=openclaw and both OPENCLAW_GATEWAY_URL/OPENCLAW_GATEWAY_TOKEN
 * to reason with a real OpenClaw Gateway.
 */
export function getAgentAdapter(): AgentAdapter {
  if (cached) return cached;

  const mode = process.env.AGENT_ADAPTER === "openclaw" ? "openclaw" : "mock";

  if (mode === "mock") {
    cached = new MockAgentAdapter();
    return cached;
  }

  const gatewayUrl = process.env.OPENCLAW_GATEWAY_URL;
  const token = process.env.OPENCLAW_GATEWAY_TOKEN;
  if (!gatewayUrl || !token) {
    throw new Error(
      "AGENT_ADAPTER=openclaw but OPENCLAW_GATEWAY_URL or OPENCLAW_GATEWAY_TOKEN is not set.",
    );
  }

  cached = new OpenClawAdapter(gatewayUrl, token);
  return cached;
}
