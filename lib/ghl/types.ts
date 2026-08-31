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
  assignedTo?: string;
}

export interface GhlUser {
  id: string;
  name: string;
  email?: string;
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

export interface GhlAppointment {
  id: string;
  calendarId: string;
  contactId: string;
  title?: string;
  startTime?: string;
  endTime?: string;
  appointmentStatus?: "confirmed" | "cancelled" | "showed" | "noshow" | "invalid";
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

export interface AssignLeadInput {
  contactId: string;
  /** Real GoHighLevel user ID. Resolved from assignedToNameHint upstream if needed. */
  assignedToUserId: string;
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
  /** Verified live: GET /opportunities/search?pipeline_id=... filters correctly. */
  pipelineId?: string;
}

// ── Pipelines ───────────────────────────────────────────────────────────
export interface CreatePipelineInput {
  name: string;
  stages: Array<{ name: string }>;
}

/**
 * `stages` is REQUIRED here, always the FULL desired stage list — not a
 * partial patch. GoHighLevel's PUT replaces the pipeline's stages wholesale
 * and throws `Cannot read properties of undefined (reading 'map')` if
 * `stages` is omitted (confirmed live). Adding/renaming/removing a single
 * stage means fetching the current pipeline, computing the full new array,
 * and sending that — see lib/orchestration/resolvers.ts's
 * resolvePipelineMutation, which is the only place that does this merge.
 * This client method never merges on its own; it sends exactly what it's given.
 */
export interface UpdatePipelineInput {
  pipelineId: string;
  name: string;
  stages: Array<{ id?: string; name: string; position: number }>;
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
/**
 * GoHighLevel's real POST /conversations/messages contract differs by
 * type (confirmed live): SMS takes the body in `message`; Email requires
 * `html` (not `message`) plus `subject` — sending `message` for an Email
 * type returns 422 CONVERSATIONS_MSG_NO_CONTENT even though the same
 * field works fine for SMS. `message` here is the human-readable body
 * either way; the client maps it to the right GHL field per `type`.
 */
export interface SendMessageInput {
  contactId: string;
  message: string;
  type?: "SMS" | "Email";
  /** Required by GHL for type "Email"; ignored for SMS. */
  subject?: string;
}

// ── Calendars / appointments ───────────────────────────────────────────
export interface CreateCalendarInput {
  name: string;
}

/**
 * `ignoreFreeSlotValidation` is required (verified live) unless the target
 * calendar has real open hours configured in GoHighLevel — otherwise every
 * slot is rejected with "The slot you have selected is no longer
 * available", even for a calendar with zero existing bookings. Defaults to
 * false here: this app should not silently bypass a calendar's real
 * business hours. When a request errors with that exact message, the
 * caller (or the person reading the error) knows to either configure open
 * hours for that calendar in GHL, or explicitly ask for the override.
 */
export interface CreateAppointmentInput {
  calendarId: string;
  contactId: string;
  startTime: string;
  endTime: string;
  title?: string;
  ignoreFreeSlotValidation?: boolean;
}

export interface UpdateAppointmentInput {
  appointmentId: string;
  startTime?: string;
  endTime?: string;
  title?: string;
  appointmentStatus?: "confirmed" | "cancelled" | "showed" | "noshow" | "invalid";
  ignoreFreeSlotValidation?: boolean;
}

export interface SearchAppointmentsInput {
  calendarId: string;
  /** Epoch milliseconds — GHL's real /calendars/events contract, verified live. */
  startTime: number;
  endTime: number;
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
  assignLead(input: AssignLeadInput): Promise<GhlContact>;
  /** Requires the "Users" scope on this location's Private Integration Token. */
  listUsers(): Promise<GhlUser[]>;

  // Opportunities
  getOpportunity(opportunityId: string): Promise<GhlOpportunity>;
  searchOpportunities(input: SearchOpportunitiesInput): Promise<GhlOpportunity[]>;
  createOpportunity(input: CreateOpportunityInput): Promise<GhlOpportunity>;
  updateOpportunity(input: UpdateOpportunityInput): Promise<GhlOpportunity>;
  deleteOpportunity(opportunityId: string): Promise<{ success: true }>;

  // Pipelines
  listPipelines(): Promise<GhlPipeline[]>;
  getPipeline(pipelineId: string): Promise<GhlPipeline>;
  createPipeline(input: CreatePipelineInput): Promise<GhlPipeline>;
  updatePipeline(input: UpdatePipelineInput): Promise<GhlPipeline>;
  deletePipeline(pipelineId: string): Promise<{ success: true }>;

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
  createCalendar(input: CreateCalendarInput): Promise<GhlCalendar>;
  deleteCalendar(calendarId: string): Promise<{ success: true }>;

  // Appointments
  getAppointment(appointmentId: string): Promise<GhlAppointment>;
  searchAppointments(input: SearchAppointmentsInput): Promise<GhlAppointment[]>;
  createAppointment(input: CreateAppointmentInput): Promise<GhlAppointment>;
  updateAppointment(input: UpdateAppointmentInput): Promise<GhlAppointment>;
  deleteAppointment(appointmentId: string): Promise<{ success: true }>;
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
