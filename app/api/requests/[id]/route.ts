import { NextResponse } from "next/server";
import { getAutomationRequestById } from "@/lib/supabase/queries";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  try {
    const automationRequest = await getAutomationRequestById(id);
    if (!automationRequest) {
      return NextResponse.json(
        { ok: false, error: { type: "not_found", message: `No request found with id ${id}.` } },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true, request: automationRequest });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          type: "database_error",
          message: error instanceof Error ? error.message : "Unknown error fetching the request.",
        },
      },
      { status: 500 },
    );
  }
}
