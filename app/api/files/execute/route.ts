import { NextResponse } from "next/server";
import { z } from "zod";
import { isAllowedAction } from "@/lib/actions/allowlist";
import { executeStructuredActions, resumeAwaitingConfirmation } from "@/lib/orchestration/execute";

const plannedActionSchema = z.object({
  type: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
});

const executeRequestSchema = z.object({
  intent: z.string().trim().min(1).max(200).optional(),
  actions: z.array(plannedActionSchema).min(1).optional(),
  confirm: z.boolean().optional(),
  confirmRequestId: z.string().trim().min(1).optional(),
  contactIdOverride: z.string().trim().min(1).max(200).optional(),
});

/**
 * Section 14's APPROVAL -> EXECUTION step. Requires an explicit, human
 * review before anything reaches GoHighLevel: the dashboard calls
 * /api/files/parse first, shows the plan, and only calls this route once
 * the user clicks "Approve & Execute". Every action still goes through the
 * exact same allowlist/validation/confirmation machinery a typed command
 * does (lib/orchestration/execute.ts) — file input never bypasses it.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: { type: "invalid_request", message: "Request body must be valid JSON." } }, { status: 400 });
  }

  const parsed = executeRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: { type: "invalid_request", message: parsed.error.issues.map((i) => i.message).join("; ") } },
      { status: 400 },
    );
  }

  try {
    if (parsed.data.confirmRequestId) {
      const result = await resumeAwaitingConfirmation(parsed.data.confirmRequestId, parsed.data.contactIdOverride);
      return NextResponse.json({ ok: true, ...result });
    }

    if (!parsed.data.actions || parsed.data.actions.length === 0) {
      return NextResponse.json({ ok: false, error: { type: "invalid_request", message: "actions is required unless confirmRequestId is provided." } }, { status: 400 });
    }

    const invalid = parsed.data.actions.find((a) => !isAllowedAction(a.type));
    if (invalid) {
      return NextResponse.json({ ok: false, error: { type: "invalid_action", message: `"${invalid.type}" is not an allowed action.` } }, { status: 400 });
    }

    const result = await executeStructuredActions({
      intent: parsed.data.intent ?? "FILE_UPLOAD",
      actions: parsed.data.actions.map((a) => ({ type: a.type as never, payload: a.payload })),
      contactIdOverride: parsed.data.contactIdOverride,
      confirm: parsed.data.confirm,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: { type: "execution_error", message: error instanceof Error ? error.message : "Unknown error executing the file plan." } },
      { status: 500 },
    );
  }
}
