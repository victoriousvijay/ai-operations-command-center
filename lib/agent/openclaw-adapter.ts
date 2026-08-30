import "server-only";
import { fetchWithRetry } from "@/lib/http/fetch-with-retry";
import { ALLOWED_ACTIONS, isAllowedAction, type AllowedAction } from "@/lib/actions/allowlist";
import type { AgentProposal, ProposedAction } from "@/lib/types/domain";
import type { AgentAdapter } from "./types";

const CONTACT_ID_NOTE =
  " If you don't know the real GoHighLevel contactId, leave contactId empty and set contactLookupHint to the person's name or email instead — it will be resolved to a real contact before this runs. Never invent a contactId.";

const ACTION_DESCRIPTIONS: Record<AllowedAction, string> = {
  GET_CONTACT: `Look up a GoHighLevel contact by id.${CONTACT_ID_NOTE}`,
  GET_OPPORTUNITY: "Look up a GoHighLevel opportunity by id.",
  UPDATE_CONTACT: `Update a GoHighLevel contact's fields (name, email, phone, tags).${CONTACT_ID_NOTE}`,
  UPDATE_OPPORTUNITY: "Update a GoHighLevel opportunity, e.g. move it to a new pipeline stage.",
  CREATE_TASK: `Create a follow-up task on a GoHighLevel contact.${CONTACT_ID_NOTE}`,
  ADD_NOTE: `Add a note to a GoHighLevel contact.${CONTACT_ID_NOTE}`,
};

function buildToolSchema() {
  return ALLOWED_ACTIONS.map((action) => ({
    type: "function" as const,
    name: action.toLowerCase(),
    description: ACTION_DESCRIPTIONS[action],
    parameters: {
      type: "object",
      properties: {
        contactId: {
          type: "string",
          description: "The real GoHighLevel contact ID, only if already known. Leave empty otherwise.",
        },
        contactLookupHint: {
          type: "string",
          description: "The contact's name or email, used to look up their real contactId when it isn't already known.",
        },
        opportunityId: { type: "string" },
        firstName: { type: "string" },
        lastName: { type: "string" },
        email: { type: "string" },
        phone: { type: "string" },
        pipelineStageId: { type: "string" },
        status: { type: "string" },
        title: { type: "string" },
        dueDate: { type: "string" },
        body: { type: "string" },
      },
      additionalProperties: true,
    },
  }));
}

interface OpenResponsesFunctionCallItem {
  type: "function_call";
  name: string;
  arguments: string;
}

interface OpenResponsesOutputItem {
  type: string;
  [key: string]: unknown;
}

interface OpenResponsesBody {
  output?: OpenResponsesOutputItem[];
}

/**
 * Real OpenClaw Gateway adapter — calls the OpenResponses-compatible
 * POST /v1/responses endpoint, verified against OpenClaw's published
 * documentation (docs.openclaw.ai/gateway/openresponses-http-api):
 * request shape (model, input, tools, tool_choice), auth
 * (`Authorization: Bearer <token>`), and the function-call tool-calling
 * contract are documented there.
 *
 * One thing OpenClaw's own docs do not show is a full example of the
 * non-streaming response envelope. Since OpenClaw documents itself as
 * "OpenResponses-compatible" (the same family as OpenAI's public
 * Responses API), this adapter parses the standard `output` array shape
 * from that spec (`{ type: "function_call", name, arguments }` items).
 * If a real Gateway returns a different envelope, `propose()` throws a
 * clear, specific error rather than silently returning no actions —
 * verify against a live Gateway and adjust parsing here if needed.
 */
export class OpenClawAdapter implements AgentAdapter {
  readonly name = "openclaw-main";
  readonly isMock = false;

  constructor(
    private readonly gatewayUrl: string,
    private readonly token: string,
  ) {}

  async propose(userRequest: string): Promise<AgentProposal> {
    const response = await fetchWithRetry(`${this.gatewayUrl.replace(/\/$/, "")}/v1/responses`, {
      method: "POST",
      timeoutMs: 30_000,
      retries: 0,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "openclaw",
        input: userRequest,
        tools: buildToolSchema(),
        tool_choice: "auto",
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`OpenClaw Gateway returned ${response.status}: ${body.slice(0, 500)}`);
    }

    const data = (await response.json()) as OpenResponsesBody;
    if (!Array.isArray(data.output)) {
      throw new Error(
        "Unexpected OpenClaw response shape: no 'output' array. Verify the Gateway's response envelope and adjust lib/agent/openclaw-adapter.ts.",
      );
    }

    const actions: ProposedAction[] = [];

    for (const item of data.output) {
      if (item.type !== "function_call") continue;
      const call = item as unknown as OpenResponsesFunctionCallItem;
      const actionType = call.name.toUpperCase();

      if (!isAllowedAction(actionType)) {
        // The tool schema only ever advertises allowed actions, so this
        // should not happen — but never trust it blindly.
        continue;
      }

      let payload: Record<string, unknown> = {};
      try {
        payload = JSON.parse(call.arguments) as Record<string, unknown>;
      } catch {
        continue;
      }

      actions.push({ type: actionType, payload });
    }

    return {
      intent: actions.length > 0 ? "CRM_UPDATE" : "UNKNOWN",
      actions,
    };
  }
}
