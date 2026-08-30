import { NextResponse } from "next/server";
import { parseUploadedFile } from "@/lib/files/parse";

/**
 * Section 14's UPLOAD -> VALIDATE -> EXTRACT -> PLAN steps. This route
 * only ever parses and plans — it never executes anything (see
 * /api/files/execute), so a file can always be reviewed before it touches
 * GoHighLevel.
 */
export async function POST(request: Request) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { ok: false, error: { type: "invalid_request", message: "Expected multipart/form-data with a 'file' field." } },
      { status: 400 },
    );
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { ok: false, error: { type: "invalid_request", message: "No file was provided." } },
      { status: 400 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    const result = await parseUploadedFile(file.name, file.type, buffer);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: { type: "parse_error", message: error instanceof Error ? error.message : "Failed to parse the uploaded file." },
      },
      { status: 500 },
    );
  }
}
