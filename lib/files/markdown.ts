import "server-only";
import { planFromTextLines } from "./text-plan";
import type { FileParseResult } from "./types";

/**
 * Strips Markdown syntax down to plain instruction lines (headings,
 * numbered/bulleted lists, tables collapsed to their cell text), then
 * hands them to the shared text-instruction planner (text-plan.ts) — the
 * same code path a typed command uses. No separate Markdown business
 * logic; Markdown is just another way to produce a list of instructions.
 */
function extractInstructionLines(markdown: string): string[] {
  return markdown
    .split(/\r?\n/)
    .filter((line) => !/^#{1,6}\s/.test(line.trim())) // headings are structure, not instructions
    .map((line) =>
      line
        .replace(/^[-*+]\s+/, "") // bullets
        .replace(/^\d+[.)]\s+/, "") // numbered lists
        .replace(/\|/g, " ") // table pipes
        .replace(/^[-\s|]+$/, "") // table separator rows
        .trim(),
    )
    .filter((line) => line.length > 0);
}

export async function parseMarkdownFile(fileName: string, text: string): Promise<FileParseResult> {
  const lines = extractInstructionLines(text);
  if (lines.length === 0) {
    return { fileName, sourceType: "markdown", actions: [], warnings: ["No instruction lines were found in this file."] };
  }
  const { actions, warnings } = await planFromTextLines(lines);
  return { fileName, sourceType: "markdown", actions, warnings };
}
