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

export interface DatasetResponse {
  records: Record<string, string>[];
  meta: { count: number; updated_at: string | null };
}
export type AnnouncementsResponse = DatasetResponse;
export type AppReleasesResponse = DatasetResponse;

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
