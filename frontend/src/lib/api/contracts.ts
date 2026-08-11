import type {
  AppUpdateData,
  DashboardAiAnalysis,
  DashboardDatasetKey,
  DashboardFilters,
  DashboardManifest,
  DashboardOverview,
  TenderProjectData,
} from "@dashboard-data/contracts";

export type {
  AppUpdateData,
  DashboardAiAnalysis,
  DashboardDatasetKey,
  DashboardFilters,
  DashboardManifest,
  DashboardOverview,
  TenderProjectData,
};

export type JobStatus = "idle" | "running" | "succeeded" | "failed" | "cancelled";
export type JobType = "scraper" | "llm" | "pipeline" | "llm-external" | "app-watch";

export interface LoginResponse {
  token: string;
  username: string;
  name: string;
  role: "admin" | "user";
  is_admin: boolean;
}

export type AuditEventType =
  | "qr_visit"
  | "qualification_application"
  | "login_success"
  | "dashboard_view"
  | "custom_intelligence_config_updated"
  | "custom_intelligence_secret_revealed"
  | "custom_intelligence_connection_tested"
  | "custom_intelligence_email_sent";
export interface AuditContextInput { visitor_id?: string; source?: "qr" | "qr_poster"; }
export interface AuditEventRecord {
  id: number; event_type: AuditEventType; visitor_id: string | null; user_id: number | null;
  username: string | null; role: string | null; source: string | null; ip_masked: string | null;
  user_agent: string | null; created_at: string; metadata: Record<string, unknown>;
}
export interface AuditSummaryResponse {
  timezone: string; today_qr_visits: number; today_qualification_applicants: number;
  today_login_users: number; today_dashboard_users: number;
}
export interface AuditEventsResponse {
  events: AuditEventRecord[];
  meta: AdminListMeta & { type: AuditEventType | null; count: number };
}

export interface StartJobResponse { job_id: string; job_type: JobType; status: "running"; }
export interface JobResponse {
  job_id: string; job_type: JobType;
  status: "pending" | "running" | "succeeded" | "failed" | "cancelled";
  created_at: string; started_at: string | null; finished_at: string | null;
  exit_code: number | null; error: string | null; pid?: number | null; log_count?: number;
  last_event_at?: string | null; process_alive?: boolean; events?: JobEvent[];
}
export type JobEvent =
  | { type: "start"; job_id: string; job_type?: JobType; message: string; timestamp: string; sequence?: number }
  | { type: "log"; job_id: string; stream: "stdout" | "stderr"; message: string; timestamp: string; sequence?: number }
  | { type: "progress"; job_id: string; job_type?: JobType; stage: string; message: string; current?: number; total?: number; progress?: number; timestamp: string; sequence?: number }
  | { type: "done"; job_id: string; status: "succeeded" | "failed" | "cancelled"; exit_code: number | null; timestamp: string; error?: string; sequence?: number };

export type DashboardDatasetResponse =
  | DashboardOverview
  | DashboardFilters
  | TenderProjectData[]
  | AppUpdateData[]
  | DashboardAiAnalysis;
export interface DashboardExportResponse {
  message: string;
  manifest: DashboardManifest;
  download_url: string;
}
export interface AiAnalysisResponse {
  content: string | null; updatedAt: string | null;
  analysis?: { content?: string; [key: string]: unknown };
  meta?: { generated_at: string; source_count: number; window_days: number; cached: boolean };
}
export interface PublishAnnouncementsResponse {
  message: string;
  meta: {
    count: number; staging_count?: number; true_count?: number; false_count?: number;
    empty_count?: number; previous_count?: number; source_count?: number; published_count?: number;
    excluded_count?: number; published_at: string; updated_at: string; backup_file?: string | null;
  };
}

export interface AdminUser {
  id: number; name: string; email: string; department: string; username: string; created_at: string;
}
export interface AdminListMeta { page: number; page_size: number; total: number; total_pages: number; q: string; }
export interface AdminListQuery { page: number; pageSize: number; query: string; }
export interface AdminUsersResponse { users: AdminUser[]; meta: AdminListMeta; }
export interface CreateAdminUserInput { name: string; email: string; department: string; }
export interface CreateAdminUserResponse { user: AdminUser; initial_password: string; }
export interface ApplyUserInput { name: string; email: string; department: string; }
export interface ApplyUserResponse { user: AdminUser; username: string; initial_password: string; }

export type FeedbackCategory = "broker_request" | "data_issue" | "product_suggestion";
export type FeedbackStatus = "pending" | "processed";
export interface FeedbackRecord {
  id: number; category: FeedbackCategory; broker_name: string; message: string;
  related_context: string; reporter_username: string; reporter_name: string;
  status: FeedbackStatus; created_at: string; processed_at: string | null;
}
export interface FeedbackCreateInput {
  category: FeedbackCategory; broker_name?: string; message?: string; related_context?: string;
}
export interface FeedbackResponse { feedback: FeedbackRecord; }
export interface AdminFeedbackResponse { feedback: FeedbackRecord[]; }

export type IntelligenceTimeRange = "week" | "month" | "semiyear" | "year";

export interface CustomIntelligenceOptionsResponse {
  service_status: "enabled" | "disabled" | "not_configured";
}

export interface IntelligenceSearchTestRecord {
  status: string;
  message: string;
  tested_at: string | null;
}

export interface IntelligenceSearchConfigResponse {
  enabled: boolean;
  endpoint: string;
  auth_header: string;
  timeout_seconds: number;
  api_key_mask: string;
  has_api_key: boolean;
  config_source: "admin" | "env";
  last_test: IntelligenceSearchTestRecord | null;
  analysis_configured: boolean;
  analysis_service_status: "configured" | "not_configured";
}

export interface IntelligenceSearchConfigInput {
  enabled: boolean;
  timeout_seconds: number;
  api_key?: string;
}

export interface IntelligenceSearchTestResponse {
  status: "success" | "failed";
  message: string;
  tested_at: string;
  request_id?: string | null;
}

export interface IntelligenceSource {
  id: string;
  title: string;
  url: string;
  site_name?: string;
  date?: string;
  snippet?: string;
}

export interface IntelligenceReport {
  version?: 1;
  title?: string;
  core_conclusion?: string;
  reference_warnings?: string[];
  [key: string]: unknown;
}

/**
 * AI 情报助手 V2 contracts. Old persisted reports remain readable through the
 * small IntelligenceReport compatibility shape above, but no legacy search
 * configuration is part of the public client contract.
 */
export type IntelligenceAssistantAudience =
  | "management"
  | "business_product"
  | "technology"
  | "compliance_risk"
  | "industry_research"
  | "custom";
export type IntelligenceReportLength = "concise" | "standard" | "deep";
export type IntelligenceReportItemType = "fact" | "analysis" | "recommendation";
export type IntelligenceReportTemplateStyle = "research" | "newsletter";
export type IntelligenceDeliveryFormat = "html_pdf" | "html_only" | "pdf_only";

export interface IntelligenceAssistantRequest {
  audience: IntelligenceAssistantAudience;
  audience_detail: string;
  focus_tags: string[];
  focus: string;
  extra_focus: string;
  time_range: IntelligenceTimeRange;
  report_length: IntelligenceReportLength;
}

export interface IntelligenceConfirmedPlan {
  intent: string;
  directions: string[];
}

export interface IntelligenceAssistantExecutionInput extends IntelligenceAssistantRequest {
  confirmed_plan?: IntelligenceConfirmedPlan;
}

export interface IntelligenceQueryPlanResponse extends IntelligenceConfirmedPlan {
  degraded: boolean;
  warning?: string | null;
}

export interface IntelligenceAssistantTopic extends IntelligenceAssistantRequest {
  id: number;
  name: string;
  created_at: string;
  updated_at: string;
  latest_execution?: IntelligenceAssistantExecution | null;
}

export interface IntelligenceReportItem {
  type: IntelligenceReportItemType;
  text: string;
  source_ids?: string[];
}

export interface IntelligenceReportV2 {
  version: 2;
  title: string;
  audience: IntelligenceAssistantAudience | string;
  executed_at: string;
  time_range: IntelligenceTimeRange | string;
  report_length: IntelligenceReportLength | string;
  core_judgment: IntelligenceReportItem[] | string;
  key_developments: IntelligenceReportItem[];
  impact_analysis: IntelligenceReportItem[];
  company_implications: IntelligenceReportItem[];
  risks_and_watch_items: IntelligenceReportItem[];
  reference_warnings?: string[];
}

export interface IntelligenceAssistantExecution {
  id: number;
  assistant_id?: number | null;
  topic_id?: number | null;
  assistant_name?: string | null;
  topic_name?: string | null;
  trigger_type?: "instant" | "assistant" | "topic" | "rerun" | string;
  snapshot: Partial<IntelligenceAssistantRequest>;
  original_query?: string;
  report: IntelligenceReportV2 | Partial<IntelligenceReportV2> | IntelligenceReport | null;
  sources: IntelligenceSource[];
  report_version?: number | null;
  status: "pending" | "running" | "succeeded" | "empty" | "failed";
  search_status?: "pending" | "running" | "succeeded" | "failed" | "not_run";
  analysis_status?: "pending" | "running" | "succeeded" | "failed" | "not_run";
  error_message: string | null;
  search_error_message?: string | null;
  analysis_error_message?: string | null;
  created_at: string;
  started_at?: string | null;
  completed_at: string | null;
}

export interface IntelligenceAssistantTopicsResponse {
  topics: IntelligenceAssistantTopic[];
}
export interface IntelligenceAssistantTopicResponse {
  topic: IntelligenceAssistantTopic;
}
export interface IntelligenceAssistantExecutionResponse {
  execution: IntelligenceAssistantExecution;
}
export interface IntelligenceAssistantExecutionsResponse {
  executions: IntelligenceAssistantExecution[];
  meta: { page: number; page_size: number; total: number; total_pages: number };
}

export interface IntelligenceAssistantEmailInput {
  recipients: string[];
  note: string;
  external_confirmed: boolean;
  template_style: IntelligenceReportTemplateStyle;
  delivery_format: IntelligenceDeliveryFormat;
}
export interface IntelligenceAssistantEmailResponse {
  status: "success" | "partial_failed";
  deliveries: Array<{
    id: number;
    execution_id: number;
    recipient: string;
    format: IntelligenceDeliveryFormat | "html" | "pdf";
    status: "sent" | "failed";
    error_message?: string | null;
    sent_at?: string | null;
  }>;
}

export interface IntelligenceLlmConfigResponse {
  enabled: boolean;
  base_url: string;
  model: string;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  timeout_seconds: number;
  use_json_object?: boolean;
  api_key_mask: string;
  has_api_key: boolean;
  config_source: "override" | "fallback" | "not_configured" | string;
}
export interface IntelligenceLlmConfigInput {
  enabled: boolean;
  base_url: string;
  model: string;
  temperature: number;
  top_p: number;
  max_tokens: number;
  timeout_seconds: number;
  use_json_object: boolean;
  api_key?: string;
}
export interface IntelligenceSmtpConfigResponse {
  enabled: boolean;
  host: string;
  port: number;
  username: string;
  authorization_code_mask: string;
  has_authorization_code: boolean;
  use_ssl: boolean;
  from_address: string;
  timeout_seconds: number;
  config_source: "database" | "environment" | string;
}
export interface IntelligenceSmtpConfigInput {
  enabled: boolean;
  username: string;
  authorization_code?: string;
  from_address: string;
  timeout_seconds: number;
}
export interface IntelligenceDefaultRulesResponse {
  analysis_instructions: string;
  updated_at: string | null;
}
export type IntelligenceDefaultRulesInput = Omit<IntelligenceDefaultRulesResponse, "updated_at">;

export interface IntelligenceAdminExecutionSummary {
  id: number;
  owner_user_id: number;
  topic_name?: string;
  trigger_type?: string;
  status: string;
  planning_status?: string;
  search_status?: string;
  analysis_status?: string;
  source_count: number;
  domain_count: number;
  created_at: string;
  completed_at?: string | null;
}
export interface IntelligenceAdminExecutionsResponse {
  executions: IntelligenceAdminExecutionSummary[];
  meta: { page: number; page_size: number; total: number; total_pages: number };
}
export interface IntelligenceExecutionDiagnostics extends IntelligenceAdminExecutionSummary {
  execution_id: number;
  request_id?: string | null;
  started_at?: string | null;
  duration_seconds?: number | null;
  stage: string;
  message: string;
  planner: {
    status: string;
    intent: string;
    error_message?: string | null;
    queries: Array<{ query: string; purpose: string }>;
  };
  search: {
    rounds: Array<Record<string, string | number | boolean | null>>;
    per_query: Array<Record<string, string | number | boolean | null>>;
  };
  counts: Record<string, number>;
  final_sources: Array<Pick<IntelligenceSource, "id" | "title" | "url" | "site_name" | "date">>;
  request_ids: string[];
  stage_errors: Record<string, string>;
}
export interface IntelligenceExecutionDiagnosticsResponse {
  diagnostics: IntelligenceExecutionDiagnostics;
}
