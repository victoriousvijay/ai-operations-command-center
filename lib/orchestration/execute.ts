import "server-only";
import { isAllowedAction } from "@/lib/actions/allowlist";
import { getAgentAdapter } from "@/lib/agent";
import { getGhlClient } from "@/lib/ghl";
import { getN8nClient, resolveContactId } from "@/lib/n8n";
import {
  createAutomationAction,
  createAutomationRequest,
  createExecutionLog,
  findAutomationRequestByIdempotencyKey,
  getAutomationRequestById,
  updateAutomationAction,
  updateAutomationRequest,
} from "@/lib/supabase/queries";
import type { AgentAdapterType, ExecuteResult, ExecutedActionResult, RequestStatus } from "@/lib/types/domain";

function resolveAgentAdapterType(): AgentAdapterType {
  return process.env.AGENT_ADAPTER === "openclaw" ? "openclaw" : "mock";
}

function overallStatus(results: ExecutedActionResult[]): RequestStatus {
  if (results.length === 0) return "failed";
  const successCount = results.filter((r) => r.status === "success").length;
  if (successCount === results.length) return "success";
  if (successCount === 0) return "failed";
  return "partial_failure";
}

/**
 * The full THINK -> DO pipeline for one user request:
 *   1. record the request (Supabase)
 *   2. ask the agent adapter (OpenClaw or mock) what to do (THINK)
 *   3. re-validate every proposed action against the allowlist, independent
 *      of whether the agent adapter already filtered — defense in depth
 *   4. dispatch each validated action to the n8n adapter (DO)
 *   5. log every execution and update statuses
 *   6. return the structured result the API/dashboard render
 */
const CONTACT_ACTION_TYPES = new Set(["GET_CONTACT", "UPDATE_CONTACT", "CREATE_TASK", "ADD_NOTE"]);

export async function executeAutomationRequest(params: {
  userRequest: string;
  idempotencyKey?: string;
  /**
   * Manual test override: a real GoHighLevel contact ID to use instead of
   * whatever the agent proposed (the mock agent can only synthesize a
   * placeholder ID — see lib/agent/mock-adapter.ts). Applied to every
   * contact-touching action in this request.
   */
  contactIdOverride?: string;
}): Promise<ExecuteResult> {
  if (params.idempotencyKey) {
    const existing = await findAutomationRequestByIdempotencyKey(params.idempotencyKey);
    if (existing) {
      const full = await getAutomationRequestById(existing.id);
      return {
        requestId: existing.id,
        status: existing.status,
        intent: existing.intent,
        actions: (full?.actions ?? []).map((action) => ({
          type: action.actionType,
          status: action.status,
        })),
      };
    }
  }

  const request = await createAutomationRequest({
    userRequest: params.userRequest,
    agentAdapterType: resolveAgentAdapterType(),
    idempotencyKey: params.idempotencyKey ?? null,
  });

  await updateAutomationRequest(request.id, { status: "interpreting" });

  let proposal;
  try {
    const agent = getAgentAdapter();
    proposal = await agent.propose(params.userRequest);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown agent error.";
    await createExecutionLog({
      requestId: request.id,
      actionId: null,
      workflowName: "agent",
      status: "failed",
      errorMessage: message,
    });
    await updateAutomationRequest(request.id, {
      status: "failed",
      completedAt: new Date().toISOString(),
    });
    return { requestId: request.id, status: "failed", intent: null, actions: [] };
  }

  await updateAutomationRequest(request.id, { intent: proposal.intent });

  if (proposal.actions.length === 0) {
    await createExecutionLog({
      requestId: request.id,
      actionId: null,
      workflowName: "agent",
      status: "failed",
      errorMessage:
        "The agent could not map this request to any allowed action (GET_CONTACT, GET_OPPORTUNITY, UPDATE_CONTACT, UPDATE_OPPORTUNITY, CREATE_TASK, ADD_NOTE).",
    });
    await updateAutomationRequest(request.id, {
      status: "failed",
      completedAt: new Date().toISOString(),
    });
    return { requestId: request.id, status: "failed", intent: proposal.intent, actions: [] };
  }

  await updateAutomationRequest(request.id, { status: "executing" });

  const n8n = getN8nClient();
  const results: ExecutedActionResult[] = [];

  for (const proposed of proposal.actions) {
    // Defense in depth: re-check the allowlist here even though every
    // agent adapter already only ever proposes allowed types.
    if (!isAllowedAction(proposed.type)) {
      await createExecutionLog({
        requestId: request.id,
        actionId: null,
        workflowName: "allowlist-check",
        status: "failed",
        errorMessage: `Action type "${proposed.type}" is not in the allowlist and was rejected.`,
      });
      continue;
    }

    let payload =
      params.contactIdOverride && CONTACT_ACTION_TYPES.has(proposed.type)
        ? { ...proposed.payload, contactId: params.contactIdOverride }
        : proposed.payload;

    // Resolve a name/email hint (from either adapter — the mock agent's
    // synthesized placeholder, or a real agent that left contactId empty
    // and set contactLookupHint) to a real GoHighLevel contact ID here,
    // once, before dispatch — so both the mock and real n8n adapters
    // always receive an already-resolved contactId. Real n8n workflows
    // have no resolution step of their own and would otherwise reject an
    // empty contactId at their input-validation stage.
    if (CONTACT_ACTION_TYPES.has(proposed.type)) {
      const resolved = await resolveContactId(getGhlClient(), payload);
      if (resolved.error) {
        const action = await createAutomationAction({
          requestId: request.id,
          actionType: proposed.type,
          payload,
        });
        await createExecutionLog({
          requestId: request.id,
          actionId: action.id,
          workflowName: "contact-resolution",
          status: "failed",
          errorMessage: resolved.error,
        });
        await updateAutomationAction(action.id, {
          status: "failed",
          response: { error: resolved.error },
        });
        results.push({ type: proposed.type, status: "failed", error: resolved.error });
        continue;
      }
      payload = resolved.payload;
    }

    const action = await createAutomationAction({
      requestId: request.id,
      actionType: proposed.type,
      payload,
    });
    await updateAutomationAction(action.id, { status: "validated" });

    // Defense in depth: an N8nClient's contract is to always resolve with a
    // structured result, never throw — but an adapter bug or an unexpected
    // exception from a real HTTP/API call underneath it must not be allowed
    // to leave this request stuck at "executing" forever.
    let execution;
    try {
      execution = await n8n.execute({
        requestId: request.id,
        actionId: action.id,
        actionType: proposed.type,
        payload,
      });
    } catch (error) {
      execution = {
        ok: false as const,
        workflowName: "n8n-adapter",
        durationMs: 0,
        error: error instanceof Error ? error.message : "Unknown, unhandled n8n adapter error.",
      };
    }

    await createExecutionLog({
      requestId: request.id,
      actionId: action.id,
      workflowName: execution.workflowName,
      status: execution.ok ? "success" : "failed",
      errorMessage: execution.error ?? null,
      durationMs: execution.durationMs,
    });

    await updateAutomationAction(action.id, {
      status: execution.ok ? "success" : "failed",
      response: execution.response ?? (execution.error ? { error: execution.error } : null),
    });

    results.push({
      type: proposed.type,
      status: execution.ok ? "success" : "failed",
      ...(execution.error ? { error: execution.error } : {}),
    });
  }

  const finalStatus = overallStatus(results);
  await updateAutomationRequest(request.id, {
    status: finalStatus,
    completedAt: new Date().toISOString(),
  });

  return { requestId: request.id, status: finalStatus, intent: proposal.intent, actions: results };
}
