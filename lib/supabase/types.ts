/**
 * Hand-authored Supabase Database types, kept in exact sync with
 * supabase/migrations/20260830163243_init_schema.sql, including the
 * `Relationships` metadata supabase-js's query builder uses to type
 * embedded resource selects (e.g. `.select("*, automation_actions(*)")`).
 *
 * Once a live Supabase project exists, prefer regenerating this file with
 * `supabase gen types typescript` and reconciling any drift — this
 * hand-written version exists only because no live project is connected
 * yet in this environment. The shape below intentionally matches that
 * generator's output format.
 */
import type { AllowedAction } from "@/lib/actions/allowlist";

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type AgentAdapterType = "openclaw" | "mock";
export type AgentStatus = "active" | "disabled";
export type IntegrationProvider = "n8n" | "gohighlevel";
export type IntegrationStatus = "active" | "disabled" | "error";
export type AutomationRequestStatus =
  | "received"
  | "interpreting"
  | "awaiting_confirmation"
  | "executing"
  | "success"
  | "partial_failure"
  | "failed";
export type AutomationActionStatus =
  | "proposed"
  | "pending_approval"
  | "validated"
  | "executing"
  | "success"
  | "failed";
export type ExecutionLogStatus = "success" | "failed";

export interface Database {
  public: {
    Tables: {
      agents: {
        Row: {
          id: string;
          name: string;
          adapter_type: AgentAdapterType;
          description: string | null;
          config: Json;
          status: AgentStatus;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          adapter_type: AgentAdapterType;
          description?: string | null;
          config?: Json;
          status?: AgentStatus;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          adapter_type?: AgentAdapterType;
          description?: string | null;
          config?: Json;
          status?: AgentStatus;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      integrations: {
        Row: {
          id: string;
          name: string;
          provider: IntegrationProvider;
          base_url: string | null;
          status: IntegrationStatus;
          last_checked_at: string | null;
          metadata: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          provider: IntegrationProvider;
          base_url?: string | null;
          status?: IntegrationStatus;
          last_checked_at?: string | null;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          provider?: IntegrationProvider;
          base_url?: string | null;
          status?: IntegrationStatus;
          last_checked_at?: string | null;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      automation_requests: {
        Row: {
          id: string;
          user_request: string;
          status: AutomationRequestStatus;
          agent_id: string | null;
          intent: string | null;
          idempotency_key: string | null;
          created_at: string;
          completed_at: string | null;
        };
        Insert: {
          id?: string;
          user_request: string;
          status?: AutomationRequestStatus;
          agent_id?: string | null;
          intent?: string | null;
          idempotency_key?: string | null;
          created_at?: string;
          completed_at?: string | null;
        };
        Update: {
          id?: string;
          user_request?: string;
          status?: AutomationRequestStatus;
          agent_id?: string | null;
          intent?: string | null;
          idempotency_key?: string | null;
          created_at?: string;
          completed_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "automation_requests_agent_id_fkey";
            columns: ["agent_id"];
            isOneToOne: false;
            referencedRelation: "agents";
            referencedColumns: ["id"];
          },
        ];
      };
      automation_actions: {
        Row: {
          id: string;
          request_id: string;
          action_type: AllowedAction;
          target_system: "gohighlevel";
          payload: Json;
          status: AutomationActionStatus;
          response: Json | null;
          integration_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          request_id: string;
          action_type: AllowedAction;
          target_system?: "gohighlevel";
          payload?: Json;
          status?: AutomationActionStatus;
          response?: Json | null;
          integration_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          request_id?: string;
          action_type?: AllowedAction;
          target_system?: "gohighlevel";
          payload?: Json;
          status?: AutomationActionStatus;
          response?: Json | null;
          integration_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "automation_actions_request_id_fkey";
            columns: ["request_id"];
            isOneToOne: false;
            referencedRelation: "automation_requests";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "automation_actions_integration_id_fkey";
            columns: ["integration_id"];
            isOneToOne: false;
            referencedRelation: "integrations";
            referencedColumns: ["id"];
          },
        ];
      };
      execution_logs: {
        Row: {
          id: string;
          request_id: string | null;
          action_id: string | null;
          workflow_name: string;
          status: ExecutionLogStatus;
          error_message: string | null;
          duration_ms: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          request_id?: string | null;
          action_id?: string | null;
          workflow_name: string;
          status: ExecutionLogStatus;
          error_message?: string | null;
          duration_ms?: number | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          request_id?: string | null;
          action_id?: string | null;
          workflow_name?: string;
          status?: ExecutionLogStatus;
          error_message?: string | null;
          duration_ms?: number | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "execution_logs_request_id_fkey";
            columns: ["request_id"];
            isOneToOne: false;
            referencedRelation: "automation_requests";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "execution_logs_action_id_fkey";
            columns: ["action_id"];
            isOneToOne: false;
            referencedRelation: "automation_actions";
            referencedColumns: ["id"];
          },
        ];
      };
      contacts_cache: {
        Row: {
          id: string;
          external_id: string;
          name: string | null;
          email: string | null;
          source: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          external_id: string;
          name?: string | null;
          email?: string | null;
          source?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          external_id?: string;
          name?: string | null;
          email?: string | null;
          source?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

export type AgentRow = Database["public"]["Tables"]["agents"]["Row"];
export type IntegrationRow = Database["public"]["Tables"]["integrations"]["Row"];
export type AutomationRequestRow = Database["public"]["Tables"]["automation_requests"]["Row"];
export type AutomationActionRow = Database["public"]["Tables"]["automation_actions"]["Row"];
export type ExecutionLogRow = Database["public"]["Tables"]["execution_logs"]["Row"];
export type ContactsCacheRow = Database["public"]["Tables"]["contacts_cache"]["Row"];
