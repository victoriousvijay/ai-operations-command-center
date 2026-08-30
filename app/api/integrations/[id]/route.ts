import { NextResponse } from "next/server";
import { z } from "zod";
import { updateIntegrationStatus } from "@/lib/supabase/queries";

const updateIntegrationSchema = z.object({
  status: z.enum(["active", "disabled", "error"]),
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: { type: "invalid_request", message: "Request body must be valid JSON." } },
      { status: 400 },
    );
  }

  const parsed = updateIntegrationSchema.safeParse(body);
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
    const integration = await updateIntegrationStatus(id, parsed.data.status);
    return NextResponse.json({ ok: true, integration });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error updating integration.";
    return NextResponse.json(
      { ok: false, error: { type: "not_found", message } },
      { status: 404 },
    );
  }
}
