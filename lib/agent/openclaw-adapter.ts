import "server-only";
import { fetchWithRetry } from "@/lib/http/fetch-with-retry";
import { ALLOWED_ACTIONS, isAllowedAction, type AllowedAction } from "@/lib/actions/allowlist";
import type { AgentProposal, ProposedAction } from "@/lib/types/domain";
import type { AgentAdapter } from "./types";

const CONTACT_ID_NOTE =
  " If you don't know the real GoHighLevel contactId, leave contactId empty and set contactLookupHint to the person's name or email instead — it will be resolved to a real contact before this runs. Never invent a contactId.";
const OPPORTUNITY_ID_NOTE =
  " If you don't know the real opportunityId, leave it empty — set contactLookupHint (or contactId) instead and it will be resolved to that contact's one opportunity. Never invent an opportunityId.";
const STAGE_NOTE =
  " If you only know the stage/pipeline by name (e.g. \"Qualified\", \"AI Qualified\"), leave pipelineStageId/pipelineId empty and set stageNameHint (and pipelineNameHint if the user named a specific pipeline) instead — real IDs will be looked up. Never invent a pipelineStageId.";

const ACTION_DESCRIPTIONS: Record<AllowedAction, string> = {
  SEARCH_CONTACTS: "Search for GoHighLevel contacts by name, email, or phone. Use this when the user asks to find/look up/list contacts, or when you need to disambiguate before another action.",
  GET_CONTACT: `Look up a single GoHighLevel contact's full details.${CONTACT_ID_NOTE}`,
  CREATE_CONTACT: "Create a brand-new GoHighLevel contact. Use this only when the user explicitly asks to create/add a new contact (not when updating an existing one).",
  UPDATE_CONTACT: `Update an existing GoHighLevel contact's fields (name, email, phone, tags).${CONTACT_ID_NOTE}`,
  UPSERT_CONTACT: `Create a contact, or update it if one with the same email/phone already exists. Use this for bulk/CSV-style "add this person" requests where you don't know if they already exist.`,
  DELETE_CONTACT: `Permanently delete a GoHighLevel contact. Destructive — only propose this when the user explicitly asks to delete/remove a contact.${CONTACT_ID_NOTE}`,
  ADD_CONTACT_TAG: `Add one or more tags to a contact (e.g. "add the hot-lead tag to Rahul").${CONTACT_ID_NOTE}`,
  REMOVE_CONTACT_TAG: `Remove one or more tags from a contact.${CONTACT_ID_NOTE}`,

  SEARCH_OPPORTUNITIES: "Search/list GoHighLevel opportunities, optionally filtered to one contact's opportunities.",
  GET_OPPORTUNITY: "Look up a single GoHighLevel opportunity's details by its real opportunityId.",
  CREATE_OPPORTUNITY: `Create a new opportunity for a contact in a pipeline, with an optional monetary value.${CONTACT_ID_NOTE}${STAGE_NOTE}`,
  UPDATE_OPPORTUNITY: `Update an opportunity — most commonly moving it to a different pipeline stage.${OPPORTUNITY_ID_NOTE}${STAGE_NOTE}`,
  DELETE_OPPORTUNITY: `Permanently delete an opportunity. Destructive — only propose this when explicitly asked.${OPPORTUNITY_ID_NOTE}`,

  LIST_PIPELINES: "List every pipeline and its stages, with real names and IDs. Use this before UPDATE_OPPORTUNITY/CREATE_OPPORTUNITY if you need to see what pipelines/stages actually exist.",
  CREATE_PIPELINE: "Create a new pipeline with a name and an ordered list of stage names (e.g. 'Solar Leads' with stages New Lead, Contacted, Qualified, Proposal, Won). Use this only when the user explicitly asks to create a pipeline.",
  UPDATE_PIPELINE: "Rename an existing pipeline. Set pipelineNameHint to identify it if you don't know its real pipelineId.",
  DELETE_PIPELINE: "Permanently delete a pipeline. Destructive — only propose this when explicitly asked. Set pipelineNameHint to identify it if you don't know its real pipelineId.",
  CREATE_PIPELINE_STAGE: "Add a new stage to an existing pipeline. Set pipelineNameHint to identify the pipeline and stageName for the new stage's name.",
  UPDATE_PIPELINE_STAGE: "Rename an existing stage in a pipeline. Set pipelineNameHint and stageNameHint to identify it, and newStageName for the new name.",
  DELETE_PIPELINE_STAGE: "Permanently remove a stage from a pipeline. Destructive — only propose this when explicitly asked. Set pipelineNameHint and stageNameHint to identify it.",

  LIST_TASKS: `List a contact's open follow-up tasks.${CONTACT_ID_NOTE}`,
  GET_TASK: `Look up one task by id on a contact.${CONTACT_ID_NOTE}`,
  CREATE_TASK: `Create a follow-up task on a contact, with a title and due date.${CONTACT_ID_NOTE}`,
  UPDATE_TASK: `Update a task (title, body, due date, or mark it completed).${CONTACT_ID_NOTE}`,
  DELETE_TASK: `Permanently delete a task. Destructive — only propose this when explicitly asked.${CONTACT_ID_NOTE}`,

  ADD_NOTE: `Add a free-text note to a contact's record.${CONTACT_ID_NOTE}`,

  LIST_CUSTOM_FIELDS: "List every custom field defined on contacts or opportunities.",
  CREATE_CUSTOM_FIELD: "Create a new custom field (name, data type, and whether it's on contacts or opportunities).",
  UPDATE_CUSTOM_FIELD: "Rename an existing custom field.",
  DELETE_CUSTOM_FIELD: "Permanently delete a custom field. Destructive — only propose this when explicitly asked.",

  SEARCH_CONVERSATIONS: `Search a contact's conversation threads.${CONTACT_ID_NOTE}`,
  GET_CONVERSATION: "Look up a single conversation by its real conversationId.",
  SEND_MESSAGE: `Send a real SMS or email message to a contact. High-impact — only propose this when the user explicitly asks to send/message someone, and always double-check the message text.${CONTACT_ID_NOTE}`,

  LIST_CALENDARS: "List the calendars configured for this GoHighLevel location.",
};

function buildToolSchema() {
  return ALLOWED_ACTIONS.map((action) => ({
    type: "function" as const,
    name: action.toLowerCase(),
    description: ACTION_DESCRIPTIONS[action],
    parameters: {
      type: "object",
      properties: {
        contactId: { type: "string", description: "The real GoHighLevel contact ID, only if already known. Leave empty otherwise." },
        contactLookupHint: { type: "string", description: "The contact's name or email, used to look up their real contactId when it isn't already known." },
        opportunityId: { type: "string", description: "The real GoHighLevel opportunity ID, only if already known." },
        opportunityLookupHint: { type: "boolean", description: "Set to true to mean 'this contact's opportunity' when opportunityId isn't known." },
        pipelineId: { type: "string" },
        pipelineStageId: { type: "string" },
        pipelineNameHint: { type: "string", description: "The pipeline's name, if the user named one, when pipelineId isn't already known." },
        stageNameHint: { type: "string", description: "The target stage's name (e.g. 'Qualified', 'AI Qualified'), when pipelineStageId isn't already known." },
        stages: { type: "array", items: { type: "object", properties: { name: { type: "string" } } }, description: "For CREATE_PIPELINE only: the ordered list of stage names to create." },
        stageName: { type: "string", description: "For CREATE_PIPELINE_STAGE: the new stage's name." },
        newStageName: { type: "string", description: "For UPDATE_PIPELINE_STAGE: the stage's new name." },
        stageId: { type: "string", description: "The real GoHighLevel pipeline stage ID, only if already known." },
        firstName: { type: "string" },
        lastName: { type: "string" },
        name: { type: "string", description: "A contact's display name, or (for CREATE_PIPELINE/UPDATE_PIPELINE) the pipeline's name." },
        email: { type: "string" },
        phone: { type: "string" },
        companyName: { type: "string" },
        tags: { type: "array", items: { type: "string" }, description: "Tag names to add or remove." },
        status: { type: "string", enum: ["open", "won", "lost", "abandoned"] },
        title: { type: "string" },
        dueDate: { type: "string", description: "ISO 8601 date-time." },
        completed: { type: "boolean" },
        body: { type: "string" },
        monetaryValue: { type: "number" },
        query: { type: "string", description: "Free-text search query." },
        taskId: { type: "string" },
        customFieldId: { type: "string" },
        dataType: { type: "string", description: "e.g. TEXT, LARGE_TEXT, NUMERICAL, DATE." },
        model: { type: "string", enum: ["contact", "opportunity"] },
        conversationId: { type: "string" },
        message: { type: "string" },
        type: { type: "string", enum: ["SMS", "Email"] },
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
 * contract are documented there. A single request can legitimately
 * surface multiple `function_call` items in `output` — that is how
 * multi-action commands ("find X, move their opportunity, and create a
 * task") come back as more than one ProposedAction from one propose() call.
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
