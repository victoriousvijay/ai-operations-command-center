import { z } from "zod";
import type { AllowedAction } from "@/lib/actions/allowlist";

/**
 * Per-action payload schemas. In production these validations run inside
 * the n8n workflow itself (see n8n/workflows/*.json); the mock adapter
 * (mock-adapter.ts) runs the same schemas in-process so "n8n validates
 * input" is genuinely exercised in the local/demo path, not skipped.
 */
export const payloadSchemas = {
  GET_CONTACT: z.object({ contactId: z.string().min(1) }),
  UPDATE_CONTACT: z.object({
    contactId: z.string().min(1),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    email: z.string().email().optional(),
    phone: z.string().optional(),
    tags: z.array(z.string()).optional(),
  }),
  GET_OPPORTUNITY: z.object({ opportunityId: z.string().min(1) }),
  UPDATE_OPPORTUNITY: z.object({
    opportunityId: z.string().min(1),
    pipelineId: z.string().optional(),
    pipelineStageId: z.string().optional(),
    status: z.enum(["open", "won", "lost", "abandoned"]).optional(),
    name: z.string().optional(),
  }),
  CREATE_TASK: z.object({
    contactId: z.string().min(1),
    title: z.string().min(1),
    dueDate: z.string().min(1),
    body: z.string().optional(),
  }),
  ADD_NOTE: z.object({
    contactId: z.string().min(1),
    body: z.string().min(1),
  }),
} as const satisfies Record<AllowedAction, z.ZodTypeAny>;

export function validatePayload(
  actionType: AllowedAction,
  payload: Record<string, unknown>,
): { success: true; data: Record<string, unknown> } | { success: false; error: string } {
  const schema = payloadSchemas[actionType];
  const result = schema.safeParse(payload);
  if (!result.success) {
    return { success: false, error: result.error.issues.map((i) => i.message).join("; ") };
  }
  return { success: true, data: result.data as Record<string, unknown> };
}
