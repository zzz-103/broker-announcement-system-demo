function normalizeApiBaseUrl(value: string | undefined): string {
  const trimmed = value?.trim().replace(/\/+$/, "") ?? "";
  return trimmed.replace(/\/api$/i, "");
}

const API_BASE_URL = normalizeApiBaseUrl(process.env.NEXT_PUBLIC_API_BASE_URL);

function buildApiUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE_URL}${normalizedPath}`;
}

export type JobStatus = "idle" | "running" | "succeeded" | "failed" | "cancelled";
export type JobType = "scraper" | "llm" | "pipeline" | "llm-external";

export interface LoginResponse {
  token: string;
  username: string;
  name: string;
  role: "admin" | "user";
  is_admin: boolean;
}

export type AuditEventType = "qr_visit" | "qualification_application" | "login_success" | "dashboard_view";

export interface AuditContextInput {
  visitor_id?: string;
  source?: "qr" | "qr_poster";
}

export interface AuditEventRecord {
  id: number;
  event_type: AuditEventType;
  visitor_id: string | null;
  user_id: number | null;
  username: string | null;
  role: string | null;
  source: string | null;
  ip_masked: string | null;
  user_agent: string | null;
  created_at: string;
  metadata: Record<string, unknown>;
}

export interface AuditSummaryResponse {
  timezone: string;
  today_qr_visits: number;
  today_qualification_applicants: number;
  today_login_users: number;
  today_dashboard_users: number;
}

export interface AuditEventsResponse {
  events: AuditEventRecord[];
  meta: AdminListMeta & { type: AuditEventType | null; count: number };
}

export interface StartJobResponse {
  job_id: string;
  job_type: JobType;
  status: "running";
}

export interface JobResponse {
  job_id: string;
  job_type: JobType;
  status: "pending" | "running" | "succeeded" | "failed" | "cancelled";
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  exit_code: number | null;
  error: string | null;
  pid?: number | null;
  log_count?: number;
  last_event_at?: string | null;
  process_alive?: boolean;
  events?: JobEvent[];
}

export type JobEvent =
  | {
      type: "start";
      job_id: string;
      job_type?: JobType;
      message: string;
      timestamp: string;
      sequence?: number;
    }
  | {
      type: "log";
      job_id: string;
      stream: "stdout" | "stderr";
      message: string;
      timestamp: string;
      sequence?: number;
    }
  | {
      type: "progress";
      job_id: string;
      job_type?: JobType;
      stage: string;
      message: string;
      current?: number;
      total?: number;
      progress?: number;
      timestamp: string;
      sequence?: number;
    }
  | {
      type: "done";
      job_id: string;
      status: "succeeded" | "failed" | "cancelled";
      exit_code: number | null;
      timestamp: string;
      error?: string;
      sequence?: number;
    };

export interface AnnouncementsResponse {
  records: Record<string, string>[];
  meta: {
    count: number;
    updated_at: string | null;
  };
}

export interface AiAnalysisResponse {
  content: string | null;
  updatedAt: string | null;
  analysis?: {
    content?: string;
    [key: string]: unknown;
  };
  meta?: {
    generated_at: string;
    source_count: number;
    window_days: number;
    cached: boolean;
  };
}

export interface PublishAnnouncementsResponse {
  message: string;
  meta: {
    count: number;
    staging_count?: number;
    true_count?: number;
    false_count?: number;
    empty_count?: number;
    previous_count?: number;
    source_count?: number;
    published_count?: number;
    excluded_count?: number;
    published_at: string;
    updated_at: string;
    backup_file?: string | null;
  };
}

export interface AdminUser {
  id: number;
  name: string;
  email: string;
  department: string;
  username: string;
  created_at: string;
}

export interface AdminUsersResponse {
  users: AdminUser[];
  meta: AdminListMeta;
}

export interface AdminListMeta {
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
  q: string;
}

export interface AdminListQuery {
  page: number;
  pageSize: number;
  query: string;
}

export interface CreateAdminUserInput {
  name: string;
  email: string;
  department: string;
}

export interface CreateAdminUserResponse {
  user: AdminUser;
  initial_password: string;
}

export interface ApplyUserInput {
  name: string;
  email: string;
  department: string;
}

export interface ApplyUserResponse {
  user: AdminUser;
  username: string;
  initial_password: string;
}

export type FeedbackCategory = "broker_request" | "data_issue" | "product_suggestion";
export type FeedbackStatus = "pending" | "processed";

export interface FeedbackRecord {
  id: number;
  category: FeedbackCategory;
  broker_name: string;
  message: string;
  related_context: string;
  reporter_username: string;
  reporter_name: string;
  status: FeedbackStatus;
  created_at: string;
  processed_at: string | null;
}

export interface FeedbackCreateInput {
  category: FeedbackCategory;
  broker_name?: string;
  message?: string;
  related_context?: string;
}

export interface FeedbackResponse {
  feedback: FeedbackRecord;
}

export interface AdminFeedbackResponse {
  feedback: FeedbackRecord[];
}

export class BackendApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "BackendApiError";
    this.status = status;
  }
}

export class SseParseError extends Error {
  rawEvent: string;

  constructor(message: string, rawEvent: string) {
    super(message);
    this.name = "SseParseError";
    this.rawEvent = rawEvent;
  }
}

async function readError(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { detail?: unknown; error?: unknown };
    const detail = data.detail ?? data.error;
    if (typeof detail === "string") return detail;
    if (detail && typeof detail === "object") {
      const payload = detail as { message?: unknown; meta?: unknown };
      const message = typeof payload.message === "string" ? payload.message : response.statusText;
      return payload.meta ? `${message}: ${JSON.stringify(payload.meta)}` : message;
    }
    return response.statusText;
  } catch {
    return response.statusText || "Request failed";
  }
}

async function requestJson<T>(
  path: string,
  init: RequestInit = {},
  token?: string,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(buildApiUrl(path), {
      ...init,
      cache: init.cache ?? "no-store",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    });
  } catch (error) {
    throw new BackendApiError(
      error instanceof Error ? error.message : "Cannot connect to backend",
      0,
    );
  }

  if (!response.ok) {
    throw new BackendApiError(await readError(response), response.status);
  }
  return (await response.json()) as T;
}

export function loginAdmin(
  username: string,
  password: string,
  auditContext: AuditContextInput = {},
): Promise<LoginResponse> {
  return requestJson<LoginResponse>("/api/login", {
    method: "POST",
    body: JSON.stringify({ username, password, ...auditContext }),
  });
}

export function applyForUser(input: ApplyUserInput & AuditContextInput): Promise<ApplyUserResponse> {
  return requestJson<ApplyUserResponse>("/api/users/apply", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function recordQrVisit(context: Required<AuditContextInput>): Promise<{ recorded: boolean }> {
  return requestJson<{ recorded: boolean }>("/api/audit/qr-visit", {
    method: "POST",
    body: JSON.stringify(context),
  });
}

export function recordDashboardView(token: string, context: AuditContextInput): Promise<{ recorded: boolean }> {
  return requestJson<{ recorded: boolean }>(
    "/api/audit/dashboard-view",
    { method: "POST", body: JSON.stringify(context) },
    token,
  );
}

export function submitFeedback(token: string, input: FeedbackCreateInput): Promise<FeedbackResponse> {
  return requestJson<FeedbackResponse>(
    "/api/feedback",
    { method: "POST", body: JSON.stringify(input) },
    token,
  );
}

export function startScraperJob(token: string): Promise<StartJobResponse> {
  return startJob("scraper", token);
}

export interface StartLlmJobOptions {
  mode?: "incremental" | "full_refresh";
  overwrite?: boolean;
}

export function startJob(
  jobType: JobType,
  token: string,
  options?: StartLlmJobOptions,
): Promise<StartJobResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  const body = jobType === "llm" && options ? JSON.stringify(options) : undefined;
  return requestJson<StartJobResponse>(
    `/api/jobs/${jobType}`,
    { method: "POST", signal: controller.signal, body },
    token,
  ).finally(() => clearTimeout(timer));
}

export function getJob(jobId: string, token: string): Promise<JobResponse> {
  return requestJson<JobResponse>(`/api/jobs/${encodeURIComponent(jobId)}`, {}, token);
}

export function cancelJob(jobId: string, token: string): Promise<{ status: string; message?: string }> {
  return requestJson<{ status: string; message?: string }>(
    `/api/jobs/${encodeURIComponent(jobId)}/cancel`,
    { method: "POST" },
    token,
  );
}


export function fetchAnnouncements(token: string): Promise<AnnouncementsResponse> {
  return requestJson<AnnouncementsResponse>("/api/data/announcements", {}, token);
}

export function getAiAnalysis(token: string): Promise<AiAnalysisResponse> {
  return requestJson<AiAnalysisResponse>("/api/ai-analysis", {}, token);
}

export function generateAiAnalysis(token: string, signal?: AbortSignal): Promise<AiAnalysisResponse> {
  return requestJson<AiAnalysisResponse>(
    "/api/ai-analysis",
    { method: "POST", signal },
    token,
  );
}

export function publishAnnouncements(token: string, signal?: AbortSignal): Promise<PublishAnnouncementsResponse> {
  return requestJson<PublishAnnouncementsResponse>(
    "/api/data/announcements/publish",
    { method: "POST", signal },
    token,
  );
}

export function getAdminUsers(token: string, options: AdminListQuery): Promise<AdminUsersResponse> {
  const query = new URLSearchParams({
    page: String(options.page),
    page_size: String(options.pageSize),
  });
  if (options.query.trim()) query.set("q", options.query.trim());
  return requestJson<AdminUsersResponse>(`/api/admin/users?${query.toString()}`, {}, token);
}

export function getAdminAuditSummary(token: string): Promise<AuditSummaryResponse> {
  return requestJson<AuditSummaryResponse>("/api/admin/audit/summary", {}, token);
}

export function getAdminAuditEvents(
  token: string,
  eventType: AuditEventType | "",
  options: AdminListQuery,
): Promise<AuditEventsResponse> {
  const query = new URLSearchParams({
    page: String(options.page),
    page_size: String(options.pageSize),
  });
  if (eventType) query.set("type", eventType);
  if (options.query.trim()) query.set("q", options.query.trim());
  return requestJson<AuditEventsResponse>(`/api/admin/audit/events?${query.toString()}`, {}, token);
}

export function createAdminUser(
  token: string,
  input: CreateAdminUserInput,
): Promise<CreateAdminUserResponse> {
  return requestJson<CreateAdminUserResponse>(
    "/api/admin/users",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
    token,
  );
}

export function deleteAdminUser(token: string, userId: number): Promise<{ deleted: boolean }> {
  return requestJson<{ deleted: boolean }>(
    `/api/admin/users/${encodeURIComponent(String(userId))}`,
    { method: "DELETE" },
    token,
  );
}

export function getAdminFeedback(token: string): Promise<AdminFeedbackResponse> {
  return requestJson<AdminFeedbackResponse>("/api/admin/feedback", {}, token);
}

export function updateAdminFeedbackStatus(
  token: string,
  feedbackId: number,
  feedbackStatus: FeedbackStatus,
): Promise<FeedbackResponse> {
  return requestJson<FeedbackResponse>(
    `/api/admin/feedback/${encodeURIComponent(String(feedbackId))}/status`,
    { method: "POST", body: JSON.stringify({ status: feedbackStatus }) },
    token,
  );
}

export async function streamJobEvents(
  jobId: string,
  token: string,
  onEvent: (event: JobEvent) => void,
  signal: AbortSignal,
  options: {
    onOpen?: (response: Response) => void;
    onChunk?: () => void;
    onParseError?: (error: SseParseError) => void;
  } = {},
): Promise<void> {
  const response = await fetch(
    buildApiUrl(`/api/jobs/${encodeURIComponent(jobId)}/events`),
    {
      headers: {
        Accept: "text/event-stream",
        Authorization: `Bearer ${token}`,
      },
      signal,
    },
  );

  if (!response.ok) {
    throw new BackendApiError(await readError(response), response.status);
  }
  options.onOpen?.(response);
  if (!response.body) {
    throw new BackendApiError("SSE response body is empty", response.status);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const handleAbort = () => {
    try {
      reader.cancel();
    } catch {
      // ignore
    }
  };

  if (signal) {
    if (signal.aborted) {
      handleAbort();
      return;
    }
    signal.addEventListener("abort", handleAbort);
  }

  try {
    while (true) {
      if (signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;

      options.onChunk?.();
      buffer += decoder.decode(value, { stream: true });
      buffer = drainSseBuffer(buffer, onEvent, options.onParseError);
    }

    if (buffer.trim()) {
      drainSseBuffer(`${buffer}\n\n`, onEvent, options.onParseError);
    }
  } finally {
    if (signal) {
      signal.removeEventListener("abort", handleAbort);
    }
  }
}

function drainSseBuffer(
  input: string,
  onEvent: (event: JobEvent) => void,
  onParseError?: (error: SseParseError) => void,
): string {
  const normalized = input.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const parts = normalized.split("\n\n");
  const remainder = parts.pop() ?? "";

  for (const part of parts) {
    const dataLines: string[] = [];
    for (const line of part.split("\n")) {
      if (!line || line.startsWith(":")) continue;
      if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
      }
    }
    if (dataLines.length === 0) continue;

    const rawData = dataLines.join("\n");
    try {
      onEvent(JSON.parse(rawData) as JobEvent);
    } catch (error) {
      onParseError?.(
        new SseParseError(
          error instanceof Error ? error.message : "Failed to parse SSE event",
          rawData,
        ),
      );
    }
  }

  return remainder;
}

export const readScraperEvents = streamJobEvents;
