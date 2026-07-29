import { BackendApiError, SseParseError, buildApiUrl, readError, requestJson } from "./core";
import type { JobEvent, JobResponse, JobType, StartJobResponse } from "./contracts";

export interface StartLlmJobOptions {
  mode?: "incremental" | "full_refresh";
  overwrite?: boolean;
}

export function startScraperJob(token: string): Promise<StartJobResponse> {
  return startJob("scraper", token);
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

export function startAppWatchJob(token: string): Promise<StartJobResponse> {
  return startJob("app-watch", token);
}

export function getJob(jobId: string, token: string): Promise<JobResponse> {
  return requestJson<JobResponse>(`/api/jobs/${encodeURIComponent(jobId)}`, {}, token);
}

export function cancelJob(
  jobId: string,
  token: string,
): Promise<{ status: string; message?: string }> {
  return requestJson<{ status: string; message?: string }>(
    `/api/jobs/${encodeURIComponent(jobId)}/cancel`,
    { method: "POST" },
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
  const response = await fetch(buildApiUrl(`/api/jobs/${encodeURIComponent(jobId)}/events`), {
    headers: { Accept: "text/event-stream", Authorization: `Bearer ${token}` },
    signal,
  });
  if (!response.ok) throw new BackendApiError(await readError(response), response.status);
  options.onOpen?.(response);
  if (!response.body) throw new BackendApiError("SSE response body is empty", response.status);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const handleAbort = () => { void reader.cancel(); };
  if (signal.aborted) {
    handleAbort();
    return;
  }
  signal.addEventListener("abort", handleAbort);
  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      options.onChunk?.();
      buffer += decoder.decode(value, { stream: true });
      buffer = drainSseBuffer(buffer, onEvent, options.onParseError);
    }
    if (buffer.trim()) drainSseBuffer(`${buffer}\n\n`, onEvent, options.onParseError);
  } finally {
    signal.removeEventListener("abort", handleAbort);
  }
}

function drainSseBuffer(
  input: string,
  onEvent: (event: JobEvent) => void,
  onParseError?: (error: SseParseError) => void,
): string {
  const parts = input.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n\n");
  const remainder = parts.pop() ?? "";
  for (const part of parts) {
    const dataLines = part
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart());
    if (!dataLines.length) continue;
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
