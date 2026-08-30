import "server-only";
import type { AllowedAction } from "./allowlist";

/**
 * The controlled action registry.
 *
 * This is the ONLY place in the system that turns an allowed action type
 * into a real GoHighLevel HTTP request (method + path + body). The agent
 * (OpenClaw or the mock parser), a CSV row, or a parsed PDF/Markdown line
 * can only ever select one of the AllowedAction labels and supply
 * parameters — none of them can construct or influence a raw method, path,
 * or body directly. That is what keeps "the AI can never execute arbitrary
 * API requests" true even as the action surface grows.
 *
 * lib/n8n/client.ts's HttpN8nClient calls buildGhlRequest() for every
 * dispatch and sends the result to n8n as `ghlRequest`; the real n8n
 * workflows (n8n/workflows/*.json) contain one generic, credentialed HTTP
 * Request node each that executes exactly `ghlRequest.method` /
 * `ghlRequest.path` / `ghlRequest.body` against GoHighLevel — n8n's job is
 * authenticated execution + audit logging, never deciding what to call.
 * lib/n8n/client.ts's MockN8nClient (used for local dev / demo without a
 * live n8n instance) instead calls the matching GhlClient method directly
 * — see its switch statement — which is why every action below also has a
 * one-to-one GhlClient method of the same shape.
 *
 * `locationId` is read from GHL_LOCATION_ID here (server-side env), never
 * accepted as an agent- or file-supplied parameter, so a proposed action
 * can never target a different GoHighLevel sub-account than the one this
 * deployment is configured for.
 */

function locationId(): string {
  const id = process.env.GHL_LOCATION_ID;
  if (!id) throw new Error("GHL_LOCATION_ID is not configured.");
  return id;
}

export interface GhlRequestTemplate {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  body?: Record<string, unknown>;
}

/**
 * Builds the exact GHL request for one action + already-resolved payload.
 * "Already-resolved" means any name/email hints have already been turned
 * into real GHL IDs by lib/orchestration/resolvers.ts — this function only
 * ever sees real contactId/opportunityId/pipelineStageId values, never a
 * hint string, and never invents one.
 */
export function buildGhlRequest(
  actionType: AllowedAction,
  payload: Record<string, unknown>,
): GhlRequestTemplate {
  const p = payload;
  switch (actionType) {
    case "SEARCH_CONTACTS":
      return { method: "POST", path: "/contacts/search", body: { locationId: locationId(), query: p.query, pageLimit: 5 } };
    case "GET_CONTACT":
      return { method: "GET", path: `/contacts/${p.contactId}` };
    case "CREATE_CONTACT":
      return { method: "POST", path: "/contacts/", body: { locationId: locationId(), ...omit(p, []) } };
    case "UPDATE_CONTACT":
      return { method: "PUT", path: `/contacts/${p.contactId}`, body: omit(p, ["contactId", "contactLookupHint"]) };
    case "UPSERT_CONTACT":
      return { method: "POST", path: "/contacts/upsert", body: { locationId: locationId(), ...p } };
    case "DELETE_CONTACT":
      return { method: "DELETE", path: `/contacts/${p.contactId}` };
    case "ADD_CONTACT_TAG":
      return { method: "POST", path: `/contacts/${p.contactId}/tags`, body: { tags: p.tags } };
    case "REMOVE_CONTACT_TAG":
      return { method: "DELETE", path: `/contacts/${p.contactId}/tags`, body: { tags: p.tags } };

    case "SEARCH_OPPORTUNITIES": {
      const params = new URLSearchParams({ location_id: locationId(), limit: "20" });
      if (typeof p.contactId === "string") params.set("contact_id", p.contactId);
      if (typeof p.query === "string") params.set("q", p.query);
      return { method: "GET", path: `/opportunities/search?${params.toString()}` };
    }
    case "GET_OPPORTUNITY":
      return { method: "GET", path: `/opportunities/${p.opportunityId}` };
    case "CREATE_OPPORTUNITY":
      return { method: "POST", path: "/opportunities/", body: { locationId: locationId(), status: "open", ...omit(p, []) } };
    case "UPDATE_OPPORTUNITY":
      return { method: "PUT", path: `/opportunities/${p.opportunityId}`, body: omit(p, ["opportunityId", "opportunityLookupHint"]) };
    case "DELETE_OPPORTUNITY":
      return { method: "DELETE", path: `/opportunities/${p.opportunityId}` };

    case "LIST_PIPELINES":
      return { method: "GET", path: `/opportunities/pipelines?locationId=${locationId()}` };

    case "LIST_TASKS":
      return { method: "GET", path: `/contacts/${p.contactId}/tasks` };
    case "GET_TASK":
      return { method: "GET", path: `/contacts/${p.contactId}/tasks/${p.taskId}` };
    case "CREATE_TASK":
      return { method: "POST", path: `/contacts/${p.contactId}/tasks`, body: { ...omit(p, ["contactId", "contactLookupHint"]), completed: false } };
    case "UPDATE_TASK":
      return { method: "PUT", path: `/contacts/${p.contactId}/tasks/${p.taskId}`, body: omit(p, ["contactId", "taskId", "contactLookupHint"]) };
    case "DELETE_TASK":
      return { method: "DELETE", path: `/contacts/${p.contactId}/tasks/${p.taskId}` };

    case "ADD_NOTE":
      return { method: "POST", path: `/contacts/${p.contactId}/notes`, body: omit(p, ["contactId", "contactLookupHint"]) };

    case "LIST_CUSTOM_FIELDS":
      return { method: "GET", path: `/locations/${locationId()}/customFields` };
    case "CREATE_CUSTOM_FIELD":
      return { method: "POST", path: `/locations/${locationId()}/customFields`, body: omit(p, []) };
    case "UPDATE_CUSTOM_FIELD":
      return { method: "PUT", path: `/locations/${locationId()}/customFields/${p.customFieldId}`, body: omit(p, ["customFieldId"]) };
    case "DELETE_CUSTOM_FIELD":
      return { method: "DELETE", path: `/locations/${locationId()}/customFields/${p.customFieldId}` };

    case "SEARCH_CONVERSATIONS": {
      const params = new URLSearchParams({ locationId: locationId() });
      if (typeof p.contactId === "string") params.set("contactId", p.contactId);
      return { method: "GET", path: `/conversations/search?${params.toString()}` };
    }
    case "GET_CONVERSATION":
      return { method: "GET", path: `/conversations/${p.conversationId}` };
    case "SEND_MESSAGE":
      return { method: "POST", path: "/conversations/messages", body: { type: p.type ?? "SMS", contactId: p.contactId, message: p.message } };

    case "LIST_CALENDARS":
      return { method: "GET", path: `/calendars/?locationId=${locationId()}` };
  }
}

function omit(payload: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (!keys.includes(key)) result[key] = value;
  }
  return result;
}
