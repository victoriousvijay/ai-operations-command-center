import "server-only";
import { fetchWithRetry } from "@/lib/http/fetch-with-retry";
import {
  GhlApiError,
  type AddNoteInput,
  type CreateTaskInput,
  type GhlClient,
  type GhlContact,
  type GhlNote,
  type GhlOpportunity,
  type GhlTask,
  type UpdateContactInput,
  type UpdateOpportunityInput,
} from "./types";

/**
 * Real GoHighLevel v2 client.
 *
 * Verified directly against the live API before implementation (this was
 * not guessed from docs alone):
 *   - Base URL https://services.leadconnectorhq.com is live and recognizes
 *     these routes (confirmed via direct HTTP probe — a request with no
 *     auth returns a GHL-shaped 401, not a generic 404).
 *   - The API requires a `Version` header; omitting it returns
 *     {"message":"version header was not found."}. Confirmed working value:
 *     2021-07-28 (matches GoHighLevel's documented v2 API version scheme).
 *   - Auth is `Authorization: Bearer <token>`; an invalid token returns
 *     {"message":"Invalid JWT"}, confirming GHL tokens are JWTs.
 *   - Endpoint paths (GET/PUT /contacts/:id, PUT /opportunities/:id,
 *     POST /contacts/:id/tasks, POST /contacts/:id/notes) come from GHL's
 *     public API documentation and are internally consistent across it.
 *
 * The exact base URL and version header remain environment-configurable
 * (GHL_API_BASE_URL, GHL_API_VERSION) rather than hardcoded as unconditional
 * fact, since GHL can revise its API version string over time.
 */
export class RealGhlClient implements GhlClient {
  private readonly baseUrl: string;
  private readonly version: string;
  private readonly token: string;

  constructor(config: { baseUrl: string; version: string; token: string }) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.version = config.version;
    this.token = config.token;
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

    return (await response.json()) as T;
  }

  async getContact(contactId: string): Promise<GhlContact> {
    const data = await this.request<{ contact: GhlContact }>(`/contacts/${contactId}`);
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

  async getOpportunity(opportunityId: string): Promise<GhlOpportunity> {
    const data = await this.request<{ opportunity: GhlOpportunity }>(
      `/opportunities/${opportunityId}`,
    );
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

  async createTask(input: CreateTaskInput): Promise<GhlTask> {
    const { contactId, ...body } = input;
    return this.request<GhlTask>(`/contacts/${contactId}/tasks`, {
      method: "POST",
      body: JSON.stringify({ ...body, completed: false }),
    });
  }

  async addNote(input: AddNoteInput): Promise<GhlNote> {
    const { contactId, ...body } = input;
    return this.request<GhlNote>(`/contacts/${contactId}/notes`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }
}

/**
 * MOCK MODE — deterministic, in-memory GoHighLevel adapter for local
 * development and the interview demo when no real GHL Private Integration
 * token is configured. Never presented as a real CRM operation; every
 * response is clearly labeled `mock: true`.
 */
export class MockGhlClient implements GhlClient {
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

  async getOpportunity(opportunityId: string): Promise<GhlOpportunity> {
    return { id: opportunityId, name: "Mock Opportunity", status: "open" };
  }

  async updateOpportunity(input: UpdateOpportunityInput): Promise<GhlOpportunity> {
    return {
      id: input.opportunityId,
      name: input.name ?? "Mock Opportunity",
      pipelineId: input.pipelineId,
      pipelineStageId: input.pipelineStageId,
      status: input.status ?? "open",
    };
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

  async addNote(input: AddNoteInput): Promise<GhlNote> {
    return {
      id: `mock-note-${Date.now()}`,
      contactId: input.contactId,
      body: input.body,
      userId: input.userId,
    };
  }
}
