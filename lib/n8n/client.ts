import "server-only";
import { fetchWithRetry } from "@/lib/http/fetch-with-retry";
import { buildGhlRequest } from "@/lib/actions/registry";
import { getGhlClient } from "@/lib/ghl";
import { validatePayload } from "./validation";
import { WORKFLOW_BY_ACTION, type N8nClient, type N8nExecuteRequest, type N8nExecuteResult } from "./types";

export { resolveContactId } from "@/lib/orchestration/resolvers";

/**
 * Real n8n adapter — POSTs to an authenticated n8n webhook per the
 * architecture's modular workflow design (one webhook per workflow,
 * mapped by action type in WORKFLOW_BY_ACTION). The shared secret is sent
 * as a header and is expected to be checked by each workflow's webhook
 * node (a Header Auth credential in n8n). `ghlRequest` (built by
 * lib/actions/registry.ts) tells the workflow's single generic HTTP node
 * exactly what to execute — n8n itself never decides that.
 */
export class HttpN8nClient implements N8nClient {
  constructor(
    private readonly baseUrl: string,
    private readonly webhookSecret: string,
  ) {}

  async execute(request: N8nExecuteRequest): Promise<N8nExecuteResult> {
    const workflowName = WORKFLOW_BY_ACTION[request.actionType];
    const url = `${this.baseUrl.replace(/\/$/, "")}/webhook/${workflowName}`;
    const startedAt = Date.now();

    try {
      const response = await fetchWithRetry(url, {
        method: "POST",
        timeoutMs: 15_000,
        retries: 1,
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Secret": this.webhookSecret,
        },
        body: JSON.stringify(request),
      });

      const durationMs = Date.now() - startedAt;

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        return {
          ok: false,
          workflowName,
          durationMs,
          error: `n8n webhook returned ${response.status}: ${body.slice(0, 500)}`,
        };
      }

      // A 2xx status only means the webhook itself responded — it does not
      // mean the workflow's own logic succeeded. Trust the body's own `ok`
      // field (set by the workflow's error branch, see n8n/workflows/) over
      // the HTTP status alone.
      const data = (await response.json()) as {
        ok?: boolean;
        response?: Record<string, unknown>;
        error?: { message?: string };
      };

      if (data.ok === false) {
        return {
          ok: false,
          workflowName,
          durationMs,
          error: data.error?.message ?? "n8n workflow reported failure with no error message.",
        };
      }

      return { ok: true, workflowName, durationMs, response: data.response };
    } catch (error) {
      return {
        ok: false,
        workflowName,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : "Unknown n8n dispatch error.",
      };
    }
  }
}

/**
 * MOCK MODE — runs the same validate -> call GHL -> respond contract that
 * the real n8n workflow would run, in-process. This is what makes the
 * end-to-end demo runnable without a live n8n instance: it is not a stub
 * that fakes success, it genuinely validates the payload against the same
 * schema n8n would use and calls the same GHL adapter n8n would call
 * (mock or real, depending on GHL_ADAPTER).
 */
export class MockN8nClient implements N8nClient {
  async execute(request: N8nExecuteRequest): Promise<N8nExecuteResult> {
    const workflowName = WORKFLOW_BY_ACTION[request.actionType];
    const startedAt = Date.now();

    const validation = validatePayload(request.actionType, request.payload);
    if (!validation.success) {
      return {
        ok: false,
        workflowName,
        durationMs: Date.now() - startedAt,
        error: `Validation failed: ${validation.error}`,
      };
    }

    const ghl = getGhlClient();
    const payload = validation.data;

    try {
      let response: Record<string, unknown>;

      switch (request.actionType) {
        case "SEARCH_CONTACTS":
          response = { contacts: await ghl.searchContacts(payload as { query: string }) };
          break;
        case "GET_CONTACT":
          response = { contact: await ghl.getContact(payload.contactId as string) };
          break;
        case "CREATE_CONTACT":
          response = { contact: await ghl.createContact(payload) };
          break;
        case "UPDATE_CONTACT":
          response = { contact: await ghl.updateContact(payload as { contactId: string } & Record<string, unknown>) };
          break;
        case "UPSERT_CONTACT":
          response = await ghl.upsertContact(payload);
          break;
        case "DELETE_CONTACT":
          response = await ghl.deleteContact(payload.contactId as string);
          break;
        case "ADD_CONTACT_TAG":
          response = await ghl.addContactTag(payload as { contactId: string; tags: string[] });
          break;
        case "REMOVE_CONTACT_TAG":
          response = await ghl.removeContactTag(payload as { contactId: string; tags: string[] });
          break;
        case "ASSIGN_LEAD":
          response = { contact: await ghl.assignLead(payload as { contactId: string; assignedToUserId: string }) };
          break;

        case "SEARCH_OPPORTUNITIES":
          response = { opportunities: await ghl.searchOpportunities(payload) };
          break;
        case "GET_OPPORTUNITY":
          response = { opportunity: await ghl.getOpportunity(payload.opportunityId as string) };
          break;
        case "CREATE_OPPORTUNITY":
          response = { opportunity: await ghl.createOpportunity(payload as never) };
          break;
        case "UPDATE_OPPORTUNITY":
          response = { opportunity: await ghl.updateOpportunity(payload as { opportunityId: string } & Record<string, unknown>) };
          break;
        case "DELETE_OPPORTUNITY":
          response = await ghl.deleteOpportunity(payload.opportunityId as string);
          break;

        case "LIST_PIPELINES":
          response = { pipelines: await ghl.listPipelines() };
          break;
        case "CREATE_PIPELINE":
          response = { pipeline: await ghl.createPipeline(payload as never) };
          break;
        case "UPDATE_PIPELINE":
        case "CREATE_PIPELINE_STAGE":
        case "UPDATE_PIPELINE_STAGE":
        case "DELETE_PIPELINE_STAGE":
          response = { pipeline: await ghl.updatePipeline(payload as never) };
          break;
        case "DELETE_PIPELINE":
          response = await ghl.deletePipeline(payload.pipelineId as string);
          break;

        case "LIST_TASKS":
          response = { tasks: await ghl.listTasks(payload.contactId as string) };
          break;
        case "GET_TASK":
          response = { task: await ghl.getTask(payload.contactId as string, payload.taskId as string) };
          break;
        case "CREATE_TASK":
          response = { task: await ghl.createTask(payload as { contactId: string; title: string; dueDate: string }) };
          break;
        case "UPDATE_TASK":
          response = { task: await ghl.updateTask(payload as { contactId: string; taskId: string }) };
          break;
        case "DELETE_TASK":
          response = await ghl.deleteTask(payload.contactId as string, payload.taskId as string);
          break;

        case "ADD_NOTE":
          response = { note: await ghl.addNote(payload as { contactId: string; body: string }) };
          break;

        case "LIST_CUSTOM_FIELDS":
          response = { customFields: await ghl.listCustomFields() };
          break;
        case "CREATE_CUSTOM_FIELD":
          response = { customField: await ghl.createCustomField(payload as never) };
          break;
        case "UPDATE_CUSTOM_FIELD":
          response = { customField: await ghl.updateCustomField(payload as { customFieldId: string }) };
          break;
        case "DELETE_CUSTOM_FIELD":
          response = await ghl.deleteCustomField(payload.customFieldId as string);
          break;

        case "SEARCH_CONVERSATIONS":
          response = { conversations: await ghl.searchConversations(payload.contactId as string | undefined) };
          break;
        case "GET_CONVERSATION":
          response = { conversation: await ghl.getConversation(payload.conversationId as string) };
          break;
        case "SEND_MESSAGE":
          response = await ghl.sendMessage(payload as { contactId: string; message: string });
          break;

        case "LIST_CALENDARS":
          response = { calendars: await ghl.listCalendars() };
          break;
        case "CREATE_CALENDAR":
          response = { calendar: await ghl.createCalendar(payload as { name: string }) };
          break;
        case "DELETE_CALENDAR":
          response = await ghl.deleteCalendar(payload.calendarId as string);
          break;

        case "GET_APPOINTMENT":
          response = { appointment: await ghl.getAppointment(payload.appointmentId as string) };
          break;
        case "SEARCH_APPOINTMENTS":
          response = { appointments: await ghl.searchAppointments(payload as never) };
          break;
        case "CREATE_APPOINTMENT":
          response = { appointment: await ghl.createAppointment(payload as never) };
          break;
        case "UPDATE_APPOINTMENT":
          response = { appointment: await ghl.updateAppointment(payload as never) };
          break;
        case "DELETE_APPOINTMENT":
          response = await ghl.deleteAppointment(payload.appointmentId as string);
          break;

        case "LIST_WORKFLOWS":
          response = { workflows: await ghl.listWorkflows() };
          break;
        case "ADD_CONTACT_TO_WORKFLOW":
          response = await ghl.addContactToWorkflow(payload as never);
          break;
        case "REMOVE_CONTACT_FROM_WORKFLOW":
          response = await ghl.removeContactFromWorkflow(payload as never);
          break;

        case "LIST_CAMPAIGNS":
          response = { campaigns: await ghl.listCampaigns() };
          break;
      }

      return { ok: true, workflowName, durationMs: Date.now() - startedAt, response };
    } catch (error) {
      return {
        ok: false,
        workflowName,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : "Unknown execution error.",
      };
    }
  }
}

/** Attaches the registry-built GHL request to an n8n dispatch payload. */
export function attachGhlRequest(request: Omit<N8nExecuteRequest, "ghlRequest">): N8nExecuteRequest {
  return { ...request, ghlRequest: buildGhlRequest(request.actionType, request.payload) };
}
