/**
 * Tests the expanded controlled action registry: reference resolution
 * (contact/opportunity/pipeline-stage name hints -> real IDs), the
 * GHL request builder (lib/actions/registry.ts), and the mock dispatch
 * path for actions beyond the original 7. Same no-credentials-required
 * design as mock-pipeline.test.ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ALLOWED_ACTIONS, MUTATION_TIER } from "../lib/actions/allowlist";
import { buildGhlRequest } from "../lib/actions/registry";
import { MockN8nClient, attachGhlRequest } from "../lib/n8n/client";
import { resolveOpportunityId, resolvePipelineMutation, resolvePipelineStage } from "../lib/orchestration/resolvers";
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

test("every allowed action has a mutation tier and a working GHL request builder", () => {
  for (const action of ALLOWED_ACTIONS) {
    assert.ok(MUTATION_TIER[action], `${action} is missing a MUTATION_TIER entry`);
    // A representative payload with every commonly-needed field present —
    // buildGhlRequest must not throw for any allowed action.
    process.env.GHL_LOCATION_ID = "loc_test";
    const request = buildGhlRequest(action, {
      contactId: "c1",
      opportunityId: "o1",
      taskId: "t1",
      customFieldId: "cf1",
      conversationId: "conv1",
      tags: ["hot-lead"],
      query: "Rahul",
      pipelineId: "p1",
      name: "Solar Leads",
      stages: [{ id: "s1", name: "New Lead", position: 0 }],
    });
    assert.ok(request.method, `${action} did not produce a method`);
    assert.ok(request.path, `${action} did not produce a path`);
    delete process.env.GHL_LOCATION_ID;
  }
});

test("destructive actions all require confirmation per MUTATION_TIER", () => {
  for (const action of ["DELETE_CONTACT", "DELETE_OPPORTUNITY", "DELETE_TASK", "DELETE_CUSTOM_FIELD", "SEND_MESSAGE"] as const) {
    assert.equal(MUTATION_TIER[action], "destructive", `${action} should be destructive`);
  }
  for (const action of ["SEARCH_CONTACTS", "GET_CONTACT", "LIST_PIPELINES", "LIST_TASKS"] as const) {
    assert.equal(MUTATION_TIER[action], "readonly", `${action} should be readonly`);
  }
});

test("resolveOpportunityId finds the contact's single opportunity in real mode", async () => {
  const previous = process.env.GHL_ADAPTER;
  process.env.GHL_ADAPTER = "real";
  try {
    const ghl = fakeGhlClient({
      searchOpportunities: async () => [{ id: "real-opp-1", name: "Solar Deal" } as GhlOpportunity],
    });
    const result = await resolveOpportunityId(ghl, { contactId: "real-contact-1", opportunityLookupHint: true });
    assert.equal(result.error, undefined);
    assert.equal(result.payload.opportunityId, "real-opp-1");
    assert.equal("opportunityLookupHint" in result.payload, false);
  } finally {
    process.env.GHL_ADAPTER = previous;
  }
});

test("resolveOpportunityId errors clearly when the contact has no opportunity", async () => {
  const previous = process.env.GHL_ADAPTER;
  process.env.GHL_ADAPTER = "real";
  try {
    const ghl = fakeGhlClient({ searchOpportunities: async () => [] });
    const result = await resolveOpportunityId(ghl, { contactId: "real-contact-1", opportunityLookupHint: true });
    assert.match(result.error ?? "", /has no opportunity/);
  } finally {
    process.env.GHL_ADAPTER = previous;
  }
});

test("resolveOpportunityId errors clearly when the contact has multiple opportunities (never guesses)", async () => {
  const previous = process.env.GHL_ADAPTER;
  process.env.GHL_ADAPTER = "real";
  try {
    const ghl = fakeGhlClient({
      searchOpportunities: async () => [
        { id: "real-opp-1", name: "Solar Deal" } as GhlOpportunity,
        { id: "real-opp-2", name: "Roofing Deal" } as GhlOpportunity,
      ],
    });
    const result = await resolveOpportunityId(ghl, { contactId: "real-contact-1", opportunityLookupHint: true });
    assert.match(result.error ?? "", /multiple opportunities/);
  } finally {
    process.env.GHL_ADAPTER = previous;
  }
});

const SOLAR_PIPELINE: GhlPipeline = {
  id: "pipe-solar",
  name: "Solar Leads",
  stages: [
    { id: "stage-new", name: "New Lead", position: 0 },
    { id: "stage-qualified", name: "Qualified", position: 1 },
    { id: "stage-ai-qualified", name: "AI Qualified", position: 2 },
  ],
};

test("resolvePipelineStage matches a stage name to real pipeline/stage IDs", async () => {
  const previous = process.env.GHL_ADAPTER;
  process.env.GHL_ADAPTER = "real";
  try {
    const ghl = fakeGhlClient({ listPipelines: async () => [SOLAR_PIPELINE] });
    const result = await resolvePipelineStage(ghl, { pipelineStageId: "mock-stage-ai-qualified", stageNameHint: "AI Qualified" });
    assert.equal(result.error, undefined);
    assert.equal(result.payload.pipelineId, "pipe-solar");
    assert.equal(result.payload.pipelineStageId, "stage-ai-qualified");
  } finally {
    process.env.GHL_ADAPTER = previous;
  }
});

test("resolvePipelineStage errors clearly (and lists real stages) when no stage matches", async () => {
  const previous = process.env.GHL_ADAPTER;
  process.env.GHL_ADAPTER = "real";
  try {
    const ghl = fakeGhlClient({ listPipelines: async () => [SOLAR_PIPELINE] });
    const result = await resolvePipelineStage(ghl, { pipelineStageId: "mock-stage-nope", stageNameHint: "Nope" });
    assert.match(result.error ?? "", /No pipeline stage found/);
    assert.match(result.error ?? "", /Solar Leads > New Lead/);
  } finally {
    process.env.GHL_ADAPTER = previous;
  }
});

test("mock n8n dispatches CREATE_CONTACT, ADD_CONTACT_TAG, and LIST_PIPELINES through the mock GHL client", async () => {
  process.env.GHL_LOCATION_ID = "loc_test";
  const n8n = new MockN8nClient();

  const created = await n8n.execute(
    attachGhlRequest({
      requestId: "r1",
      actionId: "a1",
      actionType: "CREATE_CONTACT",
      payload: { firstName: "Rahul", lastName: "Sharma", email: "rahul@example.com" },
    }),
  );
  assert.equal(created.ok, true);

  const tagged = await n8n.execute(
    attachGhlRequest({
      requestId: "r1",
      actionId: "a2",
      actionType: "ADD_CONTACT_TAG",
      payload: { contactId: "mock-contact-rahul-sharma", tags: ["hot-lead"] },
    }),
  );
  assert.equal(tagged.ok, true);

  const pipelines = await n8n.execute(
    attachGhlRequest({ requestId: "r1", actionId: "a3", actionType: "LIST_PIPELINES", payload: {} }),
  );
  assert.equal(pipelines.ok, true);
  assert.ok(Array.isArray(pipelines.response?.pipelines));
  delete process.env.GHL_LOCATION_ID;
});

const SOLAR_PIPELINE_FULL: GhlPipeline = {
  id: "pipe-solar",
  name: "Solar Leads",
  stages: [
    { id: "stage-new", name: "New Lead", position: 0 },
    { id: "stage-qualified", name: "Qualified", position: 1 },
  ],
};

test("resolvePipelineMutation resolves a pipeline by name and preserves stages on UPDATE_PIPELINE", async () => {
  const ghl = fakeGhlClient({
    listPipelines: async () => [SOLAR_PIPELINE_FULL],
    getPipeline: async (id) => (id === "pipe-solar" ? SOLAR_PIPELINE_FULL : notUsed()),
  });
  const result = await resolvePipelineMutation(ghl, "UPDATE_PIPELINE", { pipelineNameHint: "Solar Leads", name: "Solar Deals" });
  assert.equal(result.error, undefined);
  assert.equal(result.payload.pipelineId, "pipe-solar");
  assert.equal(result.payload.name, "Solar Deals");
  assert.deepEqual(result.payload.stages, [
    { id: "stage-new", name: "New Lead", position: 0 },
    { id: "stage-qualified", name: "Qualified", position: 1 },
  ]);
});

test("resolvePipelineMutation appends a new stage without dropping existing ones (CREATE_PIPELINE_STAGE)", async () => {
  const ghl = fakeGhlClient({ getPipeline: async () => SOLAR_PIPELINE_FULL });
  const result = await resolvePipelineMutation(ghl, "CREATE_PIPELINE_STAGE", { pipelineId: "pipe-solar", stageName: "Proposal Sent" });
  assert.equal(result.error, undefined);
  const stages = result.payload.stages as Array<{ name: string }>;
  assert.equal(stages.length, 3);
  assert.equal(stages[0]!.name, "New Lead");
  assert.equal(stages[1]!.name, "Qualified");
  assert.equal(stages[2]!.name, "Proposal Sent");
});

test("resolvePipelineMutation renames one stage in place (UPDATE_PIPELINE_STAGE)", async () => {
  const ghl = fakeGhlClient({ getPipeline: async () => SOLAR_PIPELINE_FULL });
  const result = await resolvePipelineMutation(ghl, "UPDATE_PIPELINE_STAGE", {
    pipelineId: "pipe-solar",
    stageNameHint: "Qualified",
    newStageName: "Hot Lead",
  });
  assert.equal(result.error, undefined);
  const stages = result.payload.stages as Array<{ name: string }>;
  assert.equal(stages.length, 2);
  assert.equal(stages[0]!.name, "New Lead");
  assert.equal(stages[1]!.name, "Hot Lead");
});

test("resolvePipelineMutation removes one stage and renumbers the rest (DELETE_PIPELINE_STAGE)", async () => {
  const ghl = fakeGhlClient({ getPipeline: async () => SOLAR_PIPELINE_FULL });
  const result = await resolvePipelineMutation(ghl, "DELETE_PIPELINE_STAGE", { pipelineId: "pipe-solar", stageNameHint: "New Lead" });
  assert.equal(result.error, undefined);
  const stages = result.payload.stages as Array<{ name: string; position: number }>;
  assert.equal(stages.length, 1);
  assert.equal(stages[0]!.name, "Qualified");
  assert.equal(stages[0]!.position, 0);
});

test("resolvePipelineMutation errors clearly (lists real pipelines) when no pipeline matches", async () => {
  const ghl = fakeGhlClient({ listPipelines: async () => [SOLAR_PIPELINE_FULL] });
  const result = await resolvePipelineMutation(ghl, "DELETE_PIPELINE", { pipelineNameHint: "Nonexistent Pipeline" });
  assert.match(result.error ?? "", /No pipeline found matching/);
  assert.match(result.error ?? "", /Solar Leads/);
});

test("resolvePipelineMutation errors clearly when no stage matches (never guesses)", async () => {
  const ghl = fakeGhlClient({ getPipeline: async () => SOLAR_PIPELINE_FULL });
  const result = await resolvePipelineMutation(ghl, "DELETE_PIPELINE_STAGE", { pipelineId: "pipe-solar", stageNameHint: "Nonexistent Stage" });
  assert.match(result.error ?? "", /No stage found matching/);
});
