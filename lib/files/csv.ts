import "server-only";
import type { PlannedAction, FileParseResult } from "./types";

/**
 * Minimal RFC4180-style CSV parser (quoted fields, escaped quotes, commas
 * inside quotes). No third-party dependency — this is deliberately small
 * and fully under our control given the security requirement that
 * uploaded files are data, never executable code.
 */
function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0]!.trim() === ""));
}

const EMAIL_RE = /^[\w.+-]+@[\w-]+\.[\w.-]+$/;

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[\s_-]+/g, "");
}

/**
 * Converts a CSV row into a planned action, purely from the row's own data
 * — no AI call, no GHL call. Matches ARCHITECTURE.md's "parse structured
 * data programmatically first, use AI only where reasoning is needed"
 * performance principle. Values that reference a stage/pipeline by name
 * are carried as *Hint fields and resolved for real at execution time by
 * lib/orchestration/resolvers.ts — this function never guesses an ID.
 */
function rowToAction(headers: string[], values: string[], rowNumber: number): PlannedAction {
  const get = (...names: string[]): string | undefined => {
    for (const name of names) {
      const idx = headers.indexOf(name);
      if (idx >= 0 && values[idx]?.trim()) return values[idx]!.trim();
    }
    return undefined;
  };

  const name = get("name", "fullname");
  const firstName = get("firstname");
  const lastName = get("lastname");
  const email = get("email");
  const phone = get("phone");
  const company = get("company", "companyname");
  const action = get("action", "instruction")?.toLowerCase();
  const stage = get("stage", "targetstage");
  const pipeline = get("pipeline");
  const tags = get("tags")
    ?.split(/[;|]/)
    .map((t) => t.trim())
    .filter(Boolean);
  const taskTitle = get("tasktitle", "task");
  const taskDueDate = get("taskduedate", "duedate");
  const note = get("note", "notes");

  const target = name ?? [firstName, lastName].filter(Boolean).join(" ") ?? email ?? phone ?? `row ${rowNumber}`;
  const lookupHint = name ?? ([firstName, lastName].filter(Boolean).join(" ") || email);

  if (email && !EMAIL_RE.test(email)) {
    return { source: rowNumber, type: null, payload: {}, status: "error", target, message: `Invalid email "${email}".` };
  }

  if (action?.includes("update") && action.includes("opportunity")) {
    if (!stage) {
      return { source: rowNumber, type: null, payload: {}, status: "error", target, message: "UPDATE_OPPORTUNITY row needs a Stage value." };
    }
    return {
      source: rowNumber,
      type: "UPDATE_OPPORTUNITY",
      payload: {
        contactLookupHint: lookupHint,
        opportunityLookupHint: true,
        stageNameHint: stage,
        ...(pipeline ? { pipelineNameHint: pipeline } : {}),
      },
      status: "ready",
      target,
      message: `Move ${target}'s opportunity to "${stage}"${pipeline ? ` in ${pipeline}` : ""} (stage/pipeline verified at execution time).`,
    };
  }

  if (action?.includes("task") || action?.includes("follow")) {
    if (!lookupHint) {
      return { source: rowNumber, type: null, payload: {}, status: "error", target, message: "CREATE_TASK row needs a Name or Email to find the contact." };
    }
    return {
      source: rowNumber,
      type: "CREATE_TASK",
      payload: {
        contactLookupHint: lookupHint,
        title: taskTitle ?? `Follow up with ${target}`,
        dueDate: taskDueDate ?? new Date(Date.now() + 86_400_000).toISOString(),
      },
      status: "ready",
      target,
    };
  }

  if (action?.includes("tag")) {
    if (!lookupHint || !tags?.length) {
      return { source: rowNumber, type: null, payload: {}, status: "error", target, message: "ADD_CONTACT_TAG row needs a Name/Email and a Tags value." };
    }
    return { source: rowNumber, type: "ADD_CONTACT_TAG", payload: { contactLookupHint: lookupHint, tags }, status: "ready", target };
  }

  if (action?.includes("note")) {
    if (!lookupHint || !note) {
      return { source: rowNumber, type: null, payload: {}, status: "error", target, message: "ADD_NOTE row needs a Name/Email and a Note value." };
    }
    return { source: rowNumber, type: "ADD_NOTE", payload: { contactLookupHint: lookupHint, body: note }, status: "ready", target };
  }

  // Default (including explicit "Create Contact"): upsert the contact.
  if (!email && !phone) {
    return { source: rowNumber, type: null, payload: {}, status: "error", target, message: "Row needs at least an Email or Phone to create/update a contact." };
  }
  return {
    source: rowNumber,
    type: "UPSERT_CONTACT",
    payload: {
      ...(firstName ? { firstName } : {}),
      ...(lastName ? { lastName } : {}),
      ...(!firstName && !lastName && name ? { name } : {}),
      ...(email ? { email } : {}),
      ...(phone ? { phone } : {}),
      ...(company ? { companyName: company } : {}),
      ...(tags?.length ? { tags } : {}),
    },
    status: "ready",
    target,
  };
}

export function parseCsvFile(fileName: string, text: string): FileParseResult {
  const warnings: string[] = [];
  const rows = parseCsvRows(text);

  if (rows.length === 0) {
    return { fileName, sourceType: "csv", actions: [], warnings: ["The file is empty."] };
  }

  const headers = rows[0]!.map(normalizeHeader);
  const dataRows = rows.slice(1);
  const seenEmails = new Set<string>();
  const actions: PlannedAction[] = [];

  dataRows.forEach((values, i) => {
    const rowNumber = i + 2; // 1-based, +1 for the header row
    if (values.every((v) => v.trim() === "")) return; // skip blank rows
    if (values.length !== headers.length) {
      actions.push({
        source: rowNumber,
        type: null,
        payload: {},
        status: "error",
        target: `row ${rowNumber}`,
        message: `Malformed row: expected ${headers.length} columns, found ${values.length}.`,
      });
      return;
    }

    const planned = rowToAction(headers, values, rowNumber);
    const emailIdx = headers.indexOf("email");
    const email = emailIdx >= 0 ? values[emailIdx]?.trim().toLowerCase() : undefined;
    if (email && planned.status !== "error") {
      if (seenEmails.has(email)) {
        planned.status = "warning";
        planned.message = (planned.message ? planned.message + " " : "") + `Duplicate email "${email}" also appears earlier in this file — both will run (UPSERT_CONTACT is safe to repeat).`;
      }
      seenEmails.add(email);
    }
    actions.push(planned);
  });

  if (actions.length === 0) {
    warnings.push("No usable rows were found after the header.");
  }

  return { fileName, sourceType: "csv", actions, warnings };
}
