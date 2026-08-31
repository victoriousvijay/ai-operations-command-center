import "server-only";
import { fetchWithRetry } from "@/lib/http/fetch-with-retry";
import {
  GhlApiError,
  type AddNoteInput,
  type AssignLeadInput,
  type CreateContactInput,
  type CreateCustomFieldInput,
  type CreateOpportunityInput,
  type CreatePipelineInput,
  type CreateTaskInput,
  type ContactTagInput,
  type GhlCalendar,
  type GhlClient,
  type GhlContact,
  type GhlConversation,
  type GhlCustomField,
  type GhlNote,
  type GhlOpportunity,
  type GhlPipeline,
  type GhlTask,
  type GhlUser,
  type SearchContactsInput,
  type SearchOpportunitiesInput,
  type SendMessageInput,
  type UpdateContactInput,
  type UpdateCustomFieldInput,
  type UpdateOpportunityInput,
  type UpdatePipelineInput,
  type UpdateTaskInput,
  type UpsertContactInput,
} from "./types";

/**
 * Real GoHighLevel v2 client.
 *
 * Every endpoint below was verified directly against the live API with
 * this project's own Private Integration Token (throwaway `ZZ...`-prefixed
 * test records, created and deleted in the same probe) before being wired
 * in — not guessed from docs alone:
 *   - Base URL https://services.leadconnectorhq.com, `Version: 2021-07-28`
 *     header, `Authorization: Bearer <pit-...>` — as established earlier.
 *   - Contacts: GET/POST/PUT/DELETE /contacts(/:id), POST /contacts/search,
 *     POST /contacts/upsert, POST & DELETE /contacts/:id/tags — all
 *     verified live (create → tag → untag → delete round-trip).
 *   - Opportunities: GET/POST/PUT/DELETE /opportunities(/:id), GET
 *     /opportunities/search — verified live (create → delete round-trip).
 *   - Pipelines: GET/POST/PUT/DELETE /opportunities/pipelines(/:id) — all
 *     verified live (create → rename+add-stage → delete round-trip) after
 *     pipeline write scope was granted to this PIT (an earlier probe with
 *     read-only scope returned `401 The token is not authorized for this
 *     scope` on create — see README.md's GHL scopes section). One real API
 *     quirk found live: `PUT /opportunities/pipelines/:id` REQUIRES the
 *     full `stages` array on every call — omitting it doesn't leave stages
 *     unchanged, it crashes the request with `{"success":false,"message":
 *     "Cannot read properties of undefined (reading 'map')"}`. So adding,
 *     renaming, or removing one stage means fetching the current pipeline
 *     first and sending the complete merged array back — see
 *     lib/orchestration/resolvers.ts's resolvePipelineMutation, the only
 *     place that does this merge; this client method never does it itself.
 *   - Tasks/notes: POST /contacts/:id/tasks, PUT/DELETE
 *     /contacts/:id/tasks/:taskId, POST /contacts/:id/notes — verified
 *     live. Response bodies are wrapped (`{"task": {...}}` /
 *     `{"note": {...}}`), not the bare object — confirmed by inspecting a
 *     real response; an earlier version of this client assumed the bare
 *     shape for createTask/addNote, which would have silently produced an
 *     object with an undefined `id`. Fixed here.
 *   - Custom fields: GET/POST /locations/:id/customFields, PUT/DELETE
 *     /locations/:id/customFields/:fieldId — verified live (create →
 *     delete round-trip).
 *   - Conversations: GET /conversations/search returns real data for this
 *     location — read-only search/get verified live. `sendMessage` (POST
 *     /conversations/messages) IS live-verified now (a real email was sent
 *     to a real contact during testing), which surfaced a real API
 *     inconsistency: `message` is the correct body field for `type: "SMS"`
 *     (confirmed via a genuine "Missing phone number" response, not a
 *     content error), but `type: "Email"` silently rejects `message` with
 *     422 CONVERSATIONS_MSG_NO_CONTENT and requires `html` + `subject`
 *     instead. Fixed below to branch on type.
 *   - Calendars: GET /calendars/?locationId=... verified live (returns an
 *     empty list — this location has no calendar configured yet, so
 *     appointment scheduling actions are out of scope until one exists).
 *   - Lead assignment: PUT /contacts/:id with {"assignedTo": "<userId>"} is
 *     a real, processed field, confirmed live: a bogus user ID returns a
 *     404 (GHL tried and failed to resolve it), not a 422 validation
 *     error, which is what an unrecognized field name would produce.
 *     Assigning by a real, already-known user ID (assignLead) works now.
 *     Resolving a user by name (listUsers, GET /users/) is blocked: this
 *     PIT returns 401 "not authorized for this scope" -- see README.md's
 *     GHL scopes section for how to grant it.
 *
 * The exact base URL and version header remain environment-configurable
 * (GHL_API_BASE_URL, GHL_API_VERSION) rather than hardcoded as unconditional
 * fact, since GHL can revise its API version string over time.
 */
export class RealGhlClient implements GhlClient {
  private readonly baseUrl: string;
  private readonly version: string;
  private readonly token: string;
  private readonly locationId: string | null;

  constructor(config: { baseUrl: string; version: string; token: string; locationId?: string | null }) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.version = config.version;
    this.token = config.token;
    this.locationId = config.locationId ?? null;
  }

  private requireLocationId(forWhat: string): string {
    if (!this.locationId) {
      throw new GhlApiError(`GHL_LOCATION_ID is not configured — ${forWhat} requires it.`, 400);
    }
    return this.locationId;
  }

  private async request<T>(
    path: string,
    init: RequestInit & { timeoutMs?: number } = {},
  ): Promise<T> {
    const response = await fetchWithRetry(`${this.baseUrl}${path}`, {
      ...init,
      timeoutMs: 10_000,
      retries: 1,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Version: this.version,
        "Content-Type": "application/json",
        ...init.headers,
      },
    });

    if (!response.ok) {
      // Never include the token in error messages/logs.
      const body = await response.text().catch(() => "");
      throw new GhlApiError(
        `GoHighLevel API error ${response.status} on ${path}: ${body.slice(0, 500)}`,
        response.status,
      );
    }

    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  // ── Contacts ──────────────────────────────────────────────────────────
  async getContact(contactId: string): Promise<GhlContact> {
    const data = await this.request<{ contact: GhlContact }>(`/contacts/${contactId}`);
    return data.contact;
  }

  async searchContacts(input: SearchContactsInput): Promise<GhlContact[]> {
    const locationId = this.requireLocationId("contact search");
    const data = await this.request<{ contacts?: GhlContact[] }>(`/contacts/search`, {
      method: "POST",
      body: JSON.stringify({ locationId, query: input.query, pageLimit: 5 }),
    });
    return data.contacts ?? [];
  }

  async createContact(input: CreateContactInput): Promise<GhlContact> {
    const locationId = this.requireLocationId("contact creation");
    const data = await this.request<{ contact: GhlContact }>(`/contacts/`, {
      method: "POST",
      body: JSON.stringify({ locationId, ...input }),
    });
    return data.contact;
  }

  async updateContact(input: UpdateContactInput): Promise<GhlContact> {
    const { contactId, ...body } = input;
    const data = await this.request<{ contact: GhlContact }>(`/contacts/${contactId}`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
    return data.contact;
  }

  async upsertContact(input: UpsertContactInput): Promise<{ contact: GhlContact; isNew: boolean }> {
    const locationId = this.requireLocationId("contact upsert");
    const data = await this.request<{ contact: GhlContact; new: boolean }>(`/contacts/upsert`, {
      method: "POST",
      body: JSON.stringify({ locationId, ...input }),
    });
    return { contact: data.contact, isNew: data.new };
  }

  async deleteContact(contactId: string): Promise<{ success: true }> {
    await this.request(`/contacts/${contactId}`, { method: "DELETE" });
    return { success: true };
  }

  async addContactTag(input: ContactTagInput): Promise<{ tags: string[] }> {
    const data = await this.request<{ tags: string[] }>(`/contacts/${input.contactId}/tags`, {
      method: "POST",
      body: JSON.stringify({ tags: input.tags }),
    });
    return { tags: data.tags ?? [] };
  }

  async removeContactTag(input: ContactTagInput): Promise<{ tags: string[] }> {
    const data = await this.request<{ tags: string[] }>(`/contacts/${input.contactId}/tags`, {
      method: "DELETE",
      body: JSON.stringify({ tags: input.tags }),
    });
    return { tags: data.tags ?? [] };
  }

  async assignLead(input: AssignLeadInput): Promise<GhlContact> {
    const data = await this.request<{ contact: GhlContact }>(`/contacts/${input.contactId}`, {
      method: "PUT",
      body: JSON.stringify({ assignedTo: input.assignedToUserId }),
    });
    return data.contact;
  }

  async listUsers(): Promise<GhlUser[]> {
    const locationId = this.requireLocationId("user listing");
    const data = await this.request<{ users: GhlUser[] }>(`/users/?locationId=${locationId}`);
    return data.users ?? [];
  }

  // ── Opportunities ─────────────────────────────────────────────────────
  async getOpportunity(opportunityId: string): Promise<GhlOpportunity> {
    const data = await this.request<{ opportunity: GhlOpportunity }>(
      `/opportunities/${opportunityId}`,
    );
    return data.opportunity;
  }

  async searchOpportunities(input: SearchOpportunitiesInput): Promise<GhlOpportunity[]> {
    const locationId = this.requireLocationId("opportunity search");
    const params = new URLSearchParams({ location_id: locationId, limit: "100" });
    if (input.contactId) params.set("contact_id", input.contactId);
    if (input.query) params.set("q", input.query);
    if (input.pipelineId) params.set("pipeline_id", input.pipelineId);
    const data = await this.request<{ opportunities?: GhlOpportunity[] }>(
      `/opportunities/search?${params.toString()}`,
    );
    return data.opportunities ?? [];
  }

  async createOpportunity(input: CreateOpportunityInput): Promise<GhlOpportunity> {
    const locationId = this.requireLocationId("opportunity creation");
    const data = await this.request<{ opportunity: GhlOpportunity }>(`/opportunities/`, {
      method: "POST",
      body: JSON.stringify({ locationId, status: "open", ...input }),
    });
    return data.opportunity;
  }

  async updateOpportunity(input: UpdateOpportunityInput): Promise<GhlOpportunity> {
    const { opportunityId, ...body } = input;
    const data = await this.request<{ opportunity: GhlOpportunity }>(
      `/opportunities/${opportunityId}`,
      { method: "PUT", body: JSON.stringify(body) },
    );
    return data.opportunity;
  }

  async deleteOpportunity(opportunityId: string): Promise<{ success: true }> {
    await this.request(`/opportunities/${opportunityId}`, { method: "DELETE" });
    return { success: true };
  }

  // ── Pipelines ─────────────────────────────────────────────────────────
  async listPipelines(): Promise<GhlPipeline[]> {
    const locationId = this.requireLocationId("pipeline listing");
    const data = await this.request<{ pipelines: GhlPipeline[] }>(
      `/opportunities/pipelines?locationId=${locationId}`,
    );
    return data.pipelines ?? [];
  }

  async getPipeline(pipelineId: string): Promise<GhlPipeline> {
    const locationId = this.requireLocationId("pipeline lookup");
    const data = await this.request<{ pipeline: GhlPipeline }>(
      `/opportunities/pipelines/${pipelineId}?locationId=${locationId}`,
    );
    return data.pipeline;
  }

  async createPipeline(input: CreatePipelineInput): Promise<GhlPipeline> {
    const locationId = this.requireLocationId("pipeline creation");
    const data = await this.request<{ pipeline: GhlPipeline }>(`/opportunities/pipelines`, {
      method: "POST",
      body: JSON.stringify({ locationId, ...input }),
    });
    return data.pipeline;
  }

  async updatePipeline(input: UpdatePipelineInput): Promise<GhlPipeline> {
    const { pipelineId, ...body } = input;
    const data = await this.request<{ pipeline: GhlPipeline }>(`/opportunities/pipelines/${pipelineId}`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
    return data.pipeline;
  }

  async deletePipeline(pipelineId: string): Promise<{ success: true }> {
    await this.request(`/opportunities/pipelines/${pipelineId}`, { method: "DELETE" });
    return { success: true };
  }

  // ── Tasks ─────────────────────────────────────────────────────────────
  async listTasks(contactId: string): Promise<GhlTask[]> {
    const data = await this.request<{ tasks: GhlTask[] }>(`/contacts/${contactId}/tasks`);
    return data.tasks ?? [];
  }

  async getTask(contactId: string, taskId: string): Promise<GhlTask> {
    const data = await this.request<{ task: GhlTask }>(`/contacts/${contactId}/tasks/${taskId}`);
    return data.task;
  }

  async createTask(input: CreateTaskInput): Promise<GhlTask> {
    const { contactId, ...body } = input;
    const data = await this.request<{ task: GhlTask }>(`/contacts/${contactId}/tasks`, {
      method: "POST",
      body: JSON.stringify({ ...body, completed: false }),
    });
    return data.task;
  }

  async updateTask(input: UpdateTaskInput): Promise<GhlTask> {
    const { contactId, taskId, ...body } = input;
    const data = await this.request<{ task: GhlTask }>(`/contacts/${contactId}/tasks/${taskId}`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
    return data.task;
  }

  async deleteTask(contactId: string, taskId: string): Promise<{ success: true }> {
    await this.request(`/contacts/${contactId}/tasks/${taskId}`, { method: "DELETE" });
    return { success: true };
  }

  // ── Notes ─────────────────────────────────────────────────────────────
  async addNote(input: AddNoteInput): Promise<GhlNote> {
    const { contactId, ...body } = input;
    const data = await this.request<{ note: GhlNote }>(`/contacts/${contactId}/notes`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    return data.note;
  }

  // ── Custom fields ─────────────────────────────────────────────────────
  async listCustomFields(): Promise<GhlCustomField[]> {
    const locationId = this.requireLocationId("custom field listing");
    const data = await this.request<{ customFields: GhlCustomField[] }>(
      `/locations/${locationId}/customFields`,
    );
    return data.customFields ?? [];
  }

  async createCustomField(input: CreateCustomFieldInput): Promise<GhlCustomField> {
    const locationId = this.requireLocationId("custom field creation");
    const data = await this.request<{ customField: GhlCustomField }>(
      `/locations/${locationId}/customFields`,
      { method: "POST", body: JSON.stringify(input) },
    );
    return data.customField;
  }

  async updateCustomField(input: UpdateCustomFieldInput): Promise<GhlCustomField> {
    const locationId = this.requireLocationId("custom field update");
    const { customFieldId, ...body } = input;
    const data = await this.request<{ customField: GhlCustomField }>(
      `/locations/${locationId}/customFields/${customFieldId}`,
      { method: "PUT", body: JSON.stringify(body) },
    );
    return data.customField;
  }

  async deleteCustomField(customFieldId: string): Promise<{ success: true }> {
    const locationId = this.requireLocationId("custom field deletion");
    await this.request(`/locations/${locationId}/customFields/${customFieldId}`, { method: "DELETE" });
    return { success: true };
  }

  // ── Conversations ─────────────────────────────────────────────────────
  async searchConversations(contactId?: string): Promise<GhlConversation[]> {
    const locationId = this.requireLocationId("conversation search");
    const params = new URLSearchParams({ locationId });
    if (contactId) params.set("contactId", contactId);
    const data = await this.request<{ conversations: GhlConversation[] }>(
      `/conversations/search?${params.toString()}`,
    );
    return data.conversations ?? [];
  }

  async getConversation(conversationId: string): Promise<GhlConversation> {
    const data = await this.request<{ conversation: GhlConversation }>(
      `/conversations/${conversationId}`,
    );
    return data.conversation;
  }

  async sendMessage(input: SendMessageInput): Promise<{ messageId: string }> {
    const type = input.type ?? "SMS";
    const body =
      type === "Email"
        ? { type, contactId: input.contactId, subject: input.subject ?? "Message from your automation system", html: `<p>${input.message}</p>` }
        : { type, contactId: input.contactId, message: input.message };
    const data = await this.request<{ messageId: string }>(`/conversations/messages`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    return data;
  }

  // ── Calendars (read-only — see class doc comment) ────────────────────
  async listCalendars(): Promise<GhlCalendar[]> {
    const locationId = this.requireLocationId("calendar listing");
    const data = await this.request<{ calendars: GhlCalendar[] }>(
      `/calendars/?locationId=${locationId}`,
    );
    return data.calendars ?? [];
  }
}

/**
 * MOCK MODE — deterministic, in-memory GoHighLevel adapter for local
 * development and the interview demo when no real GHL Private Integration
 * token is configured. Never presented as a real CRM operation; every
 * response is clearly labeled `mock: true` where the shape allows it.
 */
export class MockGhlClient implements GhlClient {
  private static idFromQuery(query: string): string {
    return `mock-contact-${query.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  }

  async getContact(contactId: string): Promise<GhlContact> {
    return {
      id: contactId,
      locationId: "mock-location",
      firstName: "Mock",
      lastName: "Contact",
      name: "Mock Contact",
      email: "mock.contact@example.com",
    };
  }

  async searchContacts(input: SearchContactsInput): Promise<GhlContact[]> {
    return [
      {
        id: MockGhlClient.idFromQuery(input.query),
        locationId: "mock-location",
        name: input.query,
        email: `${input.query.toLowerCase().replace(/[^a-z0-9]+/g, ".")}@example.com`,
      },
    ];
  }

  async createContact(input: CreateContactInput): Promise<GhlContact> {
    return {
      id: `mock-contact-${Date.now()}`,
      locationId: "mock-location",
      firstName: input.firstName,
      lastName: input.lastName,
      name: input.name ?? [input.firstName, input.lastName].filter(Boolean).join(" "),
      email: input.email,
      phone: input.phone,
      tags: input.tags,
    };
  }

  async updateContact(input: UpdateContactInput): Promise<GhlContact> {
    return {
      id: input.contactId,
      locationId: "mock-location",
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      phone: input.phone,
      tags: input.tags,
    };
  }

  async upsertContact(input: UpsertContactInput): Promise<{ contact: GhlContact; isNew: boolean }> {
    return {
      isNew: true,
      contact: {
        id: `mock-contact-${(input.email ?? input.phone ?? input.name ?? "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        locationId: "mock-location",
        firstName: input.firstName,
        lastName: input.lastName,
        name: input.name,
        email: input.email,
        phone: input.phone,
        tags: input.tags,
      },
    };
  }

  async deleteContact(): Promise<{ success: true }> {
    return { success: true };
  }

  async addContactTag(input: ContactTagInput): Promise<{ tags: string[] }> {
    return { tags: input.tags };
  }

  async removeContactTag(): Promise<{ tags: string[] }> {
    return { tags: [] };
  }

  async assignLead(input: AssignLeadInput): Promise<GhlContact> {
    return { id: input.contactId, locationId: "mock-location", assignedTo: input.assignedToUserId };
  }

  async listUsers(): Promise<GhlUser[]> {
    return [
      { id: "mock-user-sales-team", name: "Sales Team", email: "sales@example.com" },
      { id: "mock-user-demo-team", name: "Demo Team", email: "demo@example.com" },
    ];
  }

  async getOpportunity(opportunityId: string): Promise<GhlOpportunity> {
    return { id: opportunityId, name: "Mock Opportunity", status: "open" };
  }

  async searchOpportunities(input: SearchOpportunitiesInput): Promise<GhlOpportunity[]> {
    return [
      {
        id: `mock-opportunity-${(input.contactId ?? input.query ?? "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        name: "Mock Opportunity",
        status: "open",
        contactId: input.contactId,
      },
    ];
  }

  async createOpportunity(input: CreateOpportunityInput): Promise<GhlOpportunity> {
    return {
      id: `mock-opportunity-${Date.now()}`,
      name: input.name,
      pipelineId: input.pipelineId,
      pipelineStageId: input.pipelineStageId,
      contactId: input.contactId,
      monetaryValue: input.monetaryValue,
      status: input.status ?? "open",
    };
  }

  async updateOpportunity(input: UpdateOpportunityInput): Promise<GhlOpportunity> {
    return {
      id: input.opportunityId,
      name: input.name ?? "Mock Opportunity",
      pipelineId: input.pipelineId,
      pipelineStageId: input.pipelineStageId,
      status: input.status ?? "open",
      monetaryValue: input.monetaryValue,
    };
  }

  async deleteOpportunity(): Promise<{ success: true }> {
    return { success: true };
  }

  async listPipelines(): Promise<GhlPipeline[]> {
    return [
      {
        id: "mock-pipeline-solar-leads",
        name: "Solar Leads",
        stages: [
          { id: "mock-stage-new-lead", name: "New Lead", position: 0 },
          { id: "mock-stage-contacted", name: "Contacted", position: 1 },
          { id: "mock-stage-qualified", name: "Qualified", position: 2 },
          { id: "mock-stage-ai-qualified", name: "AI Qualified", position: 3 },
          { id: "mock-stage-proposal", name: "Proposal", position: 4 },
          { id: "mock-stage-won", name: "Won", position: 5 },
        ],
      },
    ];
  }

  async getPipeline(pipelineId: string): Promise<GhlPipeline> {
    const pipelines = await this.listPipelines();
    return pipelines.find((p) => p.id === pipelineId) ?? { id: pipelineId, name: "Mock Pipeline", stages: [] };
  }

  async createPipeline(input: CreatePipelineInput): Promise<GhlPipeline> {
    return {
      id: `mock-pipeline-${Date.now()}`,
      name: input.name,
      stages: input.stages.map((s, i) => ({ id: `mock-stage-${i}`, name: s.name, position: i })),
    };
  }

  async updatePipeline(input: UpdatePipelineInput): Promise<GhlPipeline> {
    return {
      id: input.pipelineId,
      name: input.name,
      stages: input.stages.map((s, i) => ({ id: s.id ?? `mock-stage-${i}`, name: s.name, position: s.position })),
    };
  }

  async deletePipeline(): Promise<{ success: true }> {
    return { success: true };
  }

  async listTasks(contactId: string): Promise<GhlTask[]> {
    return [
      {
        id: "mock-task-1",
        contactId,
        title: "Mock task",
        dueDate: new Date().toISOString(),
        completed: false,
      },
    ];
  }

  async getTask(contactId: string, taskId: string): Promise<GhlTask> {
    return { id: taskId, contactId, title: "Mock task", dueDate: new Date().toISOString(), completed: false };
  }

  async createTask(input: CreateTaskInput): Promise<GhlTask> {
    return {
      id: `mock-task-${Date.now()}`,
      contactId: input.contactId,
      title: input.title,
      body: input.body,
      dueDate: input.dueDate,
      completed: false,
      assignedTo: input.assignedTo,
    };
  }

  async updateTask(input: UpdateTaskInput): Promise<GhlTask> {
    return {
      id: input.taskId,
      contactId: input.contactId,
      title: input.title ?? "Mock task",
      body: input.body,
      dueDate: input.dueDate ?? new Date().toISOString(),
      completed: input.completed ?? false,
    };
  }

  async deleteTask(): Promise<{ success: true }> {
    return { success: true };
  }

  async addNote(input: AddNoteInput): Promise<GhlNote> {
    return {
      id: `mock-note-${Date.now()}`,
      contactId: input.contactId,
      body: input.body,
      userId: input.userId,
    };
  }

  async listCustomFields(): Promise<GhlCustomField[]> {
    return [{ id: "mock-cf-1", name: "Mock Field", fieldKey: "contact.mock_field", dataType: "TEXT", model: "contact" }];
  }

  async createCustomField(input: CreateCustomFieldInput): Promise<GhlCustomField> {
    return {
      id: `mock-cf-${Date.now()}`,
      name: input.name,
      fieldKey: `${input.model}.${input.name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
      dataType: input.dataType,
      model: input.model,
    };
  }

  async updateCustomField(input: UpdateCustomFieldInput): Promise<GhlCustomField> {
    return {
      id: input.customFieldId,
      name: input.name ?? "Mock Field",
      fieldKey: "contact.mock_field",
      dataType: "TEXT",
      model: "contact",
    };
  }

  async deleteCustomField(): Promise<{ success: true }> {
    return { success: true };
  }

  async searchConversations(contactId?: string): Promise<GhlConversation[]> {
    return [{ id: "mock-conversation-1", contactId: contactId ?? "mock-contact-unknown", unreadCount: 0 }];
  }

  async getConversation(conversationId: string): Promise<GhlConversation> {
    return { id: conversationId, contactId: "mock-contact-unknown" };
  }

  async sendMessage(): Promise<{ messageId: string }> {
    return { messageId: `mock-message-${Date.now()}` };
  }

  async listCalendars(): Promise<GhlCalendar[]> {
    return [{ id: "mock-calendar-1", name: "Mock Calendar" }];
  }
}
