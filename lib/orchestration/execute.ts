import "server-only";
import { isAllowedAction, MUTATION_TIER, type AllowedAction } from "@/lib/actions/allowlist";
import { getAgentAdapter } from "@/lib/agent";
import { getGhlClient } from "@/lib/ghl";
import type { GhlClient } from "@/lib/ghl/types";
import { getN8nClient } from "@/lib/n8n";
import { attachGhlRequest } from "@/lib/n8n/client";
import {
  matchByNameExactThenFuzzy,
  resolveCalendarId,
  resolveContactId,
  resolveLeadAssignment,
  resolveOpportunityId,
  resolvePipelineMutation,
  resolvePipelineStage,
} from "./resolvers";
import {
  createAutomationAction,
  createAutomationRequest,
  createExecutionLog,
  findAutomationRequestByIdempotencyKey,
  getAutomationRequestById,
  updateAutomationAction,
  updateAutomationRequest,
} from "@/lib/supabase/queries";
import type {
  AgentAdapterType,
  ExecuteResult,
  ExecutedActionResult,
  ProposedAction,
  RequestStatus,
} from "@/lib/types/domain";

export function resolveAgentAdapterType(): AgentAdapterType {
  return process.env.AGENT_ADAPTER === "openclaw" ? "openclaw" : "mock";
}

function overallStatus(results: ExecutedActionResult[]): RequestStatus {
  if (results.length === 0) return "failed";
  const successCount = results.filter((r) => r.status === "success").length;
  if (successCount === results.length) return "success";
  if (successCount === 0) return "failed";
  return "partial_failure";
}

// Actions that operate on a contact that may only be known by name/email
// (contactLookupHint) rather than a real GoHighLevel contactId yet.
const NEEDS_CONTACT_RESOLUTION = new Set<AllowedAction>([
  "GET_CONTACT",
  "UPDATE_CONTACT",
  "DELETE_CONTACT",
  "ADD_CONTACT_TAG",
  "REMOVE_CONTACT_TAG",
  "ASSIGN_LEAD",
  "CREATE_OPPORTUNITY",
  "UPDATE_OPPORTUNITY",
  "DELETE_OPPORTUNITY",
  "LIST_TASKS",
  "GET_TASK",
  "CREATE_TASK",
  "UPDATE_TASK",
  "DELETE_TASK",
  "ADD_NOTE",
  "SEARCH_CONVERSATIONS",
  "SEND_MESSAGE",
  "CREATE_APPOINTMENT",
]);

// Actions that operate on "the contact's opportunity" and may need it
// resolved from a contactId rather than a known opportunityId.
const NEEDS_OPPORTUNITY_RESOLUTION = new Set<AllowedAction>(["UPDATE_OPPORTUNITY", "DELETE_OPPORTUNITY"]);

// Actions that may carry a pipeline/stage name hint instead of real IDs.
const NEEDS_PIPELINE_STAGE_RESOLUTION = new Set<AllowedAction>(["CREATE_OPPORTUNITY", "UPDATE_OPPORTUNITY"]);

// Actions that mutate a pipeline or its stages — need the pipeline (and,
// for stage-level actions, its current full stage list) resolved first.
const NEEDS_PIPELINE_MUTATION_RESOLUTION = new Set<AllowedAction>([
  "UPDATE_PIPELINE",
  "CREATE_PIPELINE_STAGE",
  "UPDATE_PIPELINE_STAGE",
  "DELETE_PIPELINE_STAGE",
  "DELETE_PIPELINE",
]);

// Actions that may carry an assignedToNameHint instead of a real GHL user ID.
const NEEDS_LEAD_ASSIGNMENT_RESOLUTION = new Set<AllowedAction>(["ASSIGN_LEAD"]);

// Actions that may carry a calendarNameHint instead of a real GHL calendarId.
const NEEDS_CALENDAR_RESOLUTION = new Set<AllowedAction>(["CREATE_APPOINTMENT", "SEARCH_APPOINTMENTS"]);

/**
 * Resolves every name/email/pipeline-name hint on a payload to real
 * GoHighLevel IDs, in dependency order (contact -> opportunity -> pipeline
 * stage), before an action is ever dispatched. Never invents an ID: any
 * resolution failure is returned as a clear, specific error.
 */
async function resolveReferences(
  actionType: AllowedAction,
  payload: Record<string, unknown>,
): Promise<{ payload: Record<string, unknown>; error?: string }> {
  const ghl = getGhlClient();
  let current = payload;

  if (NEEDS_CONTACT_RESOLUTION.has(actionType)) {
    const resolved = await resolveContactId(ghl, current);
    if (resolved.error) return resolved;
    current = resolved.payload;
  }

  if (NEEDS_OPPORTUNITY_RESOLUTION.has(actionType)) {
    const resolved = await resolveOpportunityId(ghl, current);
    if (resolved.error) return resolved;
    current = resolved.payload;
  }

  if (NEEDS_PIPELINE_STAGE_RESOLUTION.has(actionType)) {
    const resolved = await resolvePipelineStage(ghl, current);
    if (resolved.error) return resolved;
    current = resolved.payload;
  }

  if (NEEDS_PIPELINE_MUTATION_RESOLUTION.has(actionType)) {
    const resolved = await resolvePipelineMutation(
      ghl,
      actionType as "UPDATE_PIPELINE" | "CREATE_PIPELINE_STAGE" | "UPDATE_PIPELINE_STAGE" | "DELETE_PIPELINE_STAGE" | "DELETE_PIPELINE",
      current,
    );
    if (resolved.error) return resolved;
    current = resolved.payload;
  }

  if (NEEDS_LEAD_ASSIGNMENT_RESOLUTION.has(actionType)) {
    const resolved = await resolveLeadAssignment(ghl, current);
    if (resolved.error) return resolved;
    current = resolved.payload;
  }

  if (NEEDS_CALENDAR_RESOLUTION.has(actionType)) {
    const resolved = await resolveCalendarId(ghl, current);
    if (resolved.error) return resolved;
    current = resolved.payload;
  }

  return { payload: current };
}

/**
 * Dispatches one already-proposed, already-allowlisted action: resolves
 * references, validates, builds the GHL request, sends it to n8n, logs the
 * execution, and updates the action's status. Shared by both the
 * text-command path (executeAutomationRequest, below) and the file-upload
 * path (lib/files/execute-plan.ts) — this is the single execution engine
 * both text and file input converge into, per ARCHITECTURE.md's "one
 * system, two input methods" principle.
 */
export async function dispatchAction(
  requestId: string,
  proposed: ProposedAction,
  contactIdOverride?: string,
): Promise<ExecutedActionResult> {
  if (!isAllowedAction(proposed.type)) {
    await createExecutionLog({
      requestId,
      actionId: null,
      workflowName: "allowlist-check",
      status: "failed",
      errorMessage: `Action type "${proposed.type}" is not in the allowlist and was rejected.`,
    });
    return { type: proposed.type as AllowedAction, status: "failed", error: "Action type is not in the allowlist." };
  }

  let payload =
    contactIdOverride && NEEDS_CONTACT_RESOLUTION.has(proposed.type)
      ? { ...proposed.payload, contactId: contactIdOverride }
      : proposed.payload;

  const resolved = await resolveReferences(proposed.type, payload);
  if (resolved.error) {
    const action = await createAutomationAction({ requestId, actionType: proposed.type, payload });
    await createExecutionLog({
      requestId,
      actionId: action.id,
      workflowName: "reference-resolution",
      status: "failed",
      errorMessage: resolved.error,
    });
    await updateAutomationAction(action.id, { status: "failed", response: { error: resolved.error } });
    return { type: proposed.type, status: "failed", error: resolved.error };
  }
  payload = resolved.payload;

  const action = await createAutomationAction({ requestId, actionType: proposed.type, payload });
  await updateAutomationAction(action.id, { status: "validated" });

  const n8n = getN8nClient();
  let execution;
  try {
    execution = await n8n.execute(
      attachGhlRequest({ requestId, actionId: action.id, actionType: proposed.type, payload }),
    );
  } catch (error) {
    execution = {
      ok: false as const,
      workflowName: "n8n-adapter",
      durationMs: 0,
      error: error instanceof Error ? error.message : "Unknown, unhandled n8n adapter error.",
    };
  }

  await createExecutionLog({
    requestId,
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

  return {
    type: proposed.type,
    status: execution.ok ? "success" : "failed",
    ...(execution.error ? { error: execution.error } : {}),
  };
}

/**
 * The full THINK -> DO pipeline for one natural-language user request:
 *   1. record the request (Supabase)
 *   2. ask the agent adapter (OpenClaw or mock) what to do (THINK)
 *   3. re-validate every proposed action against the allowlist, independent
 *      of whether the agent adapter already filtered — defense in depth
 *   4. if any proposed action is destructive (MUTATION_TIER), stop and
 *      return status "awaiting_confirmation" instead of running it — the
 *      caller must resubmit with confirm:true and confirmRequestId
 *   5. dispatch each validated action to the n8n adapter (DO)
 *   6. log every execution and update statuses
 *   7. return the structured result the API/dashboard render
 */
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
  /** Set true to proceed past the destructive-action confirmation gate. */
  confirm?: boolean;
  /** Resume a request that previously returned "awaiting_confirmation". */
  confirmRequestId?: string;
}): Promise<ExecuteResult> {
  if (params.confirmRequestId) {
    return resumeAwaitingConfirmation(params.confirmRequestId, params.contactIdOverride);
  }

  if (params.idempotencyKey) {
    const existing = await findAutomationRequestByIdempotencyKey(params.idempotencyKey);
    if (existing && existing.status !== "awaiting_confirmation") {
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
    await createExecutionLog({ requestId: request.id, actionId: null, workflowName: "agent", status: "failed", errorMessage: message });
    await updateAutomationRequest(request.id, { status: "failed", completedAt: new Date().toISOString() });
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
        "Could not map this request to any allowed action. Try naming the operation explicitly (e.g. \"update\", \"create\", \"move ... to ...\", \"add tag\") and the person/record it applies to.",
    });
    await updateAutomationRequest(request.id, { status: "failed", completedAt: new Date().toISOString() });
    return { requestId: request.id, status: "failed", intent: proposal.intent, actions: [] };
  }

  return dispatchProposal(request.id, proposal.intent, proposal.actions, params.contactIdOverride, params.confirm);
}

/**
 * Executes an already-structured list of actions (from a parsed CSV/PDF/
 * Markdown file, after the user has reviewed and approved it) through the
 * exact same allowlist-check -> reference-resolution -> n8n-dispatch ->
 * audit-log engine that a typed text command uses (dispatchProposal, just
 * below). This is what "one system, two input methods" means concretely:
 * a file upload never gets its own execution path.
 */
export async function executeStructuredActions(params: {
  intent: string;
  actions: ProposedAction[];
  contactIdOverride?: string;
  confirm?: boolean;
}): Promise<ExecuteResult> {
  const request = await createAutomationRequest({
    userRequest: `[file upload] ${params.intent}`,
    agentAdapterType: resolveAgentAdapterType(),
  });
  await updateAutomationRequest(request.id, { status: "interpreting", intent: params.intent });
  return dispatchProposal(request.id, params.intent, params.actions, params.contactIdOverride, params.confirm);
}

// Never expand more than this many opportunities from one bulk-move
// command in a single request — a safety cap, not a real-world limit
// (every pipeline in this account today has well under this many).
const MAX_BULK_EXPANSION = 50;

/**
 * Replaces a single "move all opportunities in [pipeline] to [stage]"
 * marker action (payload.bulkPipelineNameHint, produced by the mock
 * adapter and the equivalent OpenClaw tool call) with one real
 * UPDATE_OPPORTUNITY action per opportunity CURRENTLY in that pipeline —
 * fetched live from GoHighLevel, never invented. Any other action passes
 * through unchanged. A pipeline that can't be resolved, or that has no
 * opportunities, becomes a single synthetic "failed" result explaining
 * why instead of being silently dropped.
 */
export async function expandBulkOpportunityMoves(
  actions: ProposedAction[],
  ghl: GhlClient = getGhlClient(),
): Promise<{ actions: ProposedAction[]; errors: ExecutedActionResult[] }> {
  const expanded: ProposedAction[] = [];
  const errors: ExecutedActionResult[] = [];

  for (const proposed of actions) {
    const pipelineNameHint = proposed.payload?.bulkPipelineNameHint;
    if (proposed.type !== "UPDATE_OPPORTUNITY" || typeof pipelineNameHint !== "string") {
      expanded.push(proposed);
      continue;
    }

    const stageNameHint = typeof proposed.payload.stageNameHint === "string" ? proposed.payload.stageNameHint : undefined;

    try {
      const pipelines = await ghl.listPipelines();
      const matches = matchByNameExactThenFuzzy(pipelines, (p) => p.name, pipelineNameHint);
      if (matches.length === 0) {
        const available = pipelines.map((p) => p.name).join(", ") || "none configured";
        errors.push({
          type: "UPDATE_OPPORTUNITY",
          status: "failed",
          error: `No pipeline found matching "${pipelineNameHint}". Available pipelines: ${available}.`,
        });
        continue;
      }
      if (matches.length > 1) {
        errors.push({
          type: "UPDATE_OPPORTUNITY",
          status: "failed",
          error: `"${pipelineNameHint}" matches more than one pipeline (${matches.map((p) => p.name).join(", ")}) — please be more specific.`,
        });
        continue;
      }

      const pipeline = matches[0]!;
      const opportunities = await ghl.searchOpportunities({ pipelineId: pipeline.id });
      if (opportunities.length === 0) {
        errors.push({
          type: "UPDATE_OPPORTUNITY",
          status: "failed",
          error: `Pipeline "${pipeline.name}" has no opportunities to move.`,
        });
        continue;
      }

      if (opportunities.length > MAX_BULK_EXPANSION) {
        errors.push({
          type: "UPDATE_OPPORTUNITY",
          status: "failed",
          error: `Pipeline "${pipeline.name}" has ${opportunities.length} opportunities — only the first ${MAX_BULK_EXPANSION} were queued below. Run this command again to move the rest.`,
        });
      }

      for (const opp of opportunities.slice(0, MAX_BULK_EXPANSION)) {
        expanded.push({
          type: "UPDATE_OPPORTUNITY",
          payload: {
            // contactId comes straight off the real opportunity record so
            // resolveContactId (which every UPDATE_OPPORTUNITY goes
            // through) has a usable ID and doesn't try to search for a
            // contact by name — there's no name to search by here.
            ...(opp.contactId ? { contactId: opp.contactId } : {}),
            opportunityId: opp.id,
            pipelineId: pipeline.id,
            ...(stageNameHint ? { stageNameHint } : {}),
          },
        });
      }
    } catch (error) {
      errors.push({
        type: "UPDATE_OPPORTUNITY",
        status: "failed",
        error: error instanceof Error ? error.message : `Failed to expand bulk move for pipeline "${pipelineNameHint}".`,
      });
    }
  }

  return { actions: expanded, errors };
}

/**
 * Only actions marked "destructive" in MUTATION_TIER ever require
 * confirmation — everything else in the same batch (contact creates,
 * tags, tasks, notes, non-destructive opportunity moves, etc.) dispatches
 * immediately, regardless of what else is in the batch. An earlier
 * version of this function paused the ENTIRE batch the moment any one
 * action was destructive, which meant a single SEND_MESSAGE or DELETE_*
 * in a large file plan blocked dozens of unrelated, perfectly safe
 * actions too — that was a real bug, not the intended design (see
 * ARCHITECTURE.md's safety model: confirmation scales with an action's
 * own risk, not its neighbors').
 */
async function dispatchProposal(
  requestId: string,
  intent: string,
  actions: ProposedAction[],
  contactIdOverride: string | undefined,
  confirm: boolean | undefined,
): Promise<ExecuteResult> {
  const { actions: expandedActions, errors: expansionErrors } = await expandBulkOpportunityMoves(actions);

  const destructiveActions: ProposedAction[] = [];
  const safeActions: ProposedAction[] = [];
  for (const proposed of expandedActions) {
    if (isAllowedAction(proposed.type) && MUTATION_TIER[proposed.type] === "destructive") {
      destructiveActions.push(proposed);
    } else {
      safeActions.push(proposed);
    }
  }

  await updateAutomationRequest(requestId, { status: "executing" });
  const results: ExecutedActionResult[] = [...expansionErrors];
  for (const proposed of safeActions) {
    results.push(await dispatchAction(requestId, proposed, contactIdOverride));
  }

  if (destructiveActions.length > 0 && !confirm) {
    for (const proposed of destructiveActions) {
      if (!isAllowedAction(proposed.type)) {
        results.push({ type: proposed.type as AllowedAction, status: "failed", error: "Action type is not in the allowlist." });
        continue;
      }
      const action = await createAutomationAction({
        requestId,
        actionType: proposed.type,
        payload: proposed.payload,
        status: "pending_approval",
      });
      results.push({ type: action.actionType, status: "pending_approval", payload: proposed.payload });
    }
    await updateAutomationRequest(requestId, { status: "awaiting_confirmation" });
    return { requestId, status: "awaiting_confirmation", intent, actions: results, confirmRequestId: requestId };
  }

  for (const proposed of destructiveActions) {
    results.push(await dispatchAction(requestId, proposed, contactIdOverride));
  }

  const finalStatus = overallStatus(results);
  await updateAutomationRequest(requestId, { status: finalStatus, completedAt: new Date().toISOString() });
  return { requestId, status: finalStatus, intent, actions: results };
}

export async function resumeAwaitingConfirmation(requestId: string, contactIdOverride?: string): Promise<ExecuteResult> {
  const existing = await getAutomationRequestById(requestId);
  if (!existing) {
    return { requestId, status: "failed", intent: null, actions: [{ type: "SEARCH_CONTACTS", status: "failed", error: "No such request to confirm." }] };
  }
  if (existing.status !== "awaiting_confirmation") {
    return {
      requestId,
      status: existing.status,
      intent: existing.intent,
      actions: existing.actions.map((a) => ({ type: a.actionType, status: a.status })),
    };
  }

  await updateAutomationRequest(requestId, { status: "executing" });
  const results: ExecutedActionResult[] = [];
  for (const action of existing.actions) {
    // Only actions still pending_approval were held back — anything else
    // (a safe action from the same batch) already ran before the gate and
    // must never be re-dispatched here, or it would run twice for real.
    if (action.status === "pending_approval") {
      results.push(await dispatchAction(requestId, { type: action.actionType, payload: action.payload }, contactIdOverride));
    } else {
      const errorMessage = typeof action.response?.error === "string" ? action.response.error : undefined;
      results.push({ type: action.actionType, status: action.status, ...(errorMessage ? { error: errorMessage } : {}) });
    }
  }

  const finalStatus = overallStatus(results);
  await updateAutomationRequest(requestId, { status: finalStatus, completedAt: new Date().toISOString() });
  return { requestId, status: finalStatus, intent: existing.intent, actions: results };
}
