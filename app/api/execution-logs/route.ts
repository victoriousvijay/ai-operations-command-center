import { NextResponse } from "next/server";
import { listExecutionLogs } from "@/lib/supabase/queries";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const requestId = searchParams.get("requestId") ?? undefined;

  try {
    const logs = await listExecutionLogs({ requestId, limit: 100 });
    return NextResponse.json({ ok: true, logs });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          type: "database_error",
          message: error instanceof Error ? error.message : "Unknown error fetching execution logs.",
        },
      },
      { status: 500 },
    );
  }
}
