import type { AgentProposal } from "@/lib/types/domain";

/**
 * The THINK layer's interface. An AgentAdapter turns a natural-language
 * request into an intent label and a list of proposed actions — it never
 * calls GoHighLevel, n8n, or Supabase directly, and never receives their
 * credentials.
 */
export interface AgentAdapter {
  readonly name: string;
  readonly isMock: boolean;
  propose(userRequest: string): Promise<AgentProposal>;
}
