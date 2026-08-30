import "server-only";
import { fetchWithRetry } from "@/lib/http/fetch-with-retry";
import { getGhlClient } from "@/lib/ghl";
import { validatePayload } from "./validation";
import { WORKFLOW_BY_ACTION, type N8nClient, type N8nExecuteRequest, type N8nExecuteResult } from "./types";

/**
 * Real n8n adapter — POSTs to an authenticated n8n webhook per the
 * architecture's modular workflow design (one webhook per workflow,
 * mapped by action type in WORKFLOW_BY_ACTION). The shared secret is sent
 * as a header and is expected to be checked by each workflow's webhook
 * node (a Header Auth credential in n8n).
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

      const data = (await response.json()) as { response?: Record<string, unknown> };
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
        case "GET_CONTACT": {
          const contact = await ghl.getContact(payload.contactId as string);
          response = { contact };
          break;
        }
        case "UPDATE_CONTACT": {
          const contact = await ghl.updateContact(
            payload as { contactId: string } & Record<string, unknown>,
          );
          response = { contact };
          break;
        }
        case "GET_OPPORTUNITY": {
          const opportunity = await ghl.getOpportunity(payload.opportunityId as string);
          response = { opportunity };
          break;
        }
        case "UPDATE_OPPORTUNITY": {
          const opportunity = await ghl.updateOpportunity(
            payload as { opportunityId: string } & Record<string, unknown>,
          );
          response = { opportunity };
          break;
        }
        case "CREATE_TASK": {
          const task = await ghl.createTask(
            payload as { contactId: string; title: string; dueDate: string },
          );
          response = { task };
          break;
        }
        case "ADD_NOTE": {
          const note = await ghl.addNote(payload as { contactId: string; body: string });
          response = { note };
          break;
        }
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
