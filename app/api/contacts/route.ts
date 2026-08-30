import { NextResponse } from "next/server";
import { z } from "zod";
import { listContacts, upsertContact } from "@/lib/supabase/queries";

const upsertContactSchema = z.object({
  externalId: z.string().trim().min(1).max(200),
  name: z.string().trim().max(200).optional(),
  email: z.string().trim().email().optional(),
  source: z.string().trim().max(100).optional(),
});

export async function GET() {
  try {
    const contacts = await listContacts({ limit: 50 });
    return NextResponse.json({ ok: true, contacts });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          type: "database_error",
          message: error instanceof Error ? error.message : "Unknown error fetching contacts.",
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

  const parsed = upsertContactSchema.safeParse(body);
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
    const contact = await upsertContact(parsed.data);
    return NextResponse.json({ ok: true, contact }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          type: "database_error",
          message: error instanceof Error ? error.message : "Unknown error upserting contact.",
        },
      },
      { status: 500 },
    );
  }
}
