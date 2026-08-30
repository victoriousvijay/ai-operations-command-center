import { NextResponse } from "next/server";
import { z } from "zod";
import { getGhlClient } from "@/lib/ghl";

const searchSchema = z.object({ query: z.string().trim().min(1).max(200) });

/**
 * Direct access to the same GHL contact-search capability
 * lib/n8n/client.ts's resolveContactId uses internally to turn a name/email
 * into a real contactId. Exposed as its own endpoint so a real lookup can
 * be tested/used without going through the full execute pipeline.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const parsed = searchSchema.safeParse({ query: searchParams.get("query") ?? "" });

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
    const ghl = getGhlClient();
    const contacts = await ghl.searchContacts({ query: parsed.data.query });
    return NextResponse.json({ ok: true, contacts });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          type: "ghl_error",
          message: error instanceof Error ? error.message : "Unknown error searching GoHighLevel contacts.",
        },
      },
      { status: 502 },
    );
  }
}
