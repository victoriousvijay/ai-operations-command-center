import { NextResponse } from "next/server";
import { listAutomationRequests } from "@/lib/supabase/queries";

export async function GET() {
  try {
    const requests = await listAutomationRequests({ limit: 50 });
    return NextResponse.json({ ok: true, requests });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          type: "database_error",
          message: error instanceof Error ? error.message : "Unknown error fetching requests.",
        },
      },
      { status: 500 },
    );
  }
}
