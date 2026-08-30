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
import { MockN8nClient, resolveContactId } from "../lib/n8n/client";
import type { GhlClient, GhlContact } from "../lib/ghl/types";

function fakeGhlClient(contacts: GhlContact[]): GhlClient {
  return {
    getContact: () => {
      throw new Error("not used in this test");
    },
    updateContact: () => {
      throw new Error("not used in this test");
    },
    searchContacts: async () => contacts,
    getOpportunity: () => {
      throw new Error("not used in this test");
    },
    updateOpportunity: () => {
      throw new Error("not used in this test");
    },
    createTask: () => {
      throw new Error("not used in this test");
    },
    addNote: () => {
      throw new Error("not used in this test");
    },
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
    const result = await n8n.execute({
      requestId: "test-request",
      actionId: "test-action",
      actionType: action.type,
      payload: action.payload,
    });
    assert.equal(result.ok, true, `expected ${action.type} to succeed, got error: ${result.error}`);
    assert.ok(result.response, `expected a response body for ${action.type}`);
  }
});

test("mock n8n rejects a payload that fails validation before calling GHL", async () => {
  const n8n = new MockN8nClient();

  const result = await n8n.execute({
    requestId: "test-request",
    actionId: "test-action",
    actionType: "CREATE_TASK",
    // Missing the required `title` and `dueDate` fields.
    payload: { contactId: "mock-contact-jane-doe" },
  });

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
