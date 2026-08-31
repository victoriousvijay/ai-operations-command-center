"use client";

import { useCallback, useEffect, useState } from "react";
import type { Agent, AutomationAction, AutomationRequest, ExecutionLog, Integration } from "@/lib/types/domain";
import { StatsRow } from "./StatsRow";
import { StatusBadge } from "./StatusBadge";

type RequestWithActions = AutomationRequest & { actions: AutomationAction[] };

interface ExecuteResponse {
  ok: boolean;
  requestId?: string;
  status?: string;
  intent?: string | null;
  actions?: Array<{ type: string; status: string; error?: string; payload?: Record<string, unknown> }>;
  confirmRequestId?: string;
  error?: { type: string; message: string };
}

interface PlannedActionView {
  source: number;
  type: string | null;
  payload: Record<string, unknown>;
  status: "ready" | "warning" | "error";
  target: string;
  message?: string;
}

interface CommandSuggestionView {
  label: string;
  type: string;
  payload: Record<string, unknown>;
}

interface SuggestResponse {
  ok: boolean;
  suggestions?: CommandSuggestionView[];
  error?: { type: string; message: string };
}

interface FileParseResponse {
  ok: boolean;
  fileName?: string;
  sourceType?: string;
  actions?: PlannedActionView[];
  warnings?: string[];
  error?: { type: string; message: string };
}

/**
 * One chat exchange: the user's message plus the assistant's evolving
 * reply. Tracked independently of all others so sending a second message
 * never has to wait for an earlier one to resolve — each runs its own
 * async request and renders its own pair of bubbles.
 *
 * The assistant side of the exchange goes through up to two network
 * calls in sequence — enhance (interpret) then execute (act) — but only
 * ever shows one reply bubble whose content updates as it progresses:
 * "thinking" -> either "awaiting_choice" (ambiguous — pick one) or
 * straight through to "done"/"error" once execution finishes. A failure
 * at any point renders as "This action can't be done — <reason>", never
 * a raw stack trace or HTTP status.
 */
interface Submission {
  id: string;
  requestText: string;
  status: "thinking" | "awaiting_choice" | "awaiting_confirmation" | "done" | "error";
  suggestions?: CommandSuggestionView[];
  botError?: string;
  result?: ExecuteResponse;
  confirming?: boolean;
  selecting?: boolean;
}

let submissionCounter = 0;
function nextSubmissionId(): string {
  submissionCounter += 1;
  return `sub-${submissionCounter}`;
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const RUNNING_STATUSES = new Set(["received", "interpreting", "executing"]);

/**
 * Pulls the real GoHighLevel resource ID out of an action's stored API
 * response, when there is one — proof this was a genuine confirmed
 * execution (a real contact/task/opportunity/etc ID from GHL), not a
 * fabricated success. Returns null for read-only actions or when the
 * response shape doesn't carry a single obvious resource.
 */
function extractResourceId(response: Record<string, unknown> | null): { label: string; id: string } | null {
  if (!response) return null;
  const shapes: Array<[string, string]> = [
    ["contact", "Contact"],
    ["task", "Task"],
    ["opportunity", "Opportunity"],
    ["pipeline", "Pipeline"],
    ["note", "Note"],
    ["customField", "Custom Field"],
    ["conversation", "Conversation"],
  ];
  for (const [key, label] of shapes) {
    const value = response[key];
    if (value && typeof value === "object" && "id" in value && typeof (value as { id: unknown }).id === "string") {
      return { label, id: (value as { id: string }).id };
    }
  }
  if (typeof response.messageId === "string") return { label: "Message", id: response.messageId };
  return null;
}

export function Dashboard() {
  const [requests, setRequests] = useState<RequestWithActions[] | null>(null);
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [integrations, setIntegrations] = useState<Integration[] | null>(null);
  const [logs, setLogs] = useState<ExecutionLog[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [userRequest, setUserRequest] = useState("");
  const [contactIdOverride, setContactIdOverride] = useState("");
  const [submissions, setSubmissions] = useState<Submission[]>([]);

  function patchSubmission(id: string, patch: Partial<Submission>) {
    setSubmissions((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [filePlan, setFilePlan] = useState<FileParseResponse | null>(null);
  const [fileExecuting, setFileExecuting] = useState(false);
  const [fileResult, setFileResult] = useState<ExecuteResponse | null>(null);

  const loadDashboardData = useCallback(async () => {
    try {
      const [requestsRes, agentsRes, integrationsRes, logsRes] = await Promise.all([
        fetch("/api/requests"),
        fetch("/api/agents"),
        fetch("/api/integrations"),
        fetch("/api/execution-logs"),
      ]);
      const [requestsJson, agentsJson, integrationsJson, logsJson] = await Promise.all([
        requestsRes.json(),
        agentsRes.json(),
        integrationsRes.json(),
        logsRes.json(),
      ]);

      if (!requestsJson.ok) throw new Error(requestsJson.error?.message ?? "Failed to load requests.");
      if (!agentsJson.ok) throw new Error(agentsJson.error?.message ?? "Failed to load agents.");
      if (!integrationsJson.ok)
        throw new Error(integrationsJson.error?.message ?? "Failed to load integrations.");
      if (!logsJson.ok) throw new Error(logsJson.error?.message ?? "Failed to load execution logs.");

      setRequests(requestsJson.requests);
      setAgents(agentsJson.agents);
      setIntegrations(integrationsJson.integrations);
      setLogs(logsJson.logs);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Failed to load dashboard data.");
    }
  }, []);

  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData]);

  /**
   * Pulls a single, user-facing reason out of a failed/partial
   * ExecuteResponse — this is what renders as "This action can't be
   * done — <reason>" in the chat. Prefers the top-level error (agent
   * couldn't interpret the request, reference resolution failed before
   * anything ran, etc); falls back to the first failed action's own
   * error when the top-level call succeeded but an action inside it didn't.
   */
  function extractFailureReason(result: ExecuteResponse): string {
    if (result.error?.message) return result.error.message;
    const failedAction = result.actions?.find((a) => a.status === "failed" && a.error);
    if (failedAction?.error) return failedAction.error;
    if (result.actions?.length === 0) {
      return "No allowed action was matched for this request. Try naming the operation explicitly (e.g. \"update\", \"create\", \"move ... to ...\") and the person/record it applies to.";
    }
    return "Something went wrong and no specific reason was reported.";
  }

  async function runAction(submissionId: string, type: string, payload: Record<string, unknown>, intent: string) {
    try {
      const response = await fetch("/api/files/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intent,
          actions: [{ type, payload }],
          ...(contactIdOverride.trim() ? { contactIdOverride: contactIdOverride.trim() } : {}),
        }),
      });
      const json = (await response.json()) as ExecuteResponse;
      if (!json.ok) {
        patchSubmission(submissionId, { status: "error", botError: extractFailureReason(json), result: json });
      } else if (json.status === "awaiting_confirmation") {
        patchSubmission(submissionId, { status: "awaiting_confirmation", result: json });
      } else if (json.status === "failed" || json.status === "partial_failure") {
        patchSubmission(submissionId, { status: "error", botError: extractFailureReason(json), result: json });
      } else {
        patchSubmission(submissionId, { status: "done", result: json });
      }
      await loadDashboardData();
    } catch (error) {
      patchSubmission(submissionId, {
        status: "error",
        botError: error instanceof Error ? error.message : "The request failed before reaching the server.",
      });
    }
  }

  /**
   * The chat's one send action: interpret the message (Enhance), then —
   * this is the "automate workflows" part — act on it immediately when
   * there's exactly one clear reading, no extra click required. Only
   * asks the user to pick when the request is genuinely ambiguous (more
   * than one plausible action), and replies "This action can't be done
   * — <reason>" the moment interpretation or execution fails, rather
   * than a raw error.
   */
  function handleSend() {
    const text = userRequest.trim();
    if (!text) return;
    setUserRequest("");
    const id = nextSubmissionId();
    setSubmissions((prev) => [{ id, requestText: text, status: "thinking" }, ...prev]);

    (async () => {
      try {
        const response = await fetch("/api/suggest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userRequest: text }),
        });
        const json = (await response.json()) as SuggestResponse;
        if (!json.ok) {
          patchSubmission(id, { status: "error", botError: json.error?.message ?? "Could not interpret this request." });
          return;
        }
        if (!json.suggestions || json.suggestions.length === 0) {
          patchSubmission(id, {
            status: "error",
            botError: "No matching commands found — try rephrasing, or name the action and person more explicitly.",
          });
          return;
        }
        if (json.suggestions.length === 1) {
          const only = json.suggestions[0]!;
          await runAction(id, only.type, only.payload, text);
        } else {
          patchSubmission(id, { status: "awaiting_choice", suggestions: json.suggestions });
        }
      } catch (error) {
        patchSubmission(id, { status: "error", botError: error instanceof Error ? error.message : "Request failed." });
      }
    })();
  }

  async function handleSelectSuggestion(submission: Submission, suggestion: CommandSuggestionView) {
    if (submission.selecting) return;
    patchSubmission(submission.id, { selecting: true, status: "thinking" });
    await runAction(submission.id, suggestion.type, suggestion.payload, submission.requestText);
    patchSubmission(submission.id, { selecting: false });
  }

  async function handleConfirm(submission: Submission, approve: boolean) {
    if (!submission.result?.confirmRequestId || submission.confirming) return;
    if (!approve) {
      patchSubmission(submission.id, { status: "done", result: undefined });
      return;
    }
    patchSubmission(submission.id, { confirming: true });
    try {
      const response = await fetch("/api/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmRequestId: submission.result.confirmRequestId, confirm: true }),
      });
      const json = (await response.json()) as ExecuteResponse;
      if (!json.ok || json.status === "failed" || json.status === "partial_failure") {
        patchSubmission(submission.id, { confirming: false, status: "error", botError: extractFailureReason(json), result: json });
      } else {
        patchSubmission(submission.id, { confirming: false, status: "done", result: json });
      }
      await loadDashboardData();
    } catch (error) {
      patchSubmission(submission.id, {
        confirming: false,
        status: "error",
        botError: error instanceof Error ? error.message : "The confirmation request failed.",
      });
    }
  }

  async function handleAnalyzeFile() {
    if (!selectedFile || analyzing) return;
    setAnalyzing(true);
    setFilePlan(null);
    setFileResult(null);
    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      const response = await fetch("/api/files/parse", { method: "POST", body: formData });
      const json = (await response.json()) as FileParseResponse;
      setFilePlan(json);
    } catch (error) {
      setFilePlan({ ok: false, error: { type: "network_error", message: error instanceof Error ? error.message : "Upload failed." } });
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleApproveFile() {
    if (!filePlan?.actions || fileExecuting) return;
    const runnable = filePlan.actions.filter((a) => a.status !== "error" && a.type);
    if (runnable.length === 0) return;
    setFileExecuting(true);
    try {
      const response = await fetch("/api/files/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intent: `${filePlan.sourceType}:${filePlan.fileName}`,
          actions: runnable.map((a) => ({ type: a.type, payload: a.payload })),
        }),
      });
      const json = (await response.json()) as ExecuteResponse;
      setFileResult(json);
      await loadDashboardData();
    } finally {
      setFileExecuting(false);
    }
  }

  async function handleConfirmFile(approve: boolean) {
    if (!fileResult?.confirmRequestId) return;
    if (!approve) {
      setFileResult(null);
      return;
    }
    setFileExecuting(true);
    try {
      const response = await fetch("/api/files/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmRequestId: fileResult.confirmRequestId, confirm: true }),
      });
      const json = (await response.json()) as ExecuteResponse;
      setFileResult(json);
      await loadDashboardData();
    } finally {
      setFileExecuting(false);
    }
  }

  const total = requests?.length ?? 0;
  const successful = requests?.filter((r) => r.status === "success").length ?? 0;
  const failed = requests?.filter((r) => r.status === "failed" || r.status === "partial_failure").length ?? 0;
  const running = requests?.filter((r) => RUNNING_STATUSES.has(r.status)).length ?? 0;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8 px-4 py-10 sm:px-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-50">
          AI Operations Command Center
        </h1>
        <p className="mt-1 text-sm text-neutral-400">
          Natural-language request → agent reasoning → controlled n8n execution → GoHighLevel → Supabase audit log.
        </p>
      </header>

      {loadError && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          Couldn&apos;t load dashboard data: {loadError}
        </div>
      )}

      <StatsRow total={total} successful={successful} failed={failed} running={running} />

      <section className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-medium text-neutral-200">Command Center chat</h2>
            <p className="mt-1 text-xs text-neutral-500">
              Type what you want done in plain English — it&apos;s understood and acted on automatically. If it
              can&apos;t be done, you&apos;ll get a clear reason instead of an error code.
            </p>
          </div>
          {submissions.some((s) => s.status === "thinking") && (
            <span className="text-xs text-neutral-500">
              {submissions.filter((s) => s.status === "thinking").length} thinking…
            </span>
          )}
        </div>

        <div className="mt-4 flex max-h-[32rem] flex-col-reverse gap-4 overflow-y-auto pr-1">
          {submissions.length === 0 && (
            <p className="py-6 text-center text-sm text-neutral-600">
              Nothing yet — try &ldquo;Move John Smith&apos;s opportunity to Qualified and create a follow-up task
              for tomorrow.&rdquo;
            </p>
          )}
          {submissions.map((submission) => (
            <div key={submission.id} className="flex flex-col gap-2">
              {/* User bubble */}
              <div className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-neutral-100 px-4 py-2 text-sm text-neutral-900">
                  {submission.requestText}
                </div>
              </div>

              {/* Assistant bubble */}
              <div className="flex justify-start">
                <div className="max-w-[85%] rounded-2xl rounded-bl-sm border border-neutral-800 bg-neutral-950 px-4 py-3 text-sm text-neutral-200">
                  {submission.status === "thinking" && (
                    <span className="text-neutral-500">Thinking…</span>
                  )}

                  {submission.status === "error" && (
                    <div className="text-amber-300">
                      <span className="font-medium">This action can&apos;t be done</span> — {submission.botError}
                    </div>
                  )}

                  {submission.status === "awaiting_choice" && submission.suggestions && (
                    <div>
                      <p className="text-neutral-400">That could mean a few things — which did you mean?</p>
                      <ul className="mt-2 flex flex-col gap-2">
                        {submission.suggestions.map((s, i) => (
                          <li key={i}>
                            <button
                              onClick={() => handleSelectSuggestion(submission, s)}
                              disabled={submission.selecting}
                              className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-left text-sm text-neutral-200 transition hover:border-neutral-500 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              <span className="mr-2 font-mono text-xs text-neutral-500">{s.type}</span>
                              {s.label}
                            </button>
                          </li>
                        ))}
                      </ul>
                      {submission.selecting && <p className="mt-2 text-xs text-neutral-500">Running that now…</p>}
                    </div>
                  )}

                  {submission.status === "awaiting_confirmation" && submission.result && (
                    <div>
                      <p className="text-neutral-300">
                        This includes a destructive or high-impact action — confirm before it runs.
                      </p>
                      <ul className="mt-2 flex flex-col gap-1">
                        {submission.result.actions?.map((action, i) => (
                          <li key={i} className="text-xs text-neutral-400">
                            {action.type}
                            {action.payload && (
                              <pre className="mt-1 whitespace-pre-wrap rounded bg-neutral-900 px-2 py-1 text-[11px] text-neutral-500">
                                {JSON.stringify(action.payload)}
                              </pre>
                            )}
                          </li>
                        ))}
                      </ul>
                      <div className="mt-2 flex items-center gap-2">
                        <button
                          onClick={() => handleConfirm(submission, false)}
                          className="rounded border border-neutral-700 px-3 py-1 text-xs text-neutral-300 hover:bg-neutral-800"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => handleConfirm(submission, true)}
                          disabled={submission.confirming}
                          className="rounded bg-amber-500 px-3 py-1 text-xs font-medium text-neutral-900 hover:bg-amber-400 disabled:opacity-50"
                        >
                          {submission.confirming ? "Running…" : "Approve & Execute"}
                        </button>
                      </div>
                    </div>
                  )}

                  {submission.status === "done" && submission.result && (
                    <div className="flex flex-col gap-1.5">
                      {submission.result.actions?.map((action, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <StatusBadge status={action.status} />
                          <span>{action.type}</span>
                        </div>
                      ))}
                      {submission.result.actions && submission.result.actions.length > 0 ? (
                        <p className="text-neutral-400">Done.</p>
                      ) : (
                        <p className="text-amber-300">
                          <span className="font-medium">This action can&apos;t be done</span> — no allowed action was
                          matched for this request.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 flex items-end gap-2 border-t border-neutral-800 pt-4">
          <textarea
            value={userRequest}
            onChange={(e) => setUserRequest(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            rows={2}
            placeholder="What would you like me to do? (Enter to send, Shift+Enter for a new line)"
            className="flex-1 resize-none rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none"
          />
          <button
            onClick={handleSend}
            disabled={!userRequest.trim()}
            className="rounded-lg bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            Send
          </button>
        </div>
        <input
          value={contactIdOverride}
          onChange={(e) => setContactIdOverride(e.target.value)}
          placeholder="Real GHL contact ID (optional — overrides the agent's guess so this hits real data)"
          className="mt-2 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-1.5 text-xs text-neutral-300 placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none"
        />
      </section>

      <section className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-5">
        <h2 className="text-sm font-medium text-neutral-200">Upload a file (CSV / PDF / Markdown)</h2>
        <p className="mt-1 text-xs text-neutral-500">
          CSV rows, PDF instructions, or Markdown steps are parsed into the same action plan a typed command
          produces — nothing runs until you review it below and click Approve &amp; Execute.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <input
            type="file"
            accept=".csv,.pdf,.md,.markdown,text/csv,application/pdf,text/markdown"
            onChange={(e) => {
              setSelectedFile(e.target.files?.[0] ?? null);
              setFilePlan(null);
              setFileResult(null);
            }}
            className="flex-1 text-xs text-neutral-400 file:mr-3 file:rounded-lg file:border file:border-neutral-700 file:bg-neutral-950 file:px-3 file:py-1.5 file:text-xs file:text-neutral-200"
          />
          <button
            onClick={handleAnalyzeFile}
            disabled={!selectedFile || analyzing}
            className="rounded-lg bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {analyzing ? "Analyzing…" : "Analyze"}
          </button>
        </div>

        {filePlan && !filePlan.ok && (
          <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {filePlan.error?.message}
          </div>
        )}

        {filePlan?.ok && (
          <div className="mt-4 rounded-lg border border-neutral-800 bg-neutral-950 p-4 text-sm">
            <div className="flex flex-wrap items-center gap-2 text-neutral-300">
              <span className="font-mono text-xs text-neutral-500">{filePlan.fileName}</span>
              <span className="text-xs text-neutral-500">
                {filePlan.actions?.filter((a) => a.status !== "error").length ?? 0} action(s) ready ·{" "}
                {filePlan.actions?.filter((a) => a.status === "error").length ?? 0} skipped
              </span>
            </div>
            {filePlan.warnings && filePlan.warnings.length > 0 && (
              <ul className="mt-2 flex flex-col gap-1 text-xs text-amber-300">
                {filePlan.warnings.map((w, i) => (
                  <li key={i}>⚠ {w}</li>
                ))}
              </ul>
            )}
            <ul className="mt-2 flex max-h-64 flex-col divide-y divide-neutral-800 overflow-y-auto">
              {filePlan.actions?.map((action, i) => (
                <li key={i} className="flex flex-col gap-0.5 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={action.status} />
                    <span className="font-mono text-xs text-neutral-500">#{action.source}</span>
                    {action.type && <span className="text-neutral-200">{action.type}</span>}
                    <span className="text-neutral-400">{action.target}</span>
                  </div>
                  {action.message && <p className="ml-1 text-xs text-neutral-500">{action.message}</p>}
                </li>
              ))}
            </ul>

            {!fileResult && (
              <div className="mt-3 flex justify-end">
                <button
                  onClick={handleApproveFile}
                  disabled={fileExecuting || !filePlan.actions?.some((a) => a.status !== "error")}
                  className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-neutral-900 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {fileExecuting ? "Executing…" : "Approve & Execute"}
                </button>
              </div>
            )}

            {fileResult?.ok && (
              <div className="mt-4 border-t border-neutral-800 pt-3">
                <div className="flex flex-wrap items-center gap-2 text-neutral-300">
                  {fileResult.status && <StatusBadge status={fileResult.status} />}
                  <span className="text-xs text-neutral-500">
                    {fileResult.actions?.filter((a) => a.status === "success").length ?? 0} succeeded ·{" "}
                    {fileResult.actions?.filter((a) => a.status === "failed").length ?? 0} failed
                  </span>
                </div>
                <ul className="mt-2 flex flex-col gap-1">
                  {fileResult.actions?.map((action, i) => (
                    <li key={i} className="flex items-center gap-2 text-xs text-neutral-300">
                      <StatusBadge status={action.status} />
                      <span>{action.type}</span>
                      {action.error && <span className="text-red-400">— {action.error}</span>}
                    </li>
                  ))}
                </ul>
                {fileResult.status === "awaiting_confirmation" && (
                  <div className="mt-2 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                    <span className="flex-1">This plan includes a destructive or high-impact action — confirm before it runs.</span>
                    <button onClick={() => handleConfirmFile(false)} className="rounded border border-neutral-700 px-2 py-1 text-neutral-300 hover:bg-neutral-800">
                      Cancel
                    </button>
                    <button
                      onClick={() => handleConfirmFile(true)}
                      disabled={fileExecuting}
                      className="rounded bg-amber-500 px-2 py-1 font-medium text-neutral-900 hover:bg-amber-400 disabled:opacity-50"
                    >
                      {fileExecuting ? "Running…" : "Approve & Execute"}
                    </button>
                  </div>
                )}
              </div>
            )}
            {fileResult && !fileResult.ok && (
              <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                {fileResult.error?.message}
              </div>
            )}
          </div>
        )}
      </section>

      <div className="grid gap-6 md:grid-cols-[2fr_1fr]">
        <section className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-5">
          <h2 className="text-sm font-medium text-neutral-200">Recent executions</h2>

          {requests === null && !loadError && (
            <p className="mt-3 text-sm text-neutral-500">Loading…</p>
          )}
          {requests === null && loadError && (
            <p className="mt-3 text-sm text-neutral-600">Unavailable — see error above.</p>
          )}

          {requests !== null && requests.length === 0 && (
            <p className="mt-3 text-sm text-neutral-500">
              No automation requests yet — submit one above to see it here.
            </p>
          )}

          {requests !== null && requests.length > 0 && (
            <ul className="mt-3 flex flex-col divide-y divide-neutral-800">
              {requests.map((request) => (
                <li key={request.id} className="flex flex-col gap-1.5 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={request.status} />
                    <span className="text-xs text-neutral-500">{formatTimestamp(request.createdAt)}</span>
                    {request.intent && (
                      <span className="text-xs text-neutral-600">intent: {request.intent}</span>
                    )}
                  </div>
                  <p className="text-sm text-neutral-200">{request.userRequest}</p>
                  {request.actions.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {request.actions.map((action) => {
                        const resource = action.status === "success" ? extractResourceId(action.response) : null;
                        const errorMessage =
                          action.status === "failed" && action.response && typeof action.response.error === "string"
                            ? action.response.error
                            : action.status === "failed" && action.response && typeof (action.response.error as { message?: string })?.message === "string"
                              ? (action.response.error as { message: string }).message
                              : null;
                        return (
                          <span
                            key={action.id}
                            className="inline-flex items-center gap-1 rounded border border-neutral-800 px-1.5 py-0.5 text-xs text-neutral-400"
                            title={errorMessage ?? undefined}
                          >
                            {action.actionType}
                            <StatusBadge status={action.status} />
                            {resource && (
                              <span className="font-mono text-neutral-600">
                                {resource.label} #{resource.id.slice(0, 8)}
                              </span>
                            )}
                            {errorMessage && <span className="max-w-[16rem] truncate text-red-400">— {errorMessage}</span>}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="flex flex-col gap-6">
          <section className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-5">
            <h2 className="text-sm font-medium text-neutral-200">Agents</h2>
            {agents === null && !loadError && <p className="mt-3 text-sm text-neutral-500">Loading…</p>}
            {agents === null && loadError && (
              <p className="mt-3 text-sm text-neutral-600">Unavailable — see error above.</p>
            )}
            {agents !== null && (
              <ul className="mt-3 flex flex-col gap-2">
                {agents.map((agent) => (
                  <li key={agent.id} className="flex items-center justify-between text-sm">
                    <div>
                      <div className="text-neutral-200">{agent.name}</div>
                      <div className="text-xs text-neutral-500">{agent.adapterType}</div>
                    </div>
                    <StatusBadge status={agent.status} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-5">
            <h2 className="text-sm font-medium text-neutral-200">Integrations</h2>
            {integrations === null && !loadError && (
              <p className="mt-3 text-sm text-neutral-500">Loading…</p>
            )}
            {integrations === null && loadError && (
              <p className="mt-3 text-sm text-neutral-600">Unavailable — see error above.</p>
            )}
            {integrations !== null && integrations.length === 0 && (
              <p className="mt-3 text-sm text-neutral-500">None configured yet.</p>
            )}
            {integrations !== null && integrations.length > 0 && (
              <ul className="mt-3 flex flex-col gap-2">
                {integrations.map((integration) => (
                  <li key={integration.id} className="flex items-center justify-between text-sm">
                    <div>
                      <div className="text-neutral-200">{integration.name}</div>
                      <div className="text-xs text-neutral-500">{integration.provider}</div>
                    </div>
                    <StatusBadge status={integration.status} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      <section className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-5">
        <h2 className="text-sm font-medium text-neutral-200">Execution logs</h2>
        <p className="mt-1 text-xs text-neutral-500">
          Raw audit trail — one row per workflow execution attempt, written by the n8n adapter (real or mock).
        </p>

        {logs === null && !loadError && <p className="mt-3 text-sm text-neutral-500">Loading…</p>}
        {logs === null && loadError && (
          <p className="mt-3 text-sm text-neutral-600">Unavailable — see error above.</p>
        )}
        {logs !== null && logs.length === 0 && (
          <p className="mt-3 text-sm text-neutral-500">No executions logged yet.</p>
        )}
        {logs !== null && logs.length > 0 && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-neutral-500">
                  <th className="pb-2 pr-4 font-normal">Time</th>
                  <th className="pb-2 pr-4 font-normal">Workflow</th>
                  <th className="pb-2 pr-4 font-normal">Status</th>
                  <th className="pb-2 pr-4 font-normal">Duration</th>
                  <th className="pb-2 font-normal">Error</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800">
                {logs.map((log) => (
                  <tr key={log.id} className="text-neutral-300">
                    <td className="py-2 pr-4 whitespace-nowrap text-neutral-500">
                      {formatTimestamp(log.createdAt)}
                    </td>
                    <td className="py-2 pr-4 font-mono">{log.workflowName}</td>
                    <td className="py-2 pr-4">
                      <StatusBadge status={log.status} />
                    </td>
                    <td className="py-2 pr-4 text-neutral-500">
                      {log.durationMs !== null ? `${log.durationMs}ms` : "—"}
                    </td>
                    <td className="py-2 text-red-400">{log.errorMessage ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
