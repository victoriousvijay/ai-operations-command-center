import { NextResponse } from "next/server";
import { z } from "zod";
import { createIntegration, listIntegrations } from "@/lib/supabase/queries";

const createIntegrationSchema = z.object({
  name: z.string().trim().min(1).max(200),
  provider: z.enum(["n8n", "gohighlevel"]),
  baseUrl: z.string().trim().url().optional(),
});

export async function GET() {
  try {
    const integrations = await listIntegrations();
    return NextResponse.json({ ok: true, integrations });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          type: "database_error",
          message: error instanceof Error ? error.message : "Unknown error fetching integrations.",
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

  const parsed = createIntegrationSchema.safeParse(body);
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
    const integration = await createIntegration(parsed.data);
    return NextResponse.json({ ok: true, integration }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error creating integration.";
    const isDuplicate = message.includes("duplicate key");
    return NextResponse.json(
      {
        ok: false,
        error: { type: isDuplicate ? "conflict" : "database_error", message },
      },
      { status: isDuplicate ? 409 : 500 },
    );
  }
}
