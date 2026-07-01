const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/+$/, "") ||
  "http://localhost:8000";

export type JobStatus = "idle" | "running" | "succeeded" | "failed";
export type JobType = "scraper" | "llm";

export interface LoginResponse {
  token: string;
}

export interface StartJobResponse {
  job_id: string;
  job_type: JobType;
  status: "running";
}

export interface JobResponse {
  job_id: string;
  job_type: JobType;
  status: "pending" | "running" | "succeeded" | "failed";
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  exit_code: number | null;
  error: string | null;
}

export type JobEvent =
  | {
      type: "start";
      job_id: string;
      job_type?: JobType;
      message: string;
      timestamp: string;
    }
  | {
      type: "log";
      job_id: string;
      stream: "stdout" | "stderr";
      message: string;
      timestamp: string;
    }
  | {
      type: "done";
      job_id: string;
      status: "succeeded" | "failed";
      exit_code: number | null;
      timestamp: string;
      error?: string;
    };

export interface AnnouncementsResponse {
  records: Record<string, string>[];
  meta: {
    count: number;
    updated_at: string | null;
  };
}

export class BackendApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "BackendApiError";
    this.status = status;
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

export function startScraperJob(token: string): Promise<StartJobResponse> {
  return startJob("scraper", token);
}

export function startJob(jobType: JobType, token: string): Promise<StartJobResponse> {
  return requestJson<StartJobResponse>(
    `/api/jobs/${jobType}`,
    { method: "POST" },
    token,
  );
}

export function getJob(jobId: string, token: string): Promise<JobResponse> {
  return requestJson<JobResponse>(`/api/jobs/${encodeURIComponent(jobId)}`, {}, token);
}

export function fetchAnnouncements(token: string): Promise<AnnouncementsResponse> {
  return requestJson<AnnouncementsResponse>("/api/data/announcements", {}, token);
}

export async function streamJobEvents(
  jobId: string,
  token: string,
  onEvent: (event: JobEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const response = await fetch(
    `${API_BASE_URL}/api/jobs/${encodeURIComponent(jobId)}/events`,
    {
      headers: { Authorization: `Bearer ${token}` },
      signal,
    },
  );

  if (!response.ok) {
    throw new BackendApiError(await readError(response), response.status);
  }
  if (!response.body) {
    throw new BackendApiError("SSE response body is empty", response.status);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const normalized = buffer.replace(/\r\n/g, "\n");
    const parts = normalized.split("\n\n");
    buffer = parts.pop() ?? "";

    for (const part of parts) {
      const dataLines = part
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart());
      if (dataLines.length === 0) continue;
      onEvent(JSON.parse(dataLines.join("\n")) as JobEvent);
    }
  }
}

export const readScraperEvents = streamJobEvents;
