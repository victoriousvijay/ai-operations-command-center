/**
 * Regression tests for a real bug reported against a real uploaded file
 * (premura_execution_commands.csv): the CSV importer used a `command`
 * column, which lib/files/csv.ts didn't recognize (it only looked for
 * `action`/`instruction`), so every row fell through to the default
 * UPSERT_CONTACT branch regardless of what command it actually named.
 * CREATE_OPPORTUNITY was also never implemented in the row mapper at all.
 *
 * These tests exercise the real parseCsvFile() function — no
 * reimplemented fixtures — against synthetic CSVs matching the exact
 * command vocabulary reported, plus the actual uploaded file itself.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { parseCsvFile } from "../lib/files/csv";

function byRow(result: ReturnType<typeof parseCsvFile>) {
  return new Map(result.actions.map((a) => [a.source, a]));
}

test("each recognized command maps to its own distinct action, not UPSERT_CONTACT", () => {
  const csv = [
    "command,name,email,phone,status,tags,task,stage,value",
    "CREATE_CONTACT,Vijay Sharma,vijay@example.com,,,,,,",
    "UPDATE_CONTACT,Rahul Mehta,rahul@example.com,,,,,,",
    "CREATE_TASK,Priya Singh,priya@example.com,,,,Call lead,,",
    "ADD_CONTACT_TAG,Vijay Sharma,vijay@example.com,,,High-Intent,,,",
    "CHANGE_STATUS,Priya Singh,priya@example.com,,Qualified,,,,",
    "CREATE_OPPORTUNITY,Vijay Sharma,vijay@example.com,,,,,Discovery,75000",
    "UPDATE_OPPORTUNITY,Rahul Mehta,rahul@example.com,,,,,Negotiation,135000",
    "SEND_EMAIL,Vijay Sharma,vijay@example.com,,,,Follow up on your inquiry,,",
    "SEND_SMS,Ananya Gupta,ananya@example.com,,,,Thanks for your interest.,,",
  ].join("\n");

  const result = parseCsvFile("test.csv", csv);
  const rows = byRow(result);

  assert.equal(rows.get(2)?.type, "UPSERT_CONTACT", "CREATE_CONTACT");
  assert.equal(rows.get(3)?.type, "UPSERT_CONTACT", "UPDATE_CONTACT");
  assert.equal(rows.get(4)?.type, "CREATE_TASK", "CREATE_TASK");
  assert.equal(rows.get(5)?.type, "ADD_CONTACT_TAG", "ADD_CONTACT_TAG");
  assert.equal(rows.get(6)?.type, "UPDATE_OPPORTUNITY", "CHANGE_STATUS");
  assert.equal(rows.get(7)?.type, "CREATE_OPPORTUNITY", "CREATE_OPPORTUNITY");
  assert.equal(rows.get(8)?.type, "UPDATE_OPPORTUNITY", "UPDATE_OPPORTUNITY");
  assert.equal(rows.get(9)?.type, "SEND_MESSAGE", "SEND_EMAIL");
  assert.equal(rows.get(9)?.payload.type, "Email");
  assert.equal(rows.get(10)?.type, "SEND_MESSAGE", "SEND_SMS");
  assert.equal(rows.get(10)?.payload.type, "SMS");

  const distinctTypes = new Set(result.actions.map((a) => a.type));
  assert.ok(distinctTypes.size > 1, "every row must not collapse to a single action type");
  assert.ok(!(distinctTypes.size === 1 && distinctTypes.has("UPSERT_CONTACT")), "must not collapse everything to UPSERT_CONTACT");
});

test("RUN_WORKFLOW and other unimplemented commands are rejected as UNSUPPORTED, never silently converted", () => {
  const csv = [
    "command,name,email,stage",
    "RUN_WORKFLOW,Vijay Sharma,vijay@example.com,Sales Team",
    "ASSIGN_LEAD,Rahul Mehta,rahul@example.com,Demo Team",
    "CREATE_WEBHOOK,Priya Singh,priya@example.com,",
    "TRIGGER_WEBHOOK,Ananya Gupta,ananya@example.com,",
  ].join("\n");

  const result = parseCsvFile("test.csv", csv);
  for (const action of result.actions) {
    assert.equal(action.type, null, `${action.target} should not resolve to any action`);
    assert.equal(action.status, "error");
    assert.match(action.message ?? "", /UNSUPPORTED/);
  }
});

test("a completely unrecognized command is rejected rather than defaulted to UPSERT_CONTACT", () => {
  const csv = ["command,name,email", "FOO_BAR_BAZ,Vijay Sharma,vijay@example.com"].join("\n");
  const result = parseCsvFile("test.csv", csv);
  assert.equal(result.actions[0]?.type, null);
  assert.equal(result.actions[0]?.status, "error");
  assert.match(result.actions[0]?.message ?? "", /UNSUPPORTED/);
});

test("a blank command still defaults to UPSERT_CONTACT (structured contact-import rows have no command column requirement)", () => {
  const csv = ["name,email", "Vijay Sharma,vijay@example.com"].join("\n");
  const result = parseCsvFile("test.csv", csv);
  assert.equal(result.actions[0]?.type, "UPSERT_CONTACT");
  assert.equal(result.actions[0]?.status, "ready");
});

test("scientific-notation phone corruption is dropped with a warning, never guessed back into a real number", () => {
  const csv = ["command,name,email,phone", "CREATE_CONTACT,Vijay Sharma,vijay@example.com,9.19877E+11"].join("\n");
  const result = parseCsvFile("test.csv", csv);
  const action = result.actions[0]!;
  assert.equal(action.type, "UPSERT_CONTACT");
  assert.equal(action.status, "warning");
  assert.equal("phone" in action.payload, false);
  assert.match(action.message ?? "", /scientific notation/);
});

test("the actual uploaded premura_execution_commands.csv produces multiple distinct action types", { skip: !existsSync("/Users/apple/Downloads/premura_execution_commands.csv") }, () => {
  const csv = readFileSync("/Users/apple/Downloads/premura_execution_commands.csv", "utf-8");
  const result = parseCsvFile("premura_execution_commands.csv", csv);

  const typeCounts = new Map<string, number>();
  for (const action of result.actions) {
    const key = action.type ?? `UNSUPPORTED(${action.message?.match(/command "([^"]+)"/)?.[1] ?? "?"})`;
    typeCounts.set(key, (typeCounts.get(key) ?? 0) + 1);
  }

  assert.ok(typeCounts.size > 1, `expected multiple distinct action types, got: ${JSON.stringify([...typeCounts.entries()])}`);
  assert.ok(typeCounts.has("CREATE_TASK"), "CREATE_TASK rows must be classified as CREATE_TASK");
  assert.ok(typeCounts.has("ADD_CONTACT_TAG"), "ADD_CONTACT_TAG rows must be classified as ADD_CONTACT_TAG");
  assert.ok(typeCounts.has("CREATE_OPPORTUNITY"), "CREATE_OPPORTUNITY rows must be classified as CREATE_OPPORTUNITY");
  assert.ok(typeCounts.has("UPDATE_OPPORTUNITY"), "UPDATE_OPPORTUNITY (incl. CHANGE_STATUS) rows must be classified as UPDATE_OPPORTUNITY");
  assert.ok(typeCounts.has("SEND_MESSAGE"), "SEND_EMAIL/SEND_SMS rows must be classified as SEND_MESSAGE");
  // ASSIGN_LEAD has no real backing API — must be rejected, not silently run.
  const assignLeadRows = result.actions.filter((a) => a.message?.includes("ASSIGN_LEAD"));
  assert.ok(assignLeadRows.every((a) => a.type === null && a.status === "error"), "ASSIGN_LEAD rows must be UNSUPPORTED, not executed as anything");
});
