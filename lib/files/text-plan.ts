import "server-only";
import { getAgentAdapter } from "@/lib/agent";
import type { PlannedAction } from "./types";

/**
 * Turns free-text instruction lines (from a parsed PDF or Markdown file)
 * into planned actions by running each line through the SAME agent
 * adapter used for a typed text command (lib/agent/index.ts). This is the
 * "don't duplicate business logic" principle from ARCHITECTURE.md: a PDF
 * instruction and a typed command converge into identical code the moment
 * text exists, they are never re-interpreted by a separate rules engine.
 *
 * Capped at MAX_LINES to avoid firing an unbounded number of agent calls
 * (and, with OpenClaw, real LLM API calls) from one uploaded file — see
 * ARCHITECTURE.md's "avoid unnecessary AI calls" performance principle.
 * Any lines beyond the cap are reported, not silently dropped.
 */
const MAX_LINES = 20;

export async function planFromTextLines(lines: string[]): Promise<{ actions: PlannedAction[]; warnings: string[] }> {
  const warnings: string[] = [];
  const usable = lines.filter((l) => l.trim().length > 0);
  const capped = usable.slice(0, MAX_LINES);
  if (usable.length > MAX_LINES) {
    warnings.push(`This file has ${usable.length} instruction lines — only the first ${MAX_LINES} were processed to limit AI calls. Split large files into smaller uploads.`);
  }

  const agent = getAgentAdapter();
  const actions: PlannedAction[] = [];

  for (let i = 0; i < capped.length; i++) {
    const line = capped[i]!;
    const lineNumber = lines.indexOf(line) + 1;
    try {
      const proposal = await agent.propose(line);
      if (proposal.actions.length === 0) {
        actions.push({
          source: lineNumber,
          type: null,
          payload: {},
          status: "error",
          target: line.slice(0, 80),
          message: "Could not map this instruction to any allowed action.",
        });
        continue;
      }
      for (const proposed of proposal.actions) {
        actions.push({
          source: lineNumber,
          type: proposed.type,
          payload: proposed.payload,
          status: "ready",
          target: line.slice(0, 80),
        });
      }
    } catch (error) {
      actions.push({
        source: lineNumber,
        type: null,
        payload: {},
        status: "error",
        target: line.slice(0, 80),
        message: error instanceof Error ? error.message : "The agent failed to interpret this instruction.",
      });
    }
  }

  return { actions, warnings };
}
