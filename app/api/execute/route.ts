import { NextResponse } from "next/server";
import { z } from "zod";
import { executeAutomationRequest } from "@/lib/orchestration/execute";

const executeRequestSchema = z
  .object({
    userRequest: z.string().trim().min(1).max(2000).optional(),
    idempotencyKey: z.string().trim().min(1).max(200).optional(),
    // Manual test override: a real GHL contact ID, used instead of whatever
    // the agent proposed. See lib/orchestration/execute.ts.
    contactIdOverride: z.string().trim().min(1).max(200).optional(),
    // Resuming a request that previously returned "awaiting_confirmation"
    // (see lib/orchestration/execute.ts's confirmation gate) needs no
    // userRequest at all — it re-dispatches the already-proposed actions.
    confirm: z.boolean().optional(),
    confirmRequestId: z.string().trim().min(1).optional(),
  })
  .refine((v) => Boolean(v.confirmRequestId) || Boolean(v.userRequest), {
    message: "userRequest is required unless confirmRequestId is provided.",
  });

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: { type: "invalid_request", message: "Request body must be valid JSON." } },
      { status: 400 },
    );
  }

  const parsed = executeRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          type: "invalid_request",
          message: parsed.error.issues.map((issue) => issue.message).join("; "),
        },
      },
      { status: 400 },
    );
  }

  try {
    const result = await executeAutomationRequest({
      // Never actually read when confirmRequestId is set — see
      // executeAutomationRequest's early return for that case.
      userRequest: parsed.data.userRequest ?? "",
      idempotencyKey: parsed.data.idempotencyKey,
      contactIdOverride: parsed.data.contactIdOverride,
      confirm: parsed.data.confirm,
      confirmRequestId: parsed.data.confirmRequestId,
    });

    return NextResponse.json({ ok: true, ...result }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          type: "execution_error",
          message: error instanceof Error ? error.message : "Unknown error executing the request.",
        },
      },
      { status: 500 },
    );
  }
}
