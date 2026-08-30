import "server-only";
import type { AgentProposal, ProposedAction } from "@/lib/types/domain";
import type { AgentAdapter } from "./types";

/**
 * Marks a contactId as synthesized rather than looked up. lib/n8n/client.ts
 * checks for this prefix to decide whether a real GHL contact lookup
 * (by contactLookupHint) should run before dispatching an action.
 */
export const SYNTHETIC_CONTACT_PREFIX = "mock-contact-";

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function extractPersonName(text: string): string | null {
  const possessive = text.match(/([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+){0,2})'s\b/);
  if (possessive?.[1]) return possessive[1];

  const forName = text.match(/\bfor\s+([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+){0,2})\b/);
  if (forName?.[1]) return forName[1];

  return null;
}

function tomorrowIso(): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 1);
  date.setUTCHours(9, 0, 0, 0);
  return date.toISOString();
}

/**
 * MOCK MODE — a deterministic, keyword-based stand-in for real reasoning.
 * This is NOT natural-language understanding; it is a small set of regex
 * rules built to demonstrate the pipeline end-to-end without a live
 * OpenClaw Gateway. It synthesizes GHL-shaped IDs from names it finds in
 * the text (e.g. "john-smith") since it has no way to look up real GHL
 * contact/opportunity IDs — the mock GHL client accepts any ID.
 *
 * Never used as a substitute for the real OpenClaw integration in
 * production; see openclaw-adapter.ts for that.
 */
export class MockAgentAdapter implements AgentAdapter {
  readonly name = "mock-dev";
  readonly isMock = true;

  async propose(userRequest: string): Promise<AgentProposal> {
    const actions: ProposedAction[] = [];
    const name = extractPersonName(userRequest);
    const slug = name ? slugify(name) : "unknown-contact";

    const opportunityMatch = userRequest.match(
      /opportunity\s+to\s+([A-Za-z][A-Za-z\s]*?)(?:\s+and\b|[.,]|$)/i,
    );
    if (opportunityMatch?.[1]) {
      const stageLabel = opportunityMatch[1].trim();
      actions.push({
        type: "UPDATE_OPPORTUNITY",
        payload: {
          opportunityId: `mock-opportunity-${slug}`,
          pipelineStageId: slugify(stageLabel),
          name: stageLabel,
          status: /won/i.test(stageLabel)
            ? "won"
            : /lost/i.test(stageLabel)
              ? "lost"
              : "open",
        },
      });
    }

    const email = userRequest.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0];
    const lookupHint = name ?? email;

    if (/\btask\b|\bfollow[\s-]?up\b/i.test(userRequest)) {
      actions.push({
        type: "CREATE_TASK",
        payload: {
          contactId: `${SYNTHETIC_CONTACT_PREFIX}${slug}`,
          ...(lookupHint ? { contactLookupHint: lookupHint } : {}),
          title: name ? `Follow up with ${name}` : "Follow-up task",
          dueDate: /tomorrow/i.test(userRequest) ? tomorrowIso() : tomorrowIso(),
        },
      });
    }

    const noteMatch = userRequest.match(/\bnote(?:\s+that)?\s*:?\s*(.+)/i);
    if (noteMatch?.[1] && !opportunityMatch) {
      actions.push({
        type: "ADD_NOTE",
        payload: {
          contactId: `${SYNTHETIC_CONTACT_PREFIX}${slug}`,
          ...(lookupHint ? { contactLookupHint: lookupHint } : {}),
          body: noteMatch[1].trim(),
        },
      });
    }

    const phone = userRequest.match(/\+?\d[\d\s().-]{7,}\d/)?.[0];
    if (
      (email || phone) &&
      /\bupdate\b|\bchange\b|\bset\b/i.test(userRequest) &&
      /\bcontact\b|\bemail\b|\bphone\b/i.test(userRequest)
    ) {
      actions.push({
        type: "UPDATE_CONTACT",
        payload: {
          contactId: `${SYNTHETIC_CONTACT_PREFIX}${slug}`,
          ...(lookupHint ? { contactLookupHint: lookupHint } : {}),
          ...(email ? { email } : {}),
          ...(phone ? { phone } : {}),
        },
      });
    }

    if (actions.length === 0 && /^(show|get|look\s?up|find)\b/i.test(userRequest.trim())) {
      if (/opportunity/i.test(userRequest)) {
        actions.push({
          type: "GET_OPPORTUNITY",
          payload: { opportunityId: `mock-opportunity-${slug}` },
        });
      } else {
        actions.push({
          type: "GET_CONTACT",
          payload: {
            contactId: `${SYNTHETIC_CONTACT_PREFIX}${slug}`,
            ...(lookupHint ? { contactLookupHint: lookupHint } : {}),
          },
        });
      }
    }

    return {
      intent: actions.length > 0 ? "CRM_UPDATE" : "UNKNOWN",
      actions,
    };
  }
}
