import { NextResponse } from "next/server";
import { z } from "zod";
import { executeAutomationRequest } from "@/lib/orchestration/execute";

const executeRequestSchema = z.object({
  userRequest: z.string().trim().min(1, "userRequest is required").max(2000),
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
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
      userRequest: parsed.data.userRequest,
      idempotencyKey: parsed.data.idempotencyKey,
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
