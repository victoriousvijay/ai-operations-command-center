import "server-only";
import { ensureDomMatrixPolyfill } from "./dom-polyfill";
import { planFromTextLines } from "./text-plan";
import type { FileParseResult } from "./types";

/**
 * Extracts text from a PDF (via the `pdf-parse` package — a real
 * dependency, not invented parsing, since reading arbitrary PDF binary
 * without a library isn't realistic) and hands the resulting lines to the
 * SAME shared text-instruction planner Markdown uses (text-plan.ts) — no
 * separate PDF business logic, per ARCHITECTURE.md's "one system, two
 * input methods" principle.
 *
 * `pdf-parse` is imported dynamically, not at module scope, and only after
 * installing a DOMMatrix polyfill (see dom-polyfill.ts) — its
 * `pdfjs-dist` dependency needs DOMMatrix for text-position math and Node
 * has no built-in one. This avoids the native `@napi-rs/canvas` package
 * pdfjs-dist otherwise falls back to, which hit a real, confirmed-live npm
 * optional-dependency bug when deployed to Vercel's Linux runtime after
 * being installed locally on macOS. Loading pdf-parse lazily also means a
 * CSV or Markdown upload never touches this code path at all.
 */
export async function parsePdfFile(fileName: string, buffer: Buffer): Promise<FileParseResult> {
  let text: string;
  try {
    ensureDomMatrixPolyfill();
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    const result = await parser.getText();
    text = result.text;
    await parser.destroy();
  } catch (error) {
    return {
      fileName,
      sourceType: "pdf",
      actions: [],
      warnings: [`Could not read this PDF: ${error instanceof Error ? error.message : "unknown error"}. It may be scanned/image-only, encrypted, or corrupted.`],
    };
  }

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/^\d+[.)]\s*/, "").trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    return { fileName, sourceType: "pdf", actions: [], warnings: ["No extractable text was found in this PDF (it may be scanned images rather than real text)."] };
  }

  const { actions, warnings } = await planFromTextLines(lines);
  return { fileName, sourceType: "pdf", actions, warnings };
}
