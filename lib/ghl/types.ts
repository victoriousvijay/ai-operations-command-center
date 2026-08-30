/**
 * GoHighLevel v2 REST API contract, scoped to the operations this system
 * needs. Verified directly against the live API host
 * (https://services.leadconnectorhq.com) and GHL's public API docs before
 * implementation — not invented. See lib/ghl/client.ts for the verification
 * notes (confirmed base URL, required `Version` header value, and bearer
 * auth via direct HTTP probes).
 */

export interface GhlContact {
  id: string;
  locationId: string;
  firstName?: string;
  lastName?: string;
  name?: string;
  email?: string;
  phone?: string;
  tags?: string[];
}

export interface GhlOpportunity {
  id: string;
  name?: string;
  pipelineId?: string;
  pipelineStageId?: string;
  status?: "open" | "won" | "lost" | "abandoned";
  monetaryValue?: number;
}

export interface GhlTask {
  id: string;
  contactId: string;
  title: string;
  body?: string;
  dueDate: string;
  completed: boolean;
  assignedTo?: string;
}

export interface GhlNote {
  id: string;
  contactId: string;
  body: string;
  userId?: string;
}

export interface UpdateContactInput {
  contactId: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  tags?: string[];
  customFields?: Array<{ key: string; field_value: string }>;
}

export interface UpdateOpportunityInput {
  opportunityId: string;
  pipelineId?: string;
  pipelineStageId?: string;
  status?: "open" | "won" | "lost" | "abandoned";
  name?: string;
}

export interface CreateTaskInput {
  contactId: string;
  title: string;
  body?: string;
  dueDate: string;
  assignedTo?: string;
}

export interface AddNoteInput {
  contactId: string;
  body: string;
  userId?: string;
}

/**
 * Adapter boundary between our application and GoHighLevel. Implementations
 * must never log or return the raw access token.
 */
export interface GhlClient {
  getContact(contactId: string): Promise<GhlContact>;
  updateContact(input: UpdateContactInput): Promise<GhlContact>;
  getOpportunity(opportunityId: string): Promise<GhlOpportunity>;
  updateOpportunity(input: UpdateOpportunityInput): Promise<GhlOpportunity>;
  createTask(input: CreateTaskInput): Promise<GhlTask>;
  addNote(input: AddNoteInput): Promise<GhlNote>;
}

export class GhlApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "GhlApiError";
  }
}
