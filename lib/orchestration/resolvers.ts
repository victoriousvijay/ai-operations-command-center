import "server-only";
import { GhlApiError, type GhlClient, type GhlPipeline } from "@/lib/ghl/types";
import { SYNTHETIC_CONTACT_PREFIX } from "@/lib/agent/mock-adapter";

type Resolved = { payload: Record<string, unknown>; error?: string };

/**
 * Turns a name/email hint into a real GoHighLevel contact ID. Never
 * invents a contact — if no real match exists, this returns a clear error
 * instead of a guess (ARCHITECTURE.md's "never invent IDs" rule).
 *
 * Mirrors the "Find Contact" step in the architecture's n8n workflow
 * design (Webhook -> Validate -> Find Contact -> Update Contact -> ...).
 * The mock agent has no way to resolve a real GHL contact, so it tags a
 * payload with `contactLookupHint` (a name or email) alongside a
 * synthesized contactId; this resolves that hint against the real GHL API
 * before the action runs, so a synthetic ID never gets silently passed off
 * as a real one.
 */
export async function resolveContactId(ghl: GhlClient, payload: Record<string, unknown>): Promise<Resolved> {
  const { contactLookupHint, ...rest } = payload;
  const contactId = rest.contactId as string | undefined;
  // A contactId is "usable" if it's present and not one of the mock
  // adapter's synthesized placeholders. A real agent (OpenClaw) or a
  // parsed CSV/PDF/Markdown row typically omits contactId entirely rather
  // than inventing a placeholder — both cases must trigger resolution.
  const hasUsableId = typeof contactId === "string" && contactId.length > 0 && !contactId.startsWith(SYNTHETIC_CONTACT_PREFIX);

  if (hasUsableId || process.env.GHL_ADAPTER !== "real") {
    return { payload: rest };
  }

  if (typeof contactLookupHint !== "string" || !contactLookupHint) {
    return {
      payload: rest,
      error: `No real contactId available and no lookup hint (name/email) to search GoHighLevel with. Provide a real contactId via the dashboard's manual override to test this action against real data.`,
    };
  }

  const matches = await ghl.searchContacts({ query: contactLookupHint });
  const bestMatch = matches[0];
  if (!bestMatch) {
    return {
      payload: rest,
      error: `No GoHighLevel contact found matching "${contactLookupHint}". Provide a real contactId via the dashboard's manual override to test this action against real data.`,
    };
  }
  if (matches.length > 1) {
    const names = matches.map((m) => m.name ?? m.email ?? m.id).join(", ");
    return {
      payload: rest,
      error: `Multiple GoHighLevel contacts match "${contactLookupHint}": ${names}. Please provide a real contactId to disambiguate.`,
    };
  }

  return { payload: { ...rest, contactId: bestMatch.id } };
}

export const SYNTHETIC_OPPORTUNITY_PREFIX = "mock-opportunity-";
export const SYNTHETIC_STAGE_PREFIX = "mock-stage-";

/**
 * Turns "the contact's opportunity" into a real opportunityId by searching
 * opportunities for the already-resolved contactId. Never invents an
 * opportunity — if the contact has none, this errors instead of guessing.
 *
 * Mirrors resolveContactId's synthetic-ID gate: a real-looking opportunityId
 * (from OpenClaw, or a manual override) always passes through untouched; a
 * missing or mock-synthesized one only gets resolved against the live API
 * when GHL_ADAPTER=real, so pure mock mode keeps working unchanged.
 */
export async function resolveOpportunityId(ghl: GhlClient, payload: Record<string, unknown>): Promise<Resolved> {
  // opportunityLookupHint is just a boolean-ish marker ("resolve this from
  // the contact") — nothing downstream needs its value, only its absence
  // from the outgoing payload.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { opportunityLookupHint, ...rest } = payload;
  const opportunityId = rest.opportunityId as string | undefined;
  const isSynthetic = !opportunityId || opportunityId.startsWith(SYNTHETIC_OPPORTUNITY_PREFIX);

  if (!isSynthetic || process.env.GHL_ADAPTER !== "real") {
    return { payload: rest };
  }

  const contactId = rest.contactId as string | undefined;
  if (!contactId) {
    return { payload: rest, error: "No opportunityId was given and there is no contactId to look up an opportunity by." };
  }

  const matches = await ghl.searchOpportunities({ contactId });
  if (matches.length === 0) {
    return {
      payload: rest,
      error: `This contact has no opportunity in GoHighLevel yet. Create one first with CREATE_OPPORTUNITY, or provide a real opportunityId.`,
    };
  }
  if (matches.length > 1) {
    const names = matches.map((m) => m.name ?? m.id).join(", ");
    return {
      payload: rest,
      error: `This contact has multiple opportunities: ${names}. Please provide a real opportunityId to disambiguate.`,
    };
  }

  return { payload: { ...rest, opportunityId: matches[0]!.id } };
}

/**
 * Turns a pipeline/stage name hint (e.g. "move to AI Qualified") into real
 * pipelineId/pipelineStageId values by listing this location's real
 * pipelines and matching by name. Never creates a pipeline or stage that
 * doesn't already exist — if no match is found, this errors and explains
 * why rather than silently creating something (ARCHITECTURE.md section 6).
 */
export async function resolvePipelineStage(ghl: GhlClient, payload: Record<string, unknown>): Promise<Resolved> {
  const { pipelineNameHint, stageNameHint, ...rest } = payload;
  const stageId = rest.pipelineStageId as string | undefined;
  const isSynthetic = !stageId || stageId.startsWith(SYNTHETIC_STAGE_PREFIX);

  if (!isSynthetic || process.env.GHL_ADAPTER !== "real") {
    return { payload: rest };
  }
  if (typeof stageNameHint !== "string" || !stageNameHint) {
    // Nothing to resolve — let downstream payload validation report a
    // missing pipelineStageId if this action actually required one.
    return { payload: rest };
  }

  const pipelines = await ghl.listPipelines();
  let candidates = pipelines;
  if (typeof pipelineNameHint === "string" && pipelineNameHint) {
    const nameLower = pipelineNameHint.toLowerCase();
    candidates = pipelines.filter((p) => p.name.toLowerCase().includes(nameLower));
    if (candidates.length === 0) {
      const available = pipelines.map((p) => p.name).join(", ") || "none configured";
      return { payload: rest, error: `No GoHighLevel pipeline found matching "${pipelineNameHint}". Available pipelines: ${available}.` };
    }
  }

  const stageLower = stageNameHint.toLowerCase();
  const matches: Array<{ pipelineId: string; pipelineName: string; stageId: string; stageName: string }> = [];
  for (const pipeline of candidates) {
    for (const stage of pipeline.stages) {
      if (stage.name.toLowerCase() === stageLower || stage.name.toLowerCase().includes(stageLower)) {
        matches.push({ pipelineId: pipeline.id, pipelineName: pipeline.name, stageId: stage.id, stageName: stage.name });
      }
    }
  }

  if (matches.length === 0) {
    const available = candidates.flatMap((p) => p.stages.map((s) => `${p.name} > ${s.name}`)).join(", ") || "none";
    return { payload: rest, error: `No pipeline stage found matching "${stageNameHint}". Available stages: ${available}.` };
  }
  if (matches.length > 1) {
    const options = matches.map((m) => `${m.pipelineName} > ${m.stageName}`).join(", ");
    return { payload: rest, error: `"${stageNameHint}" matches stages in more than one pipeline (${options}) — please specify which pipeline.` };
  }

  const best = matches[0]!;
  return { payload: { ...rest, pipelineId: best.pipelineId, pipelineStageId: best.stageId } };
}

type PipelineMutationAction = "UPDATE_PIPELINE" | "CREATE_PIPELINE_STAGE" | "UPDATE_PIPELINE_STAGE" | "DELETE_PIPELINE_STAGE" | "DELETE_PIPELINE";

type StageRow = { id?: string; name: string; position: number };

/**
 * Resolves a pipeline-mutation action's pipeline (by ID or name hint) and,
 * for anything that touches stages, fetches the CURRENT full pipeline and
 * computes the complete merged `stages` array GoHighLevel's PUT requires —
 * see lib/ghl/client.ts's class doc comment for why a partial stages patch
 * isn't possible (PUT replaces the array wholesale and crashes if it's
 * omitted). Never invents a pipeline or stage: an unmatched or ambiguous
 * name hint is a clear error, never a guess.
 */
export async function resolvePipelineMutation(
  ghl: GhlClient,
  actionType: PipelineMutationAction,
  payload: Record<string, unknown>,
): Promise<Resolved> {
  const { pipelineNameHint, stageNameHint, ...rest } = payload;
  let pipelineId = rest.pipelineId as string | undefined;

  if (!pipelineId) {
    if (typeof pipelineNameHint !== "string" || !pipelineNameHint) {
      return { payload: rest, error: "No pipelineId was given and there is no pipeline name to look it up by." };
    }
    const pipelines = await ghl.listPipelines();
    const nameLower = pipelineNameHint.toLowerCase();
    const matches = pipelines.filter((p) => p.name.toLowerCase().includes(nameLower));
    if (matches.length === 0) {
      const available = pipelines.map((p) => p.name).join(", ") || "none configured";
      return { payload: rest, error: `No pipeline found matching "${pipelineNameHint}". Available pipelines: ${available}.` };
    }
    if (matches.length > 1) {
      return { payload: rest, error: `Multiple pipelines match "${pipelineNameHint}": ${matches.map((p) => p.name).join(", ")}. Please be more specific.` };
    }
    pipelineId = matches[0]!.id;
  }

  if (actionType === "DELETE_PIPELINE") {
    return { payload: { ...rest, pipelineId } };
  }

  let pipeline: GhlPipeline;
  try {
    pipeline = await ghl.getPipeline(pipelineId);
  } catch (error) {
    return { payload: rest, error: `Could not load pipeline "${pipelineId}": ${error instanceof Error ? error.message : "unknown error"}` };
  }

  const asStageRows = (): StageRow[] => pipeline.stages.map((s) => ({ id: s.id, name: s.name, position: s.position }));

  if (actionType === "UPDATE_PIPELINE") {
    return { payload: { ...rest, pipelineId, name: (rest.name as string | undefined) ?? pipeline.name, stages: asStageRows() } };
  }

  if (actionType === "CREATE_PIPELINE_STAGE") {
    const stageName = rest.stageName as string | undefined;
    if (!stageName) return { payload: rest, error: "CREATE_PIPELINE_STAGE requires a stage name." };
    const stages: StageRow[] = [...asStageRows(), { name: stageName, position: pipeline.stages.length }];
    return { payload: { ...rest, pipelineId, name: pipeline.name, stages } };
  }

  // UPDATE_PIPELINE_STAGE / DELETE_PIPELINE_STAGE both need to find one existing stage first.
  const stageId = rest.stageId as string | undefined;
  const stageLower = typeof stageNameHint === "string" ? stageNameHint.toLowerCase() : undefined;
  const stageMatches = pipeline.stages.filter((s) =>
    stageId ? s.id === stageId : stageLower ? s.name.toLowerCase().includes(stageLower) : false,
  );

  if (stageMatches.length === 0) {
    const available = pipeline.stages.map((s) => s.name).join(", ") || "none";
    return { payload: rest, error: `No stage found matching "${stageNameHint ?? stageId}" in pipeline "${pipeline.name}". Available stages: ${available}.` };
  }
  if (stageMatches.length > 1) {
    return { payload: rest, error: `"${stageNameHint}" matches multiple stages in "${pipeline.name}": ${stageMatches.map((s) => s.name).join(", ")}. Please be more specific.` };
  }
  const targetStageId = stageMatches[0]!.id;

  if (actionType === "UPDATE_PIPELINE_STAGE") {
    const newStageName = rest.newStageName as string | undefined;
    if (!newStageName) return { payload: rest, error: "UPDATE_PIPELINE_STAGE requires a newStageName." };
    const stages: StageRow[] = asStageRows().map((s) => (s.id === targetStageId ? { ...s, name: newStageName } : s));
    return { payload: { ...rest, pipelineId, name: pipeline.name, stages } };
  }

  // DELETE_PIPELINE_STAGE
  const stages: StageRow[] = asStageRows()
    .filter((s) => s.id !== targetStageId)
    .map((s, i) => ({ ...s, position: i }));
  return { payload: { ...rest, pipelineId, name: pipeline.name, stages } };
}

/**
 * Resolves ASSIGN_LEAD's target user. A real, already-known
 * assignedToUserId always passes through untouched — assigning by ID
 * needs no extra scope. Resolving assignedToNameHint to an ID requires
 * listing users (GET /users/), which this deployment's GHL Private
 * Integration Token does NOT currently have scope for (confirmed live:
 * 401 "not authorized for this scope") — that produces a specific,
 * actionable error naming exactly what's missing, never a guessed ID.
 */
export async function resolveLeadAssignment(ghl: GhlClient, payload: Record<string, unknown>): Promise<Resolved> {
  const { assignedToNameHint, ...rest } = payload;
  if (typeof rest.assignedToUserId === "string" && rest.assignedToUserId) {
    return { payload: rest };
  }

  if (typeof assignedToNameHint !== "string" || !assignedToNameHint) {
    return { payload: rest, error: "No assignedToUserId was given and there is no user/team name to look it up by." };
  }

  let users;
  try {
    users = await ghl.listUsers();
  } catch (error) {
    if (error instanceof GhlApiError && error.status === 401) {
      return {
        payload: rest,
        error: `Cannot look up "${assignedToNameHint}" by name — this GoHighLevel Private Integration Token doesn't have the "Users" scope. Either grant it (Settings -> Private Integrations -> enable Users read) or provide a real GoHighLevel user ID directly.`,
      };
    }
    return { payload: rest, error: `Could not list GoHighLevel users: ${error instanceof Error ? error.message : "unknown error"}` };
  }

  const nameLower = assignedToNameHint.toLowerCase();
  const matches = users.filter((u) => u.name.toLowerCase().includes(nameLower));
  if (matches.length === 0) {
    const available = users.map((u) => u.name).join(", ") || "none";
    return { payload: rest, error: `No GoHighLevel user found matching "${assignedToNameHint}". Available users: ${available}.` };
  }
  if (matches.length > 1) {
    return { payload: rest, error: `Multiple GoHighLevel users match "${assignedToNameHint}": ${matches.map((u) => u.name).join(", ")}. Please be more specific.` };
  }

  return { payload: { ...rest, assignedToUserId: matches[0]!.id } };
}
