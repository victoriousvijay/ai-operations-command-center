import { z } from "zod";
import type { AllowedAction } from "@/lib/actions/allowlist";

/**
 * Per-action payload schemas. In production these validations run before
 * a request ever reaches n8n (lib/orchestration/execute.ts); the mock n8n
 * adapter (lib/n8n/client.ts's MockN8nClient) runs the same schemas
 * in-process so "input is validated" is genuinely exercised in the
 * local/demo path, not skipped.
 */
export const payloadSchemas = {
  SEARCH_CONTACTS: z.object({ query: z.string().min(1) }),
  GET_CONTACT: z.object({ contactId: z.string().min(1), contactLookupHint: z.string().optional() }),
  CREATE_CONTACT: z.object({
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    name: z.string().optional(),
    email: z.string().email().optional(),
    phone: z.string().optional(),
    companyName: z.string().optional(),
    tags: z.array(z.string()).optional(),
  }),
  UPDATE_CONTACT: z.object({
    contactId: z.string().min(1),
    contactLookupHint: z.string().optional(),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    email: z.string().email().optional(),
    phone: z.string().optional(),
    tags: z.array(z.string()).optional(),
  }),
  UPSERT_CONTACT: z
    .object({
      email: z.string().email().optional(),
      phone: z.string().optional(),
      firstName: z.string().optional(),
      lastName: z.string().optional(),
      name: z.string().optional(),
      tags: z.array(z.string()).optional(),
    })
    .refine((v) => Boolean(v.email || v.phone), {
      message: "UPSERT_CONTACT requires at least an email or a phone to match against.",
    }),
  DELETE_CONTACT: z.object({ contactId: z.string().min(1), contactLookupHint: z.string().optional() }),
  ADD_CONTACT_TAG: z.object({
    contactId: z.string().min(1),
    contactLookupHint: z.string().optional(),
    tags: z.array(z.string().min(1)).min(1),
  }),
  REMOVE_CONTACT_TAG: z.object({
    contactId: z.string().min(1),
    contactLookupHint: z.string().optional(),
    tags: z.array(z.string().min(1)).min(1),
  }),

  SEARCH_OPPORTUNITIES: z.object({ contactId: z.string().optional(), query: z.string().optional() }),
  GET_OPPORTUNITY: z.object({ opportunityId: z.string().min(1) }),
  CREATE_OPPORTUNITY: z.object({
    contactId: z.string().min(1),
    contactLookupHint: z.string().optional(),
    pipelineId: z.string().min(1),
    pipelineStageId: z.string().min(1),
    pipelineNameHint: z.string().optional(),
    stageNameHint: z.string().optional(),
    name: z.string().min(1),
    monetaryValue: z.number().optional(),
    status: z.enum(["open", "won", "lost", "abandoned"]).optional(),
  }),
  UPDATE_OPPORTUNITY: z.object({
    opportunityId: z.string().optional(),
    contactId: z.string().optional(),
    contactLookupHint: z.string().optional(),
    opportunityLookupHint: z.boolean().optional(),
    pipelineId: z.string().optional(),
    pipelineStageId: z.string().optional(),
    stageNameHint: z.string().optional(),
    status: z.enum(["open", "won", "lost", "abandoned"]).optional(),
    name: z.string().optional(),
    monetaryValue: z.number().optional(),
  }),
  DELETE_OPPORTUNITY: z.object({
    opportunityId: z.string().optional(),
    contactId: z.string().optional(),
    contactLookupHint: z.string().optional(),
    opportunityLookupHint: z.boolean().optional(),
  }),

  LIST_PIPELINES: z.object({}),

  LIST_TASKS: z.object({ contactId: z.string().min(1), contactLookupHint: z.string().optional() }),
  GET_TASK: z.object({ contactId: z.string().min(1), contactLookupHint: z.string().optional(), taskId: z.string().min(1) }),
  CREATE_TASK: z.object({
    contactId: z.string().min(1),
    contactLookupHint: z.string().optional(),
    title: z.string().min(1),
    dueDate: z.string().min(1),
    body: z.string().optional(),
  }),
  UPDATE_TASK: z.object({
    contactId: z.string().min(1),
    contactLookupHint: z.string().optional(),
    taskId: z.string().min(1),
    title: z.string().optional(),
    body: z.string().optional(),
    dueDate: z.string().optional(),
    completed: z.boolean().optional(),
  }),
  DELETE_TASK: z.object({
    contactId: z.string().min(1),
    contactLookupHint: z.string().optional(),
    taskId: z.string().min(1),
  }),

  ADD_NOTE: z.object({
    contactId: z.string().min(1),
    contactLookupHint: z.string().optional(),
    body: z.string().min(1),
  }),

  LIST_CUSTOM_FIELDS: z.object({}),
  CREATE_CUSTOM_FIELD: z.object({
    name: z.string().min(1),
    dataType: z.string().min(1),
    model: z.enum(["contact", "opportunity"]),
  }),
  UPDATE_CUSTOM_FIELD: z.object({ customFieldId: z.string().min(1), name: z.string().optional() }),
  DELETE_CUSTOM_FIELD: z.object({ customFieldId: z.string().min(1) }),

  SEARCH_CONVERSATIONS: z.object({ contactId: z.string().optional(), contactLookupHint: z.string().optional() }),
  GET_CONVERSATION: z.object({ conversationId: z.string().min(1) }),
  SEND_MESSAGE: z.object({
    contactId: z.string().min(1),
    contactLookupHint: z.string().optional(),
    message: z.string().min(1),
    type: z.enum(["SMS", "Email"]).optional(),
  }),

  LIST_CALENDARS: z.object({}),
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
