import { NextResponse } from "next/server";
import { z } from "zod";
import { createAgent, listAgents } from "@/lib/supabase/queries";

const createAgentSchema = z.object({
  name: z.string().trim().min(1).max(200),
  adapterType: z.enum(["openclaw", "mock"]),
  description: z.string().trim().max(1000).optional(),
});

export async function GET() {
  try {
    const agents = await listAgents();
    return NextResponse.json({ ok: true, agents });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          type: "database_error",
          message: error instanceof Error ? error.message : "Unknown error fetching agents.",
        },
      },
      { status: 500 },
    );
  }
}

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

  const parsed = createAgentSchema.safeParse(body);
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
    const agent = await createAgent(parsed.data);
    return NextResponse.json({ ok: true, agent }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error creating agent.";
    const isDuplicate = message.includes("duplicate key");
    return NextResponse.json(
      { ok: false, error: { type: isDuplicate ? "conflict" : "database_error", message } },
      { status: isDuplicate ? 409 : 500 },
    );
  }
}
