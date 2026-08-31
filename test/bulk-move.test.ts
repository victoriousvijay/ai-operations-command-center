/**
 * Tests the "move all opportunities in [pipeline] to [stage]" bulk-move
 * feature: the mock adapter's regex (lib/agent/mock-adapter.ts) and the
 * expansion logic that turns its single marker action into one real
 * UPDATE_OPPORTUNITY per opportunity actually in that pipeline
 * (lib/orchestration/execute.ts's expandBulkOpportunityMoves). Same
 * no-credentials-required design as mock-pipeline.test.ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { MockAgentAdapter } from "../lib/agent/mock-adapter";
import { expandBulkOpportunityMoves } from "../lib/orchestration/execute";
import type { GhlClient, GhlOpportunity, GhlPipeline } from "../lib/ghl/types";

function notUsed(): never {
  throw new Error("not used in this test");
}

function fakeGhlClient(overrides: Partial<GhlClient>): GhlClient {
  return {
    getContact: notUsed,
    searchContacts: notUsed,
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
    ...overrides,
  };
}

const SOLAR_PIPELINE: GhlPipeline = {
  id: "pipe-solar",
  name: "Solar Leads",
  stages: [
    { id: "stage-new", name: "New Lead", position: 0 },
    { id: "stage-ai-qualified", name: "AI Qualified", position: 1 },
  ],
};

const SOLAR_OPPORTUNITIES: GhlOpportunity[] = [
  { id: "opp-1", name: "Aditya Rao", contactId: "contact-1", pipelineId: "pipe-solar" },
  { id: "opp-2", name: "Meera Iyer", contactId: "contact-2", pipelineId: "pipe-solar" },
];

test("mock adapter recognizes 'move all opportunities in X pipeline to Y'", async () => {
  const adapter = new MockAgentAdapter();
  const proposal = await adapter.propose("Move all opportunities in the Solar Leads pipeline to AI Qualified.");
  assert.equal(proposal.intent, "CRM_UPDATE");
  assert.equal(proposal.actions.length, 1);
  assert.equal(proposal.actions[0]!.type, "UPDATE_OPPORTUNITY");
  assert.equal(proposal.actions[0]!.payload.bulkPipelineNameHint, "Solar Leads");
  assert.equal(proposal.actions[0]!.payload.stageNameHint, "AI Qualified");
  assert.equal(proposal.actions[0]!.payload.contactId, undefined);
  assert.equal(proposal.actions[0]!.payload.opportunityId, undefined);
});

test("expandBulkOpportunityMoves replaces the marker with one action per real opportunity", async () => {
  const ghl = fakeGhlClient({
    listPipelines: async () => [SOLAR_PIPELINE],
    searchOpportunities: async (input) => {
      assert.equal(input.pipelineId, "pipe-solar");
      return SOLAR_OPPORTUNITIES;
    },
  });

  const { actions, errors } = await expandBulkOpportunityMoves(
    [{ type: "UPDATE_OPPORTUNITY", payload: { bulkPipelineNameHint: "Solar Leads", stageNameHint: "AI Qualified" } }],
    ghl,
  );

  assert.deepEqual(errors, []);
  assert.equal(actions.length, 2);
  for (const [i, action] of actions.entries()) {
    assert.equal(action.type, "UPDATE_OPPORTUNITY");
    assert.equal(action.payload.opportunityId, SOLAR_OPPORTUNITIES[i]!.id);
    assert.equal(action.payload.contactId, SOLAR_OPPORTUNITIES[i]!.contactId);
    assert.equal(action.payload.pipelineId, "pipe-solar");
    assert.equal(action.payload.stageNameHint, "AI Qualified");
  }
});

test("expandBulkOpportunityMoves errors clearly when the pipeline name doesn't match", async () => {
  const ghl = fakeGhlClient({
    listPipelines: async () => [SOLAR_PIPELINE],
    searchOpportunities: notUsed,
  });

  const { actions, errors } = await expandBulkOpportunityMoves(
    [{ type: "UPDATE_OPPORTUNITY", payload: { bulkPipelineNameHint: "Roofing Leads", stageNameHint: "AI Qualified" } }],
    ghl,
  );

  assert.equal(actions.length, 0);
  assert.equal(errors.length, 1);
  assert.match(errors[0]!.error!, /No pipeline found matching "Roofing Leads"/);
  assert.match(errors[0]!.error!, /Solar Leads/);
});

test("expandBulkOpportunityMoves errors clearly when the pipeline has no opportunities", async () => {
  const ghl = fakeGhlClient({
    listPipelines: async () => [SOLAR_PIPELINE],
    searchOpportunities: async () => [],
  });

  const { actions, errors } = await expandBulkOpportunityMoves(
    [{ type: "UPDATE_OPPORTUNITY", payload: { bulkPipelineNameHint: "Solar Leads", stageNameHint: "AI Qualified" } }],
    ghl,
  );

  assert.equal(actions.length, 0);
  assert.equal(errors.length, 1);
  assert.match(errors[0]!.error!, /has no opportunities to move/);
});

test("expandBulkOpportunityMoves passes through non-bulk actions unchanged", async () => {
  const ghl = fakeGhlClient({});
  const normalAction = { type: "ADD_NOTE" as const, payload: { contactId: "c1", body: "hi" } };

  const { actions, errors } = await expandBulkOpportunityMoves([normalAction], ghl);

  assert.deepEqual(errors, []);
  assert.deepEqual(actions, [normalAction]);
});
