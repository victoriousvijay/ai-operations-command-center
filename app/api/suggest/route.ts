import { NextResponse } from "next/server";
import { z } from "zod";
import { suggestCommands } from "@/lib/agent/suggest";

const suggestRequestSchema = z.object({
  userRequest: z.string().trim().min(1, "userRequest is required").max(2000),
});

/**
 * THINK-only: turns loose English into candidate structured commands and
 * returns them for the user to pick from. Never executes anything and
 * never touches Supabase/n8n/GoHighLevel — that only happens once the
 * user selects a suggestion and it's submitted to /api/files/execute
 * (the same structured-execution endpoint file uploads already use).
 */
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

  const parsed = suggestRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: { type: "invalid_request", message: parsed.error.issues.map((i) => i.message).join("; ") } },
      { status: 400 },
    );
  }

  try {
    const suggestions = await suggestCommands(parsed.data.userRequest);
    return NextResponse.json({ ok: true, suggestions });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: { type: "agent_error", message: error instanceof Error ? error.message : "Failed to interpret this request." } },
      { status: 500 },
    );
  }
}
