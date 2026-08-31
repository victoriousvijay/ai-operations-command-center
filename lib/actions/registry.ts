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
    case "ASSIGN_LEAD":
      return { method: "PUT", path: `/contacts/${p.contactId}`, body: { assignedTo: p.assignedToUserId } };

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
    case "CREATE_PIPELINE": {
      // GHL requires a numeric `position` on every stage (confirmed live —
      // omitting it returns 422 "stages.N.position should not be empty").
      // The caller only supplies names, so number them here.
      const stages = Array.isArray(p.stages)
        ? (p.stages as Array<{ name: string }>).map((s, i) => ({ name: s.name, position: i }))
        : p.stages;
      return { method: "POST", path: "/opportunities/pipelines", body: { locationId: locationId(), name: p.name, stages } };
    }
    // UPDATE_PIPELINE, CREATE_PIPELINE_STAGE, UPDATE_PIPELINE_STAGE, and
    // DELETE_PIPELINE_STAGE all resolve to the same PUT shape — by the
    // time this runs, resolvePipelineMutation (lib/orchestration/
    // resolvers.ts) has already fetched the current pipeline and computed
    // the full merged `stages` array GHL's PUT requires; this just sends it.
    case "UPDATE_PIPELINE":
    case "CREATE_PIPELINE_STAGE":
    case "UPDATE_PIPELINE_STAGE":
    case "DELETE_PIPELINE_STAGE":
      return { method: "PUT", path: `/opportunities/pipelines/${p.pipelineId}`, body: { name: p.name, stages: p.stages } };
    case "DELETE_PIPELINE":
      return { method: "DELETE", path: `/opportunities/pipelines/${p.pipelineId}` };

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
    case "SEND_MESSAGE": {
      // GHL's real contract differs by type (confirmed live): SMS takes
      // `message`; Email requires `html` + `subject`, not `message` —
      // sending `message` for Email returns 422 CONVERSATIONS_MSG_NO_CONTENT.
      const type = (p.type as string | undefined) ?? "SMS";
      const body =
        type === "Email"
          ? { type, contactId: p.contactId, subject: p.subject ?? "Message from your automation system", html: `<p>${p.message}</p>` }
          : { type, contactId: p.contactId, message: p.message };
      return { method: "POST", path: "/conversations/messages", body };
    }

    case "LIST_CALENDARS":
      return { method: "GET", path: `/calendars/?locationId=${locationId()}` };
    case "CREATE_CALENDAR":
      return { method: "POST", path: "/calendars/", body: { locationId: locationId(), name: p.name } };
    case "DELETE_CALENDAR":
      return { method: "DELETE", path: `/calendars/${p.calendarId}` };

    case "GET_APPOINTMENT":
      return { method: "GET", path: `/calendars/events/appointments/${p.appointmentId}` };
    case "SEARCH_APPOINTMENTS": {
      const params = new URLSearchParams({
        locationId: locationId(),
        calendarId: p.calendarId as string,
        startTime: String(p.startTime),
        endTime: String(p.endTime),
      });
      return { method: "GET", path: `/calendars/events?${params.toString()}` };
    }
    case "CREATE_APPOINTMENT":
      return {
        method: "POST",
        path: "/calendars/events/appointments",
        body: {
          locationId: locationId(),
          calendarId: p.calendarId,
          contactId: p.contactId,
          startTime: p.startTime,
          endTime: p.endTime,
          title: p.title,
          ...(p.ignoreFreeSlotValidation ? { ignoreFreeSlotValidation: true } : {}),
        },
      };
    case "UPDATE_APPOINTMENT":
      return {
        method: "PUT",
        path: `/calendars/events/appointments/${p.appointmentId}`,
        body: omit(p, ["appointmentId"]),
      };
    case "DELETE_APPOINTMENT":
      // GHL's delete endpoint is /calendars/events/:id, not the
      // .../appointments/:id path create/get/update use — see
      // lib/ghl/client.ts's class doc comment for the live verification.
      return { method: "DELETE", path: `/calendars/events/${p.appointmentId}` };

    case "LIST_WORKFLOWS":
      return { method: "GET", path: `/workflows/?locationId=${locationId()}` };
    case "ADD_CONTACT_TO_WORKFLOW":
      return { method: "POST", path: `/contacts/${p.contactId}/workflow/${p.workflowId}`, body: {} };
    case "REMOVE_CONTACT_FROM_WORKFLOW":
      return { method: "DELETE", path: `/contacts/${p.contactId}/workflow/${p.workflowId}`, body: {} };

    case "LIST_CAMPAIGNS":
      return { method: "GET", path: `/campaigns/?locationId=${locationId()}` };
  }
}

function omit(payload: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (!keys.includes(key)) result[key] = value;
  }
  return result;
}
