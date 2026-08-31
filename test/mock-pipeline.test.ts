/**
 * Tests the mock agent + mock n8n + mock GHL pipeline in isolation, with no
 * Supabase/OpenClaw/n8n/GHL credentials required. This is the part of the
 * pipeline verifiable in an environment with no live external accounts
 * connected — it exercises real application code (not reimplemented
 * fixtures): lib/agent/mock-adapter.ts, lib/n8n/client.ts's MockN8nClient
 * (including its real payload validation), and lib/ghl/client.ts's
 * MockGhlClient.
 *
 * Run with `npm test`. Requires the `react-server` module condition so the
 * `server-only` import guard in these modules resolves to its no-op stub
 * instead of throwing (see the "test" script in package.json).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { MockAgentAdapter, SYNTHETIC_CONTACT_PREFIX } from "../lib/agent/mock-adapter";
import { MockN8nClient, attachGhlRequest, resolveContactId } from "../lib/n8n/client";
import type { GhlClient, GhlContact } from "../lib/ghl/types";

function notUsed(): never {
  throw new Error("not used in this test");
}

function fakeGhlClient(contacts: GhlContact[]): GhlClient {
  return {
    getContact: notUsed,
    searchContacts: async () => contacts,
    createContact: notUsed,
    updateContact: notUsed,
    upsertContact: notUsed,
    deleteContact: notUsed,
    addContactTag: notUsed,
    removeContactTag: notUsed,
    assignLead: notUsed,
    listUsers: notUsed,
    getOpportunity: notUsed,
    searchOpportunities: notUsed,
    createOpportunity: notUsed,
    updateOpportunity: notUsed,
    deleteOpportunity: notUsed,
    listPipelines: notUsed,
    getPipeline: notUsed,
    createPipeline: notUsed,
    updatePipeline: notUsed,
    deletePipeline: notUsed,
    listTasks: notUsed,
    getTask: notUsed,
    createTask: notUsed,
    updateTask: notUsed,
    deleteTask: notUsed,
    addNote: notUsed,
    listCustomFields: notUsed,
    createCustomField: notUsed,
    updateCustomField: notUsed,
    deleteCustomField: notUsed,
    searchConversations: notUsed,
    getConversation: notUsed,
    sendMessage: notUsed,
    listCalendars: notUsed,
  };
}

test("mock agent proposes UPDATE_OPPORTUNITY + CREATE_TASK for the architecture spec's example request", async () => {
  const agent = new MockAgentAdapter();
  const proposal = await agent.propose(
    "Move John Smith's opportunity to Qualified and create a follow-up task for tomorrow.",
  );

  assert.equal(proposal.intent, "CRM_UPDATE");
  assert.equal(proposal.actions.length, 2);
  assert.equal(proposal.actions[0]?.type, "UPDATE_OPPORTUNITY");
  assert.equal(proposal.actions[1]?.type, "CREATE_TASK");
});

test("mock agent extracts the contact name correctly when a command verb opens the sentence", async () => {
  const agent = new MockAgentAdapter();
  const proposal = await agent.propose("Move Greg Whitfield's opportunity to AI Qualified.");

  assert.equal(proposal.intent, "CRM_UPDATE");
  assert.equal(proposal.actions.length, 1);
  assert.equal(proposal.actions[0]?.type, "UPDATE_OPPORTUNITY");
  const payload = proposal.actions[0]?.payload as Record<string, unknown>;
  assert.equal(payload.name, "AI Qualified");
  assert.equal(payload.stageNameHint, "AI Qualified");
  assert.equal(payload.pipelineStageId, "mock-stage-ai-qualified");
  assert.equal(payload.opportunityId, "mock-opportunity-greg-whitfield");
});

test("mock agent parses 'create an opportunity for X worth Y in the Z pipeline, stage W'", async () => {
  const agent = new MockAgentAdapter();
  const proposal = await agent.propose("Create an opportunity for Karan Malhotra worth 45000 in the Solar Leads pipeline, stage New Lead.");

  assert.equal(proposal.actions.length, 1);
  assert.equal(proposal.actions[0]?.type, "CREATE_OPPORTUNITY");
  const payload = proposal.actions[0]?.payload as Record<string, unknown>;
  assert.equal(payload.contactLookupHint, "Karan Malhotra");
  assert.equal(payload.pipelineNameHint, "Solar Leads");
  assert.equal(payload.stageNameHint, "New Lead");
  assert.equal(payload.monetaryValue, 45000);
});

test("mock agent returns UNKNOWN intent and no actions for an unrelated request", async () => {
  const agent = new MockAgentAdapter();
  const proposal = await agent.propose("What's the weather like today?");

  assert.equal(proposal.intent, "UNKNOWN");
  assert.equal(proposal.actions.length, 0);
});

test("mock n8n executes every proposed action against the mock GHL adapter", async () => {
  const agent = new MockAgentAdapter();
  const n8n = new MockN8nClient();

  const proposal = await agent.propose(
    "Move John Smith's opportunity to Qualified and create a follow-up task for tomorrow.",
  );

  for (const action of proposal.actions) {
    const result = await n8n.execute(
      attachGhlRequest({
        requestId: "test-request",
        actionId: "test-action",
        actionType: action.type,
        payload: action.payload,
      }),
    );
    assert.equal(result.ok, true, `expected ${action.type} to succeed, got error: ${result.error}`);
    assert.ok(result.response, `expected a response body for ${action.type}`);
  }
});

test("mock n8n rejects a payload that fails validation before calling GHL", async () => {
  const n8n = new MockN8nClient();

  const result = await n8n.execute(
    attachGhlRequest({
      requestId: "test-request",
      actionId: "test-action",
      actionType: "CREATE_TASK",
      // Missing the required `title` and `dueDate` fields.
      payload: { contactId: "mock-contact-jane-doe" },
    }),
  );

  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /Validation failed/);
});

test("resolveContactId leaves a real-looking contactId untouched even with GHL_ADAPTER=real", async () => {
  const previous = process.env.GHL_ADAPTER;
  process.env.GHL_ADAPTER = "real";
  try {
    const ghl = fakeGhlClient([]);
    const result = await resolveContactId(ghl, { contactId: "real-ghl-id-abc123", contactLookupHint: "ignored" });
    assert.equal(result.error, undefined);
    assert.equal(result.payload.contactId, "real-ghl-id-abc123");
  } finally {
    process.env.GHL_ADAPTER = previous;
  }
});

test("resolveContactId passes a synthetic contactId through unchanged when GHL_ADAPTER is not real", async () => {
  const previous = process.env.GHL_ADAPTER;
  delete process.env.GHL_ADAPTER;
  try {
    const ghl = fakeGhlClient([]);
    const result = await resolveContactId(ghl, {
      contactId: `${SYNTHETIC_CONTACT_PREFIX}john-smith`,
      contactLookupHint: "John Smith",
    });
    assert.equal(result.error, undefined);
    assert.equal(result.payload.contactId, `${SYNTHETIC_CONTACT_PREFIX}john-smith`);
  } finally {
    process.env.GHL_ADAPTER = previous;
  }
});

test("resolveContactId resolves a synthetic contactId to a real match when GHL_ADAPTER=real", async () => {
  const previous = process.env.GHL_ADAPTER;
  process.env.GHL_ADAPTER = "real";
  try {
    const ghl = fakeGhlClient([
      { id: "real-contact-42", locationId: "loc_1", name: "John Smith", email: "john@example.com" },
    ]);
    const result = await resolveContactId(ghl, {
      contactId: `${SYNTHETIC_CONTACT_PREFIX}john-smith`,
      contactLookupHint: "John Smith",
    });
    assert.equal(result.error, undefined);
    assert.equal(result.payload.contactId, "real-contact-42");
    assert.equal("contactLookupHint" in result.payload, false, "hint should be stripped before calling GHL");
  } finally {
    process.env.GHL_ADAPTER = previous;
  }
});

test("resolveContactId returns a clear error (not a generic not-found) when no real match exists", async () => {
  const previous = process.env.GHL_ADAPTER;
  process.env.GHL_ADAPTER = "real";
  try {
    const ghl = fakeGhlClient([]);
    const result = await resolveContactId(ghl, {
      contactId: `${SYNTHETIC_CONTACT_PREFIX}nobody`,
      contactLookupHint: "Nobody Real",
    });
    assert.match(result.error ?? "", /No GoHighLevel contact found matching "Nobody Real"/);
    assert.match(result.error ?? "", /manual override/);
  } finally {
    process.env.GHL_ADAPTER = previous;
  }
});

test("resolveContactId returns a clear error when there is no lookup hint to search with", async () => {
  const previous = process.env.GHL_ADAPTER;
  process.env.GHL_ADAPTER = "real";
  try {
    const ghl = fakeGhlClient([]);
    const result = await resolveContactId(ghl, { contactId: `${SYNTHETIC_CONTACT_PREFIX}unknown` });
    assert.match(result.error ?? "", /no lookup hint/);
  } finally {
    process.env.GHL_ADAPTER = previous;
  }
});
