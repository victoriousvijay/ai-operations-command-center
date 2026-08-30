import "server-only";
import type { GhlClient } from "@/lib/ghl/types";
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
