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

export type AuditEventType = "qr_visit" | "qualification_application" | "login_success" | "dashboard_view";
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

export type IntelligencePerspective =
  | "management"
  | "product_business"
  | "technology"
  | "compliance_risk"
  | "industry_research";
export type IntelligenceTimeRange = "week" | "month" | "semiyear" | "year";
export type IntelligenceReportType =
  | "management_brief"
  | "competitive_analysis"
  | "industry_trends"
  | "risk_monitoring";
export type IntelligenceAnalysisDepth = "concise" | "standard" | "deep";
export type IntelligenceSourcePreference = "authoritative" | "balanced" | "news" | "research";

export interface CustomIntelligenceOption<T extends string = string> {
  value: T;
  label: string;
}

export interface CustomIntelligencePresetQuestion {
  id: string;
  title: string;
  question: string;
  analysis_perspective: IntelligencePerspective;
  report_type: IntelligenceReportType;
}

export interface CustomIntelligenceOptionsResponse {
  perspectives: CustomIntelligenceOption<IntelligencePerspective>[];
  time_ranges: CustomIntelligenceOption<IntelligenceTimeRange>[];
  report_types: CustomIntelligenceOption<IntelligenceReportType>[];
  analysis_depths: CustomIntelligenceOption<IntelligenceAnalysisDepth>[];
  max_sources_by_depth: Record<IntelligenceAnalysisDepth, number>;
  source_preferences: CustomIntelligenceOption<IntelligenceSourcePreference>[];
  preset_questions: CustomIntelligencePresetQuestion[];
  service_configured: boolean;
  service_enabled: boolean;
  service_status: "enabled" | "disabled" | "not_configured";
  deep_search_enabled: boolean;
  analysis_configured: boolean;
  analysis_service_status: "configured" | "not_configured";
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

export interface CustomIntelligenceConfig {
  description: string;
  keywords: string[];
  focus_objects: string[];
  analysis_perspective: IntelligencePerspective;
  time_range: IntelligenceTimeRange;
  source_preference: IntelligenceSourcePreference;
  specified_sites: string[];
  report_type: IntelligenceReportType;
  analysis_depth: IntelligenceAnalysisDepth;
  extra_requirements: string;
}

export interface InstantSearchRequest extends CustomIntelligenceConfig {
  question: string;
}

export interface IntelligenceTopic extends CustomIntelligenceConfig {
  id: number;
  name: string;
  question: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
  latest_execution?: CustomIntelligenceExecution | null;
}

export interface KeywordSuggestionRequest {
  description: string;
  question?: string;
  keywords: string[];
  focus_objects: string[];
  analysis_perspective: IntelligencePerspective;
  max_suggestions?: number;
}

export interface KeywordSuggestionsResponse {
  suggestions: string[];
}

export interface IntelligenceSource {
  id: string;
  title: string;
  url: string;
  site_name?: string;
  date?: string;
  snippet?: string;
}

export interface IntelligenceDynamic {
  title: string;
  institutions: string[];
  information_time: string;
  summary: string;
  impact_analysis: string;
  event_tags: string[];
  source_ids: string[];
}

export interface IntelligenceFocusSection {
  title: string;
  items: string[];
}

export interface IntelligenceReport {
  title: string;
  question: string;
  executed_at: string;
  time_range: string;
  valid_source_count: number;
  report_type: IntelligenceReportType;
  service: string;
  search_service: string;
  analysis_service: string;
  request_id: string;
  is_fallback: boolean;
  core_conclusion: string;
  key_dynamics: IntelligenceDynamic[];
  impact_analysis: string;
  opportunities: string[];
  risks: string[];
  watch_items: string[];
  recommended_followups: string[];
  focus_sections: IntelligenceFocusSection[];
  reference_warnings?: string[];
}

export type CustomIntelligenceExecutionStatus = "pending" | "running" | "succeeded" | "empty" | "failed";
export type CustomIntelligenceTrigger = "instant" | "topic" | "rerun" | string;

export interface CustomIntelligenceExecution {
  id: number;
  topic_id: number | null;
  topic_name: string;
  trigger_type: CustomIntelligenceTrigger;
  snapshot: Partial<InstantSearchRequest>;
  original_query: string;
  final_query: string;
  report: Partial<IntelligenceReport> | null;
  sources: IntelligenceSource[];
  search_answer: string;
  search_followups: string[];
  status: CustomIntelligenceExecutionStatus;
  error_message: string | null;
  search_status: "pending" | "running" | "succeeded" | "failed" | "not_run";
  analysis_status: "pending" | "running" | "succeeded" | "failed" | "not_run";
  search_error_message: string | null;
  analysis_error_message: string | null;
  request_id?: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface CustomIntelligenceTopicsResponse { topics: IntelligenceTopic[]; }
export interface CustomIntelligenceTopicResponse { topic: IntelligenceTopic; }
export interface CustomIntelligenceExecutionResponse { execution: CustomIntelligenceExecution; }
export interface CustomIntelligenceExecutionsResponse {
  executions: CustomIntelligenceExecution[];
  meta: { page: number; page_size: number; total: number; total_pages: number };
}
