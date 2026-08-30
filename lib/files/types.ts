import type { AllowedAction } from "@/lib/actions/allowlist";

export type FileSourceType = "csv" | "pdf" | "markdown";

export type PlannedActionStatus = "ready" | "warning" | "error";

/** One row/instruction turned into a proposed action, before execution. */
export interface PlannedAction {
  /** 1-based row number (CSV) or line number (Markdown/PDF text) this came from. */
  source: number;
  type: AllowedAction | null;
  payload: Record<string, unknown>;
  status: PlannedActionStatus;
  /** Human-readable label for the review screen, e.g. "Rahul Sharma". */
  target: string;
  message?: string;
}

export interface FileParseResult {
  fileName: string;
  sourceType: FileSourceType;
  actions: PlannedAction[];
  /** File-level problems (malformed CSV, unreadable PDF, empty file, etc). */
  warnings: string[];
}
