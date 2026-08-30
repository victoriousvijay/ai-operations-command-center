import "server-only";
import { parseCsvFile } from "./csv";
import { parseMarkdownFile } from "./markdown";
import { parsePdfFile } from "./pdf";
import type { FileParseResult, FileSourceType } from "./types";

export * from "./types";

const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB

function detectSourceType(fileName: string, mimeType: string): FileSourceType | null {
  const lower = fileName.toLowerCase();
  if (mimeType === "application/pdf" || lower.endsWith(".pdf")) return "pdf";
  if (mimeType === "text/csv" || lower.endsWith(".csv")) return "csv";
  if (mimeType === "text/markdown" || lower.endsWith(".md") || lower.endsWith(".markdown")) return "markdown";
  return null;
}

/**
 * File upload entry point (section 14's UPLOAD -> VALIDATE -> EXTRACT ->
 * PLAN pipeline). Every accepted file type converges on the same
 * FileParseResult shape and, downstream, the same controlled action
 * registry (lib/actions/registry.ts) and orchestration engine
 * (lib/orchestration/execute.ts) that a typed text command uses — see
 * each parser module's own comment for exactly how.
 *
 * Security: file contents are only ever treated as business data/
 * instructions, never executed. CSV rows are parsed into a fixed set of
 * struct fields (never eval'd); PDF/Markdown text is only ever passed to
 * the agent adapter as a natural-language string (the same untrusted input
 * a typed command already is) — never interpreted as code.
 */
export async function parseUploadedFile(fileName: string, mimeType: string, buffer: Buffer): Promise<FileParseResult> {
  if (buffer.byteLength === 0) {
    return { fileName, sourceType: "csv", actions: [], warnings: ["The uploaded file is empty."] };
  }
  if (buffer.byteLength > MAX_FILE_BYTES) {
    return { fileName, sourceType: "csv", actions: [], warnings: [`File is too large (${Math.round(buffer.byteLength / 1024)} KB). Maximum is ${MAX_FILE_BYTES / 1024 / 1024} MB.`] };
  }

  const sourceType = detectSourceType(fileName, mimeType);
  if (!sourceType) {
    return { fileName, sourceType: "csv", actions: [], warnings: [`Unsupported file type "${mimeType || fileName.split(".").pop()}". Upload a .csv, .pdf, or .md file.`] };
  }

  if (sourceType === "csv") return parseCsvFile(fileName, buffer.toString("utf-8"));
  if (sourceType === "markdown") return parseMarkdownFile(fileName, buffer.toString("utf-8"));
  return parsePdfFile(fileName, buffer);
}
