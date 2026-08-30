"use client";

import { useCallback, useEffect, useState } from "react";
import type { Agent, AutomationAction, AutomationRequest, Integration } from "@/lib/types/domain";
import { StatsRow } from "./StatsRow";
import { StatusBadge } from "./StatusBadge";

type RequestWithActions = AutomationRequest & { actions: AutomationAction[] };

interface ExecuteResponse {
  ok: boolean;
  requestId?: string;
  status?: string;
  intent?: string | null;
  actions?: Array<{ type: string; status: string; error?: string }>;
  error?: { type: string; message: string };
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

export function Dashboard() {
  const [requests, setRequests] = useState<RequestWithActions[] | null>(null);
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [integrations, setIntegrations] = useState<Integration[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [userRequest, setUserRequest] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [lastResult, setLastResult] = useState<ExecuteResponse | null>(null);

  const loadDashboardData = useCallback(async () => {
    try {
      const [requestsRes, agentsRes, integrationsRes] = await Promise.all([
        fetch("/api/requests"),
        fetch("/api/agents"),
        fetch("/api/integrations"),
      ]);
      const [requestsJson, agentsJson, integrationsJson] = await Promise.all([
        requestsRes.json(),
        agentsRes.json(),
        integrationsRes.json(),
      ]);

      if (!requestsJson.ok) throw new Error(requestsJson.error?.message ?? "Failed to load requests.");
      if (!agentsJson.ok) throw new Error(agentsJson.error?.message ?? "Failed to load agents.");
      if (!integrationsJson.ok)
        throw new Error(integrationsJson.error?.message ?? "Failed to load integrations.");

      setRequests(requestsJson.requests);
      setAgents(agentsJson.agents);
      setIntegrations(integrationsJson.integrations);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Failed to load dashboard data.");
    }
  }, []);

  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData]);

  async function handleExecute() {
    if (!userRequest.trim() || submitting) return;
    setSubmitting(true);
    setLastResult(null);

    try {
      const response = await fetch("/api/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userRequest }),
      });
      const json = (await response.json()) as ExecuteResponse;
      setLastResult(json);
      await loadDashboardData();
    } catch (error) {
      setLastResult({
        ok: false,
        error: {
          type: "network_error",
          message: error instanceof Error ? error.message : "Request failed.",
        },
      });
    } finally {
      setSubmitting(false);
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
        <h2 className="text-sm font-medium text-neutral-200">Submit an automation request</h2>
        <p className="mt-1 text-xs text-neutral-500">
          e.g. &ldquo;Move John Smith&apos;s opportunity to Qualified and create a follow-up task for tomorrow.&rdquo;
        </p>
        <textarea
          value={userRequest}
          onChange={(e) => setUserRequest(e.target.value)}
          rows={3}
          placeholder="What would you like me to do?"
          className="mt-3 w-full resize-none rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none"
        />
        <div className="mt-3 flex items-center justify-between">
          <button
            onClick={handleExecute}
            disabled={submitting || !userRequest.trim()}
            className="rounded-lg bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitting ? "Executing…" : "Execute Request"}
          </button>
        </div>

        {lastResult && (
          <div className="mt-4 rounded-lg border border-neutral-800 bg-neutral-950 p-4 text-sm">
            {lastResult.ok ? (
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2 text-neutral-300">
                  <span className="font-mono text-xs text-neutral-500">{lastResult.requestId}</span>
                  {lastResult.status && <StatusBadge status={lastResult.status} />}
                  {lastResult.intent && (
                    <span className="text-xs text-neutral-500">intent: {lastResult.intent}</span>
                  )}
                </div>
                <ul className="flex flex-col gap-1">
                  {lastResult.actions?.map((action, i) => (
                    <li key={i} className="flex items-center gap-2 text-neutral-300">
                      <StatusBadge status={action.status} />
                      <span>{action.type}</span>
                      {action.error && <span className="text-xs text-red-400">— {action.error}</span>}
                    </li>
                  ))}
                  {lastResult.actions?.length === 0 && (
                    <li className="text-neutral-500">
                      No allowed action was matched for this request.
                    </li>
                  )}
                </ul>
              </div>
            ) : (
              <div className="text-red-300">
                {lastResult.error?.type}: {lastResult.error?.message}
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
                      {request.actions.map((action) => (
                        <span
                          key={action.id}
                          className="inline-flex items-center gap-1 rounded border border-neutral-800 px-1.5 py-0.5 text-xs text-neutral-400"
                        >
                          {action.actionType}
                          <StatusBadge status={action.status} />
                        </span>
                      ))}
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
    </div>
  );
}
