const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/+$/, "") ||
  "http://localhost:8000";

export type JobStatus = "idle" | "running" | "succeeded" | "failed" | "cancelled";
export type JobType = "scraper" | "llm";

export interface LoginResponse {
  token: string;
  username: string;
  name: string;
  role: "admin" | "user";
  is_admin: boolean;
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
    source_count?: number;
    published_count?: number;
    excluded_count?: number;
    published_at: string;
    updated_at: string;
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
    const data = (await response.json()) as { detail?: string; error?: string };
    return data.detail || data.error || response.statusText;
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
    response = await fetch(`${API_BASE_URL}${path}`, {
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
): Promise<LoginResponse> {
  return requestJson<LoginResponse>("/api/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export function applyForUser(input: ApplyUserInput): Promise<ApplyUserResponse> {
  return requestJson<ApplyUserResponse>("/api/users/apply", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function startScraperJob(token: string): Promise<StartJobResponse> {
  return startJob("scraper", token);
}

export function startJob(jobType: JobType, token: string): Promise<StartJobResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  return requestJson<StartJobResponse>(
    `/api/jobs/${jobType}`,
    { method: "POST", signal: controller.signal },
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

export function getAdminUsers(token: string): Promise<AdminUsersResponse> {
  return requestJson<AdminUsersResponse>("/api/admin/users", {}, token);
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
    `${API_BASE_URL}/api/jobs/${encodeURIComponent(jobId)}/events`,
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
