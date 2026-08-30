# AI Operations Command Center

A full-stack, agentic operations platform: type a natural-language
instruction (or upload a CSV/PDF/Markdown file), an AI reasoning layer
(OpenClaw, with a deterministic mock fallback) turns it into a plan of
actions from a fixed, controlled registry, a deterministic workflow layer
(n8n) executes it against a real CRM (GoHighLevel), destructive actions
wait for human approval, and every step is recorded in Supabase and shown
live on a Next.js dashboard.

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the full system design.

## Status

**Live and verified end to end**, including real writes and real deletes,
against this project's own GoHighLevel sub-account, its own n8n Cloud
account, and its own Supabase project — not shared with any other project.
Supabase, GoHighLevel, and n8n are all real and connected
(`GHL_ADAPTER=real`, `N8N_ADAPTER=http`). OpenClaw's real adapter is wired
in (`AGENT_ADAPTER=openclaw`); the connected Google Cloud project behind it
currently has an exhausted free-tier Gemini quota (a billing/quota issue on
that account, not a code problem — see
[Troubleshooting](#troubleshooting)), so live requests through it
intermittently 429 until billing is enabled there. Every part of the
pipeline downstream of "the agent understood the request" (allowlist
check, reference resolution, n8n dispatch, GoHighLevel execution,
confirmation gating, Supabase audit logging) has been verified live with
real API calls — see the per-action registry table below for exactly
what's real vs. blocked and why.

## What it does

Type a request like:

> "Move Olivia Bennett's opportunity to AI Qualified and add the hot-lead tag."

or upload a CSV of leads, a Markdown runbook, or a PDF of instructions, and
the system:

1. Records the request in Supabase (`automation_requests`).
2. **Text**: asks the agent adapter to interpret it into a plan — intent
   plus a list of proposed actions, each restricted to the **controlled
   action registry** (`lib/actions/allowlist.ts` + `lib/actions/registry.ts`).
   **File**: parses the file into the exact same kind of action plan —
   CSV rows map to actions deterministically (no AI call needed for
   structured data); PDF/Markdown instruction lines are run through the
   *same* agent adapter as a typed command, one line at a time. Either
   way, from this point on text and file input converge onto one code
   path — there is no separate "file business logic."
3. Re-validates every proposed action against the allowlist server-side,
   independent of whatever the agent/parser already filtered.
4. Resolves every name/email/pipeline-name hint (e.g. "Olivia Bennett",
   "AI Qualified") into a real GoHighLevel ID via live lookups
   (`lib/orchestration/resolvers.ts`) — **never invents an ID**. If a
   contact, opportunity, or pipeline stage doesn't actually exist (or is
   ambiguous), the request fails with a specific, actionable error instead
   of guessing.
5. **If any proposed action is destructive** (a delete, or sending a real
   message) **and the caller hasn't confirmed**, execution stops there —
   the request is left `awaiting_confirmation` with the full plan visible,
   and nothing has touched GoHighLevel yet. The dashboard shows an
   Approve/Cancel prompt; approving resubmits with `confirm:true`.
6. Dispatches each validated, resolved action to n8n, which executes the
   exact GoHighLevel HTTP request the backend built for it (n8n never
   decides *what* to call — see [n8n design](#n8n) below) and returns the
   real result.
7. Logs every execution (`execution_logs`) and updates each action's and
   the request's status in Supabase — success or failure, always.
8. Returns a structured result the dashboard renders live, with a
   per-action breakdown for multi-action and batch (file) requests.

## Architecture

```
USER
  → NEXT.JS DASHBOARD (text box, or CSV/PDF/MD upload)
  → NEXT.JS API ROUTES (validate, persist, orchestrate)
  → AGENT ADAPTER — OpenClaw or mock (THINK: intent + proposed actions)
      · CSV rows skip this step — mapped to actions deterministically
      · PDF/Markdown lines are run through this same step, per line
  → ALLOWLIST CHECK (server-side, independent of the agent/parser)
  → REFERENCE RESOLUTION (name/email/stage-name → real GHL IDs, or a clear error)
  → DESTRUCTIVE-ACTION CONFIRMATION GATE (human approval required)
  → ACTION REGISTRY (lib/actions/registry.ts) builds the exact GHL request
  → N8N ADAPTER — real n8n webhooks or mock (DO: execute exactly that request)
  → GOHIGHLEVEL API (contacts / opportunities / pipelines / tasks / notes / custom fields / conversations / calendars)
  → SUPABASE (automation_requests, automation_actions, execution_logs, contacts_cache, agents, integrations)
  → STRUCTURED RESULT → DASHBOARD
```

- **The agent (THINK)** decides *what* should happen. It can only ever
  select one of the registered action labels — never a raw API call — so
  it cannot execute arbitrary requests, by construction.
- **The action registry** (`lib/actions/registry.ts`) is the *only* place
  that turns an action label into a real GoHighLevel HTTP request
  (method + path + body). Neither the agent nor a parsed file ever
  constructs one directly.
- **n8n (DO)** executes that exact request and nothing else, then logs it.
  Each of the three GHL-facing workflows contains one generic,
  credentialed "GHL API Call" HTTP node driven entirely by what the
  backend sends it — see [n8n design](#n8n).
- **GoHighLevel** is the external CRM. Its credentials live only in the
  GHL adapter (server-side) or, in the real n8n deployment, in n8n's own
  credential store — never in the agent layer, never in the browser.
- **Supabase** is the audit/state layer: every request, action, and
  execution is recorded, queryable, and shown in the dashboard.
- **Next.js** is both the dashboard and the backend; it never exposes any
  of the above credentials to the browser.

## Tech stack

Next.js (App Router) · React · TypeScript · Tailwind CSS · OpenClaw · n8n ·
Supabase/PostgreSQL · GoHighLevel API v2 · Zod · pdf-parse · Vercel

## Commands you can give it

These are natural-language examples — phrasing can vary; the agent (or the
deterministic mock parser in dev mode) maps intent to one of the actions
below. Multi-action requests in one sentence are supported ("find X, move
their opportunity, and add a tag" becomes three actions).

| You say... | Maps to |
|---|---|
| "Find Rahul Sharma" / "Search contacts for rahul@example.com" | `SEARCH_CONTACTS` |
| "Show me Olivia Bennett's contact details" | `GET_CONTACT` |
| "Create a contact named Rahul Sharma, email rahul@example.com, phone +91..." | `CREATE_CONTACT` |
| "Update Rahul's email to rahul@newdomain.com" | `UPDATE_CONTACT` |
| "Add or update a contact for this email/phone" (bulk-import style) | `UPSERT_CONTACT` |
| "Delete the contact Rahul Sharma" *(asks for confirmation first)* | `DELETE_CONTACT` |
| "Add the hot-lead tag to Rahul" | `ADD_CONTACT_TAG` |
| "Remove the cold tag from Rahul" | `REMOVE_CONTACT_TAG` |
| "Assign Rahul to the Sales Team" *(needs GHL Users scope to resolve a team/user by name — provide a real user ID instead if that scope isn't granted)* | `ASSIGN_LEAD` |
| "Show today's new opportunities" / "Find opportunities for Rahul" | `SEARCH_OPPORTUNITIES` |
| "Create an opportunity for Rahul worth 50000 in Solar Leads" | `CREATE_OPPORTUNITY` |
| "Move Rahul's opportunity to Qualified" / "Update Greg's opportunity to Won" | `UPDATE_OPPORTUNITY` |
| "Delete Rahul's opportunity" *(confirmation required)* | `DELETE_OPPORTUNITY` |
| "List all pipelines" / "What stages does Solar Leads have?" | `LIST_PIPELINES` |
| "List Rahul's tasks" | `LIST_TASKS` |
| "Create a follow-up task for Rahul tomorrow at 10am" | `CREATE_TASK` |
| "Mark that task as done" / "Update the task due date" | `UPDATE_TASK` |
| "Delete that task" *(confirmation required)* | `DELETE_TASK` |
| "Add a note to Rahul's record: called, left voicemail" | `ADD_NOTE` |
| "List custom fields" | `LIST_CUSTOM_FIELDS` |
| "Create a custom field called Lead Source" | `CREATE_CUSTOM_FIELD` |
| "Rename the custom field ..." | `UPDATE_CUSTOM_FIELD` |
| "Delete the custom field ..." *(confirmation required)* | `DELETE_CUSTOM_FIELD` |
| "Find my conversation with Rahul" | `SEARCH_CONVERSATIONS` / `GET_CONVERSATION` |
| "Send Rahul a text saying..." *(confirmation required — real message)* | `SEND_MESSAGE` |
| "List calendars" | `LIST_CALENDARS` |
| "Create a new pipeline called Solar Leads with stages New Lead, Contacted, Qualified, Proposal, Won" | `CREATE_PIPELINE` |
| "Rename the Solar Leads pipeline to Solar Deals" | `UPDATE_PIPELINE` |
| "Delete the Solar Leads pipeline" *(confirmation required)* | `DELETE_PIPELINE` |
| "Add a Proposal Sent stage to Solar Leads" | `CREATE_PIPELINE_STAGE` |
| "Rename the Qualified stage to Hot Lead" | `UPDATE_PIPELINE_STAGE` |
| "Remove the Contacted stage from Solar Leads" *(confirmation required)* | `DELETE_PIPELINE_STAGE` |

**Not supported**: scheduling appointments — this GoHighLevel location has
no calendar configured yet (see the registry table below).

## Controlled action registry

Every action the agent (or a file plan) can ever propose is defined in
[`lib/actions/allowlist.ts`](./lib/actions/allowlist.ts) (the list itself
and its confirmation tier) and
[`lib/actions/registry.ts`](./lib/actions/registry.ts) (the exact
GoHighLevel HTTP request it maps to). Nothing outside that list can ever
be executed — not by the agent, not by a parsed file, not by a malformed
request. See [`lib/ghl/client.ts`](./lib/ghl/client.ts)'s doc comment for
exactly how each endpoint below was verified live before being wired in.

| Action | Tier | Status |
|---|---|---|
| `SEARCH_CONTACTS`, `GET_CONTACT` | read-only | ✅ live-verified |
| `CREATE_CONTACT`, `UPDATE_CONTACT`, `UPSERT_CONTACT` | mutating | ✅ live-verified |
| `DELETE_CONTACT` | **destructive — needs confirm** | ✅ live-verified |
| `ADD_CONTACT_TAG`, `REMOVE_CONTACT_TAG` | mutating | ✅ live-verified |
| `ASSIGN_LEAD` | mutating | ⚠️ **partially verified** — assigning by a real, already-known GoHighLevel user ID reaches the real API (confirmed live: a fake-but-real-shaped ID returns GHL's own 404, proving the request lands correctly); resolving a user by *name* is blocked because this PIT lacks the "Users" scope — see [GHL scopes](#ghl-scopes) |
| `SEARCH_OPPORTUNITIES`, `GET_OPPORTUNITY` | read-only | ✅ live-verified |
| `CREATE_OPPORTUNITY`, `UPDATE_OPPORTUNITY` | mutating | ✅ live-verified |
| `DELETE_OPPORTUNITY` | **destructive — needs confirm** | ✅ live-verified |
| `LIST_PIPELINES` | read-only | ✅ live-verified |
| `CREATE_PIPELINE` | mutating | ✅ live-verified |
| `UPDATE_PIPELINE`, `CREATE_PIPELINE_STAGE`, `UPDATE_PIPELINE_STAGE` | mutating | ✅ live-verified (create → rename pipeline → add/rename stage → delete round-trip) |
| `DELETE_PIPELINE`, `DELETE_PIPELINE_STAGE` | **destructive — needs confirm** | ✅ live-verified |
| `LIST_TASKS`, `GET_TASK` | read-only | ✅ live-verified |
| `CREATE_TASK`, `UPDATE_TASK` | mutating | ✅ live-verified |
| `DELETE_TASK` | **destructive — needs confirm** | ✅ live-verified |
| `ADD_NOTE` | mutating | ✅ live-verified |
| `LIST_CUSTOM_FIELDS`, `CREATE_CUSTOM_FIELD`, `UPDATE_CUSTOM_FIELD` | mutating/read | ✅ live-verified |
| `DELETE_CUSTOM_FIELD` | **destructive — needs confirm** | ✅ live-verified |
| `SEARCH_CONVERSATIONS`, `GET_CONVERSATION` | read-only | ✅ live-verified (real conversation data returned) |
| `SEND_MESSAGE` | **destructive — needs confirm** | ⚠️ implemented per GHL's documented contract, deliberately **not** live-fired during development (it sends a real SMS/email) — smoke-test against a consenting contact before relying on it |
| `LIST_CALENDARS` | read-only | ✅ live-verified (this location has no calendar configured yet, so the list is empty) |
| `CHECK_AVAILABILITY` / `CREATE_APPOINTMENT` / `CANCEL_APPOINTMENT` | — | ❌ **not implemented** — this location has zero calendars configured, so there's nothing to schedule against yet. Create a calendar in GoHighLevel (Settings → Calendars) and this is a natural next addition. |

## GHL scopes

This app uses a single GoHighLevel Private Integration Token (never the
OAuth/marketplace flow), scoped to **least privilege for what's actually
implemented**:

| Scope | Why | Used by |
|---|---|---|
| Contacts (read/write) | search, create, update, delete, tag contacts | all `*_CONTACT` actions |
| Opportunities (read/write) | search, create, update, delete opportunities | all `*_OPPORTUNITY` actions |
| Pipelines (read/write) | list, create, rename, delete pipelines and stages | `LIST_PIPELINES`, all `*_PIPELINE*` actions |
| Tasks (read/write) | list/create/update/delete follow-up tasks | all `*_TASK` actions |
| Notes (write) | add notes to a contact | `ADD_NOTE` |
| Custom Fields (read/write) | list/create/update/delete custom fields | all `*_CUSTOM_FIELD` actions |
| Conversations (read, message write) | search conversations, send messages | `SEARCH_CONVERSATIONS`, `GET_CONVERSATION`, `SEND_MESSAGE` |
| Users (**not granted**) | resolve a user/team name (e.g. "Sales Team") to a real user ID for `ASSIGN_LEAD` | `ASSIGN_LEAD` by name — assigning by a known user ID works without this scope |
| Calendars (read) | list calendars | `LIST_CALENDARS` |

Pipeline write access was granted after initial development and
re-verified live (create → rename + add a stage → delete round-trip
against a real, throwaway test pipeline) — see [`lib/ghl/client.ts`](./lib/ghl/client.ts)
for the one real API quirk found doing that: `PUT
/opportunities/pipelines/:id` requires the **full** `stages` array on
every call, so adding/renaming/removing one stage means fetching the
current pipeline and sending the complete merged list back (never a
partial patch) — see `lib/orchestration/resolvers.ts`'s
`resolvePipelineMutation`.

**Never** the Bearer Auth credential from a different project — this app
uses its own dedicated `Header Auth account 2` credential in n8n and its
own `GHL_PRIVATE_INTEGRATION_TOKEN` in `.env.local`, scoped to this
project's GHL sub-account only.

## File upload (CSV / PDF / Markdown)

Upload a file from the dashboard's "Upload a file" panel. The flow is
always **upload → parse (no execution) → review → approve → execute**:
nothing from an uploaded file ever runs without an explicit click.

- **CSV** (`lib/files/csv.ts`) — parsed with a small dependency-free
  RFC4180 parser, no AI call needed. Recognized columns (case-insensitive,
  any order): `Name`/`FirstName`/`LastName`, `Email`, `Phone`, `Company`,
  `Action`, `Stage`, `Pipeline`, `Tags`, `TaskTitle`, `TaskDueDate`,
  `Note`. An `Action` column of "Create Contact" (or blank) maps to
  `UPSERT_CONTACT`; "Update Opportunity" needs a `Stage`; "Add Tag" needs
  `Tags`; "Create Task"/"Follow Up" needs the row's name/email. Invalid
  emails, malformed rows, and duplicate emails are flagged per-row, not
  silently guessed or dropped. See [`test-leads.csv`](./test-leads.csv)
  for a working example.
- **Markdown** (`lib/files/markdown.ts`) — headings are stripped as
  structure (not instructions); each remaining bullet/numbered/plain line
  is run through the *same* agent adapter a typed command uses. See
  [`test-workflow.md`](./test-workflow.md).
- **PDF** (`lib/files/pdf.ts`) — text is extracted with the `pdf-parse`
  package (real extraction, not invented), then processed exactly like
  Markdown lines. Scanned/image-only PDFs correctly report "no extractable
  text" rather than fabricating content. See
  [`test-instructions.pdf`](./test-instructions.pdf).

To limit AI calls on large files (see [Performance](#performance)), PDF/MD
processing is capped at 20 instruction lines per upload; anything beyond
that is reported, not silently dropped. CSV has no such cap since it never
calls the agent — every row is processed.

Large batches execute with a running total; the response always reports
`Total / Successful / Failed`, and any destructive action inside a file
plan pauses the *entire* plan for one confirmation, the same as a typed
command.

## Safety model

Three independent layers, each of which is defense-in-depth against the
others being wrong:

1. **Allowlist** — the agent's tool schema only ever advertises the
   registered actions; the backend re-checks every proposed action against
   the same list regardless.
2. **Reference resolution** — a name/email/stage-name hint is resolved
   against live GoHighLevel data; an ambiguous or non-existent match is a
   hard error, never a guess.
3. **Confirmation gate** — `MUTATION_TIER` in `lib/actions/allowlist.ts`
   marks every delete and `SEND_MESSAGE` as `"destructive"`.
   `lib/orchestration/execute.ts` refuses to dispatch any destructive
   action without an explicit `confirm:true`, leaving the request
   `awaiting_confirmation` with the full plan visible first.

## Project structure

```
app/
  page.tsx                    dashboard (client component)
  components/                  Dashboard, StatsRow, StatusBadge
  api/
    execute/                   POST — run a text command through the full pipeline
    files/parse/                POST — parse an uploaded file into a plan (no execution)
    files/execute/               POST — execute an approved file plan (or resume a confirmation)
    requests/, requests/[id]/   GET — history / single request detail
    execution-logs/              GET — execution log stream, optional ?requestId=
    agents/, agents/[id]/       GET+POST / PATCH — agent registry
    integrations/, integrations/[id]/  GET+POST / PATCH — integration registry
    contacts/                    GET+POST — contacts_cache read/upsert
lib/
  actions/
    allowlist.ts                the full action registry — single source of truth + confirmation tiers
    registry.ts                  action -> real GoHighLevel HTTP request (method/path/body)
  agent/                        AgentAdapter: openclaw-adapter.ts (real), mock-adapter.ts
  n8n/                          N8nClient: client.ts (real HTTP + mock), validation.ts
  ghl/                          GhlClient: client.ts (real HTTP + mock), types.ts
  files/                        csv.ts, pdf.ts, markdown.ts, text-plan.ts, parse.ts — file upload pipeline
  http/fetch-with-retry.ts      shared timeout + bounded-retry fetch wrapper
  orchestration/
    execute.ts                   THINK → allowlist → resolve → confirm → DO pipeline (text and file share this)
    resolvers.ts                  name/email/stage-name → real GHL ID, never invented
  supabase/                     server.ts, browser.ts, types.ts, queries/
  types/domain.ts               shared application types
supabase/migrations/            SQL schema, in the order they'd be applied
n8n/workflows/                   importable n8n workflow JSON + setup guide
test/                             node:test suite (mock pipeline + action registry)
test-leads.csv, test-workflow.md, test-instructions.pdf   interview-demo file-upload samples
```

## n8n

Three GoHighLevel-facing workflows (`ghl-contact-workflow`,
`ghl-opportunity-workflow`, `ghl-task-workflow`) plus one shared
`execution-logger-workflow`, all live in this project's own n8n Cloud
account. Rather than one branch per action type (which would mean editing
n8n every time a new action is added), each workflow contains:

```
Webhook (shared-secret header auth)
  → Validate Input (Code node: checks required fields + that this workflow
     owns this actionType — a defense-in-depth check, not the only one)
  → GHL API Call (one generic HTTP Request node: method/url/body all come
     from `ghlRequest`, which the Next.js backend already built via
     lib/actions/registry.ts — n8n never decides *what* to call)
  → Log Execution (writes to Supabase execution_logs; a logging failure
     does NOT swallow a successful GHL response — verified live)
  → Respond to Webhook (always HTTP 200; failure is signaled via the JSON
     body's own `ok:false`, since n8n Cloud's edge proxy replaces non-2xx
     bodies with a generic error page)
```

This design means adding a new action type (say, a future
`CREATE_APPOINTMENT`) only ever requires a new case in
`lib/actions/registry.ts`'s `buildGhlRequest()` and a line in `Validate
Input`'s allowed-action list — never a new workflow, never a new branch of
hardcoded HTTP nodes. See [`n8n/workflows/README.md`](./n8n/workflows/README.md).

A fifth workflow, `Lead Qualification & CRM Sync`, already exists in the
same n8n account from earlier work (AI lead scoring + GHL sync) — it is
unrelated to this action-registry architecture and untouched by this
project.

## Local development

Requires Node.js 20.9+ (developed against Node 24).

```bash
npm install
cp .env.example .env.local   # then fill in real values — see below
npm run dev
```

Runs at `http://localhost:3000`. With every `*_ADAPTER` left at its
default (`mock`), the full pipeline — including file upload — runs
without any external account except Supabase (the persistence layer
itself; see [Supabase setup](#supabase)).

## Environment variables

See [`.env.example`](./.env.example) for the full list with inline
explanations. No new variables were introduced by the expanded action
registry or file upload feature — everything reuses the existing GHL/n8n/
Supabase/OpenClaw configuration.

## Setup guides

### Supabase

Five migrations, applied in filename order to a live project — the
newest, `20260830213449_expand_action_registry_and_confirmation_status.sql`,
widens `automation_requests.status` to include `awaiting_confirmation` and
`automation_actions.action_type` to the full 28-action registry (destructive
actions are valid rows here now — they're gated by the confirmation flow,
not excluded from the schema).

### GoHighLevel

`GHL_ADAPTER=real`, connected with a Private Integration Token scoped to
this project's own sub-account (never reused from another project). See
[GHL scopes](#ghl-scopes) above for exactly what's granted vs. missing.

### n8n

`N8N_ADAPTER=http`, connected to this project's own n8n Cloud account. See
[n8n](#n8n) above for the generic-executor design.

### OpenClaw

`AGENT_ADAPTER=openclaw`, pointed at a real OpenClaw Gateway (local, or a
Tailscale-funneled URL for a deployed environment). See
[Troubleshooting](#troubleshooting) for the current Gemini-quota caveat.
Falls back to `AGENT_ADAPTER=mock` — a deterministic, regex-based
interpreter (`lib/agent/mock-adapter.ts`) — with no code changes needed
elsewhere; the file-upload PDF/Markdown paths use whichever adapter is
configured, same as a typed command.

## Testing

```bash
npm run typecheck   # TypeScript strict-mode check
npm run lint        # ESLint (Next.js core-web-vitals + TypeScript rules)
npm run build       # production build
npm test            # node:test suite — mock pipeline + action registry
```

`npm test` (18 tests) requires no external credentials and exercises real
application code: the mock agent/n8n/GHL pipeline, the reference resolvers
(contact/opportunity/pipeline-stage resolution, including ambiguous- and
no-match error cases), and that every registered action has a working
GHL-request builder and a defined confirmation tier. Everything requiring
live credentials (`RealGhlClient`, the real n8n workflows, OpenClaw) has
additionally been verified with real API calls during development —
including full create → read → delete round-trips against real
GoHighLevel data and the live confirmation-gate flow (a real contact was
created, blocked from deletion pending confirmation, confirmed, and
verified actually deleted).

## What's mocked vs. actually connected

| Layer | Status |
|---|---|
| Supabase | **Real, connected, verified.** No mock exists — it's the persistence layer itself. |
| GoHighLevel | **Real, connected, verified** — including writes and deletes, live-tested during this build. |
| n8n | **Real, connected, verified** — all three GHL-facing workflows converted to a generic executor and live-tested end to end (including surfacing and fixing a real audit-log-failure-swallows-response bug found during testing). |
| OpenClaw | **Wired in, real adapter** (`AGENT_ADAPTER=openclaw`) — blocked intermittently by the connected Google Cloud project's exhausted free Gemini quota (see Troubleshooting), not a code issue. `AGENT_ADAPTER=mock` is a clean, honest fallback for demoing without live LLM reasoning. |

## Deployment

Deploy to Vercel: connect the GitHub repository, set every environment
variable from `.env.example` (with real values) in the Vercel project's
Environment Variables settings, and deploy. No build-time secrets are
required (all env access is lazy, inside request handlers).

## Security considerations

- GoHighLevel/n8n/Supabase credentials live only in server-side adapters
  (guarded by the `server-only` package) or n8n's own credential store —
  never in the browser, never committed.
- Every `*_ADAPTER` defaults to mock; reaching a real external system
  requires an explicit opt-in value, not just a present credential.
- The agent's (and a parsed file's) reachable action set is enforced in
  the tool schema, a server-side re-check, and the database's own CHECK
  constraint — three independent layers.
- Neither the agent nor a parsed file can ever construct a raw API
  request — only `lib/actions/registry.ts` does that, from a fixed
  allowlist of action labels.
- Uploaded files are treated strictly as data/instructions: CSV rows are
  parsed into fixed struct fields (never `eval`'d); PDF/Markdown text is
  only ever passed to the agent as a natural-language string, the same as
  a typed command — never interpreted as code. File size is capped at 5MB
  and type-checked by extension/MIME before parsing.
- Destructive actions (deletes, `SEND_MESSAGE`) always require an explicit
  confirmation step, whether proposed by text or by a file plan.
- Real HTTP adapters use a shared fetch wrapper with a hard timeout and
  one bounded retry on 5xx/network failure — never on 4xx.
- `.env.example` contains placeholders only.

## Performance

- Structured data (CSV) is parsed programmatically — zero AI calls per
  row. AI reasoning is only used where natural-language interpretation is
  actually needed (a typed command, or a PDF/Markdown instruction line).
- PDF/Markdown file processing is capped at 20 instruction lines per
  upload to avoid firing an unbounded number of LLM calls from one file;
  the cap is reported to the user, never silently applied.
- File-plan execution dispatches actions sequentially with a running
  total, rather than firing every row as a single uncontrolled burst.

## Interview demo (5–10 minutes)

1. **"Move Olivia Bennett's opportunity to AI Qualified."** — shows
   text → agent → resolved contact/opportunity/stage → real n8n → real
   GHL update → Supabase audit log, live in the dashboard.
2. **"Create a follow-up task for Olivia tomorrow."** — a second,
   independent action against the same resolved contact.
3. **"Create a new pipeline called Solar Leads with stages New Lead,
   Contacted, Qualified, Proposal and Won."** — shows a real pipeline
   created live in GoHighLevel with all five stages, then **"List all
   pipelines"** to show it's really there.
4. Upload **`test-leads.csv`** — shows the file → parse → review screen
   (per-row status, duplicate-email warning) → Approve & Execute → real
   batch result (`Total/Successful/Failed`).
5. Upload **`test-workflow.md`** — shows a Markdown runbook converging on
   the same action plan a typed command would produce.
6. **Multi-action + confirmation**: ask it to delete a test contact —
   shows the `awaiting_confirmation` gate blocking execution, then approve
   it and show the contact is actually gone in GoHighLevel.

## Troubleshooting

- **OpenClaw requests fail with a 429 / "rate_limit_error" /
  RESOURCE_EXHAUSTED** — the connected Google Cloud project's free-tier
  Gemini quota is exhausted. This is an account/billing issue on that GCP
  project, not a bug: enable billing there, or use `AGENT_ADAPTER=mock`
  for a fully-functional demo without live LLM reasoning.
- **"No allowed action was matched for this request"** — with
  `AGENT_ADAPTER=mock`, try phrasing the operation and target explicitly
  ("move X's opportunity to Y", "add the Z tag to X"); the mock parser is
  a small deterministic fallback, not full NLU (OpenClaw handles broader
  phrasing).
- **A destructive action seems "stuck"** — it's not stuck, it's
  `awaiting_confirmation`. Approve or cancel it from the dashboard, or
  `POST /api/execute` with `{ "confirmRequestId": "...", "confirm": true }`.
- **"No pipeline stage found matching ..."** — the named stage doesn't
  exist in any pipeline this token can read; the error lists the real
  available stages. Nothing is ever silently created.
- **Creating/renaming/deleting a pipeline fails with "not authorized for
  this scope"** — expected; see [GHL scopes](#ghl-scopes) for how to grant
  pipeline write access.
- **A PDF upload reports "no extractable text was found"** — the PDF is
  scanned images rather than real text; `pdf-parse` can only read text
  that's actually embedded in the file.
- **n8n workflow returns a generic error page instead of JSON** — check
  the Header Auth credential's value matches `N8N_WEBHOOK_SECRET`, and
  that `Version` header on the GHL API Call node is still `2021-07-28`.
