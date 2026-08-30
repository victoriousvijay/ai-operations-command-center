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
// Excel/Sheets silently mangles a long numeric-looking phone column into
// scientific notation on export (e.g. "919877123456" -> "9.19877E+11").
// Once that happens the original digits are unrecoverable — never guess
// them back.
const SCIENTIFIC_NOTATION_RE = /^\d+(\.\d+)?e\+?\d+$/i;

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[\s_-]+/g, "");
}

/** Normalizes a command/action cell to SCREAMING_SNAKE_CASE for exact matching. */
function normalizeCommand(raw: string): string {
  return raw.trim().toUpperCase().replace(/[\s-]+/g, "_");
}

/**
 * Every command this CSV importer recognizes, mapped to the real,
 * verified action it executes. This is an explicit allowlist matched
 * exactly (after normalization) — never a loose substring/keyword guess —
 * so a command can never be silently misclassified as a different one.
 * Anything not listed here (or not in UNSUPPORTED_COMMANDS below) is
 * rejected with a clear "unrecognized command" error, never defaulted to
 * UPSERT_CONTACT.
 */
const COMMAND_ALIASES: Record<string, string> = {
  CREATE_CONTACT: "UPSERT_CONTACT",
  UPDATE_CONTACT: "UPSERT_CONTACT",
  UPSERT_CONTACT: "UPSERT_CONTACT",
  CREATE_TASK: "CREATE_TASK",
  FOLLOW_UP: "CREATE_TASK",
  ADD_CONTACT_TAG: "ADD_CONTACT_TAG",
  ADD_TAG: "ADD_CONTACT_TAG",
  REMOVE_CONTACT_TAG: "REMOVE_CONTACT_TAG",
  REMOVE_TAG: "REMOVE_CONTACT_TAG",
  ADD_NOTE: "ADD_NOTE",
  NOTE: "ADD_NOTE",
  CREATE_OPPORTUNITY: "CREATE_OPPORTUNITY",
  UPDATE_OPPORTUNITY: "UPDATE_OPPORTUNITY",
  // GoHighLevel has no separate "contact status" field — a lead's status
  // (New / Contacted / Qualified / Proposal / ...) is really its
  // opportunity's pipeline stage in this CRM. CHANGE_STATUS is therefore
  // handled as a stage move, the same real, verified operation
  // UPDATE_OPPORTUNITY already uses — not a fabricated new API.
  CHANGE_STATUS: "UPDATE_OPPORTUNITY",
  SEND_EMAIL: "SEND_MESSAGE_EMAIL",
  SEND_SMS: "SEND_MESSAGE_SMS",
};

/**
 * Commands this file format recognizes but that have no real, verified
 * GoHighLevel/n8n operation behind them yet — reported as a clear,
 * specific error rather than silently run as something else or dropped.
 */
const UNSUPPORTED_COMMANDS: Record<string, string> = {
  ASSIGN_LEAD: "Assigning a lead to a user/team has no verified GoHighLevel API in this build's action registry yet.",
  CREATE_WEBHOOK: "Webhook management is an n8n/automation-platform concept, not a GoHighLevel CRM action — out of scope for this registry.",
  TRIGGER_WEBHOOK: "Webhook management is an n8n/automation-platform concept, not a GoHighLevel CRM action — out of scope for this registry.",
  RUN_WORKFLOW: "Running an arbitrary workflow is exactly the kind of uncontrolled action this system's allowlist exists to prevent — not implemented.",
};

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
  const rawPhone = get("phone");
  const company = get("company", "companyname");
  const rawCommand = get("action", "command", "instruction");
  const stage = get("stage", "targetstage", "status");
  const pipeline = get("pipeline");
  const value = get("value", "opportunityvalue", "amount");
  const tags = get("tags")
    ?.split(/[;|]/)
    .map((t) => t.trim())
    .filter(Boolean);
  const taskTitle = get("tasktitle", "task");
  const taskDueDate = get("taskduedate", "duedate");
  const note = get("note", "notes");
  const messageBody = get("task", "message", "body");

  const target = name ?? [firstName, lastName].filter(Boolean).join(" ") ?? email ?? rawPhone ?? `row ${rowNumber}`;
  const lookupHint = name ?? ([firstName, lastName].filter(Boolean).join(" ") || email);

  if (email && !EMAIL_RE.test(email)) {
    return { source: rowNumber, type: null, payload: {}, status: "error", target, message: `Invalid email "${email}".` };
  }

  let phoneWarning: string | undefined;
  let phone = rawPhone;
  if (phone && SCIENTIFIC_NOTATION_RE.test(phone)) {
    phoneWarning = `Phone value "${phone}" was corrupted by spreadsheet auto-formatting (scientific notation) — the original digits can't be recovered, so it was dropped. Re-export this column as text.`;
    phone = undefined;
  }

  const command = rawCommand ? normalizeCommand(rawCommand) : "";
  const resolved = command ? COMMAND_ALIASES[command] : "UPSERT_CONTACT"; // blank command = plain contact upsert

  if (!resolved) {
    const unsupportedReason = UNSUPPORTED_COMMANDS[command];
    return {
      source: rowNumber,
      type: null,
      payload: {},
      status: "error",
      target,
      message: unsupportedReason
        ? `UNSUPPORTED command "${rawCommand}": ${unsupportedReason}`
        : `UNSUPPORTED command "${rawCommand}": not a recognized action. Supported: ${Object.keys(COMMAND_ALIASES).join(", ")}.`,
    };
  }

  const withPhoneWarning = (planned: PlannedAction): PlannedAction => {
    if (!phoneWarning) return planned;
    return { ...planned, status: planned.status === "error" ? "error" : "warning", message: [planned.message, phoneWarning].filter(Boolean).join(" ") };
  };

  if (resolved === "UPDATE_OPPORTUNITY") {
    if (!stage) {
      return { source: rowNumber, type: null, payload: {}, status: "error", target, message: "UPDATE_OPPORTUNITY (or CHANGE_STATUS) row needs a Stage/Status value." };
    }
    return withPhoneWarning({
      source: rowNumber,
      type: "UPDATE_OPPORTUNITY",
      payload: {
        contactLookupHint: lookupHint,
        opportunityLookupHint: true,
        stageNameHint: stage,
        ...(pipeline ? { pipelineNameHint: pipeline } : {}),
        ...(value ? { monetaryValue: Number(value) } : {}),
      },
      status: "ready",
      target,
      message: `Move ${target}'s opportunity to "${stage}"${pipeline ? ` in ${pipeline}` : ""} (stage/pipeline verified at execution time).`,
    });
  }

  if (resolved === "CREATE_OPPORTUNITY") {
    if (!lookupHint) {
      return { source: rowNumber, type: null, payload: {}, status: "error", target, message: "CREATE_OPPORTUNITY row needs a Name or Email to find the contact." };
    }
    if (!stage) {
      return { source: rowNumber, type: null, payload: {}, status: "error", target, message: "CREATE_OPPORTUNITY row needs a Stage value." };
    }
    return withPhoneWarning({
      source: rowNumber,
      type: "CREATE_OPPORTUNITY",
      payload: {
        contactLookupHint: lookupHint,
        stageNameHint: stage,
        ...(pipeline ? { pipelineNameHint: pipeline } : {}),
        name: `${target} Opportunity`,
        ...(value ? { monetaryValue: Number(value) } : {}),
      },
      status: "ready",
      target,
      message: `Create an opportunity for ${target} in stage "${stage}"${pipeline ? ` (${pipeline})` : ""}${value ? `, value ${value}` : ""} (stage/pipeline verified at execution time).`,
    });
  }

  if (resolved === "CREATE_TASK") {
    if (!lookupHint) {
      return { source: rowNumber, type: null, payload: {}, status: "error", target, message: "CREATE_TASK row needs a Name or Email to find the contact." };
    }
    return withPhoneWarning({
      source: rowNumber,
      type: "CREATE_TASK",
      payload: {
        contactLookupHint: lookupHint,
        title: taskTitle ?? `Follow up with ${target}`,
        dueDate: taskDueDate ?? new Date(Date.now() + 86_400_000).toISOString(),
      },
      status: "ready",
      target,
    });
  }

  if (resolved === "ADD_CONTACT_TAG" || resolved === "REMOVE_CONTACT_TAG") {
    if (!lookupHint || !tags?.length) {
      return { source: rowNumber, type: null, payload: {}, status: "error", target, message: `${resolved} row needs a Name/Email and a Tags value.` };
    }
    return withPhoneWarning({ source: rowNumber, type: resolved, payload: { contactLookupHint: lookupHint, tags }, status: "ready", target });
  }

  if (resolved === "ADD_NOTE") {
    if (!lookupHint || !note) {
      return { source: rowNumber, type: null, payload: {}, status: "error", target, message: "ADD_NOTE row needs a Name/Email and a Note value." };
    }
    return withPhoneWarning({ source: rowNumber, type: "ADD_NOTE", payload: { contactLookupHint: lookupHint, body: note }, status: "ready", target });
  }

  if (resolved === "SEND_MESSAGE_EMAIL" || resolved === "SEND_MESSAGE_SMS") {
    if (!lookupHint || !messageBody) {
      return { source: rowNumber, type: null, payload: {}, status: "error", target, message: `${command} row needs a Name/Email and a message body.` };
    }
    return withPhoneWarning({
      source: rowNumber,
      type: "SEND_MESSAGE",
      payload: { contactLookupHint: lookupHint, message: messageBody, type: resolved === "SEND_MESSAGE_EMAIL" ? "Email" : "SMS" },
      status: "ready",
      target,
      message: `Sends a real ${resolved === "SEND_MESSAGE_EMAIL" ? "email" : "SMS"} to ${target} — requires confirmation before it runs.`,
    });
  }

  // resolved === "UPSERT_CONTACT"
  if (!email && !phone) {
    return { source: rowNumber, type: null, payload: {}, status: "error", target, message: "Row needs at least an Email or Phone to create/update a contact." };
  }
  return withPhoneWarning({
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
  });
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
        planned.message = (planned.message ? planned.message + " " : "") + `Duplicate email "${email}" also appears earlier in this file.`;
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
