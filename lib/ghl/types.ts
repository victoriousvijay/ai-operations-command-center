/**
 * GoHighLevel v2 REST API contract, scoped to the operations this system
 * needs. Every shape here was verified directly against the live API host
 * (https://services.leadconnectorhq.com) with this project's own Private
 * Integration Token before being implemented — not invented from docs
 * alone. See lib/ghl/client.ts for the verification notes.
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
  companyName?: string;
}

export interface GhlOpportunity {
  id: string;
  name?: string;
  pipelineId?: string;
  pipelineStageId?: string;
  contactId?: string;
  status?: "open" | "won" | "lost" | "abandoned";
  monetaryValue?: number;
}

export interface GhlPipelineStage {
  id: string;
  name: string;
  position: number;
}

export interface GhlPipeline {
  id: string;
  name: string;
  stages: GhlPipelineStage[];
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

export interface GhlCustomField {
  id: string;
  name: string;
  fieldKey: string;
  dataType: string;
  model: string;
}

export interface GhlConversation {
  id: string;
  contactId: string;
  fullName?: string;
  lastMessageType?: string;
  unreadCount?: number;
}

export interface GhlCalendar {
  id: string;
  name: string;
}

// ── Contacts ────────────────────────────────────────────────────────────
export interface CreateContactInput {
  firstName?: string;
  lastName?: string;
  name?: string;
  email?: string;
  phone?: string;
  companyName?: string;
  tags?: string[];
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

export interface UpsertContactInput {
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  name?: string;
  tags?: string[];
  customFields?: Array<{ key: string; field_value: string }>;
}

export interface SearchContactsInput {
  /** Free-text search — matches GHL's contact search across name/email/phone. */
  query: string;
}

export interface ContactTagInput {
  contactId: string;
  tags: string[];
}

// ── Opportunities ───────────────────────────────────────────────────────
export interface CreateOpportunityInput {
  contactId: string;
  pipelineId: string;
  pipelineStageId: string;
  name: string;
  monetaryValue?: number;
  status?: "open" | "won" | "lost" | "abandoned";
}

export interface UpdateOpportunityInput {
  opportunityId: string;
  pipelineId?: string;
  pipelineStageId?: string;
  status?: "open" | "won" | "lost" | "abandoned";
  name?: string;
  monetaryValue?: number;
}

export interface SearchOpportunitiesInput {
  contactId?: string;
  query?: string;
}

// ── Tasks / notes ───────────────────────────────────────────────────────
export interface CreateTaskInput {
  contactId: string;
  title: string;
  body?: string;
  dueDate: string;
  assignedTo?: string;
}

export interface UpdateTaskInput {
  contactId: string;
  taskId: string;
  title?: string;
  body?: string;
  dueDate?: string;
  completed?: boolean;
}

export interface AddNoteInput {
  contactId: string;
  body: string;
  userId?: string;
}

// ── Custom fields ───────────────────────────────────────────────────────
export interface CreateCustomFieldInput {
  name: string;
  dataType: string;
  model: "contact" | "opportunity";
}

export interface UpdateCustomFieldInput {
  customFieldId: string;
  name?: string;
}

// ── Conversations ───────────────────────────────────────────────────────
export interface SendMessageInput {
  contactId: string;
  message: string;
  type?: "SMS" | "Email";
}

/**
 * Adapter boundary between our application and GoHighLevel. Implementations
 * must never log or return the raw access token.
 */
export interface GhlClient {
  // Contacts
  getContact(contactId: string): Promise<GhlContact>;
  searchContacts(input: SearchContactsInput): Promise<GhlContact[]>;
  createContact(input: CreateContactInput): Promise<GhlContact>;
  updateContact(input: UpdateContactInput): Promise<GhlContact>;
  upsertContact(input: UpsertContactInput): Promise<{ contact: GhlContact; isNew: boolean }>;
  deleteContact(contactId: string): Promise<{ success: true }>;
  addContactTag(input: ContactTagInput): Promise<{ tags: string[] }>;
  removeContactTag(input: ContactTagInput): Promise<{ tags: string[] }>;

  // Opportunities
  getOpportunity(opportunityId: string): Promise<GhlOpportunity>;
  searchOpportunities(input: SearchOpportunitiesInput): Promise<GhlOpportunity[]>;
  createOpportunity(input: CreateOpportunityInput): Promise<GhlOpportunity>;
  updateOpportunity(input: UpdateOpportunityInput): Promise<GhlOpportunity>;
  deleteOpportunity(opportunityId: string): Promise<{ success: true }>;

  // Pipelines (read-only)
  listPipelines(): Promise<GhlPipeline[]>;

  // Tasks
  listTasks(contactId: string): Promise<GhlTask[]>;
  getTask(contactId: string, taskId: string): Promise<GhlTask>;
  createTask(input: CreateTaskInput): Promise<GhlTask>;
  updateTask(input: UpdateTaskInput): Promise<GhlTask>;
  deleteTask(contactId: string, taskId: string): Promise<{ success: true }>;

  // Notes
  addNote(input: AddNoteInput): Promise<GhlNote>;

  // Custom fields
  listCustomFields(): Promise<GhlCustomField[]>;
  createCustomField(input: CreateCustomFieldInput): Promise<GhlCustomField>;
  updateCustomField(input: UpdateCustomFieldInput): Promise<GhlCustomField>;
  deleteCustomField(customFieldId: string): Promise<{ success: true }>;

  // Conversations
  searchConversations(contactId?: string): Promise<GhlConversation[]>;
  getConversation(conversationId: string): Promise<GhlConversation>;
  sendMessage(input: SendMessageInput): Promise<{ messageId: string }>;

  // Calendars
  listCalendars(): Promise<GhlCalendar[]>;
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
