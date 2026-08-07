import { BackendApiError, buildApiUrl, readError, requestJson } from "./core";
import type {
  CustomIntelligenceExecutionResponse,
  CustomIntelligenceExecutionsResponse,
  CustomIntelligenceOptionsResponse,
  CustomIntelligenceTopicResponse,
  CustomIntelligenceTopicsResponse,
  InstantSearchRequest,
  IntelligenceSearchConfigInput,
  IntelligenceSearchConfigResponse,
  IntelligenceSearchTestResponse,
  IntelligenceTopic,
  KeywordSuggestionRequest,
  KeywordSuggestionsResponse,
} from "./contracts";

type TopicPayload = Omit<IntelligenceTopic, "id" | "enabled" | "created_at" | "updated_at">;

export function fetchCustomIntelligenceOptions(
  token: string,
  signal?: AbortSignal,
): Promise<CustomIntelligenceOptionsResponse> {
  return requestJson<CustomIntelligenceOptionsResponse>(
    "/api/custom-intelligence/options",
    { signal },
    token,
  );
}

export function fetchAdminSearchConfig(
  token: string,
  signal?: AbortSignal,
): Promise<IntelligenceSearchConfigResponse> {
  return requestJson<IntelligenceSearchConfigResponse>(
    "/api/admin/custom-intelligence/search-config",
    { signal },
    token,
  );
}

export function saveAdminSearchConfig(
  token: string,
  payload: IntelligenceSearchConfigInput,
  signal?: AbortSignal,
): Promise<IntelligenceSearchConfigResponse> {
  return requestJson<IntelligenceSearchConfigResponse>(
    "/api/admin/custom-intelligence/search-config",
    { method: "POST", body: JSON.stringify(payload), signal },
    token,
  );
}

export function testAdminSearchConfig(
  token: string,
  signal?: AbortSignal,
): Promise<IntelligenceSearchTestResponse> {
  return requestJson<IntelligenceSearchTestResponse>(
    "/api/admin/custom-intelligence/search-config/test",
    { method: "POST", signal },
    token,
  );
}

export function revealAdminSearchConfigKey(
  token: string,
  password: string,
  signal?: AbortSignal,
): Promise<{ api_key: string }> {
  return requestJson<{ api_key: string }>(
    "/api/admin/custom-intelligence/search-config/reveal-key",
    { method: "POST", body: JSON.stringify({ password }), signal },
    token,
  );
}

export function suggestCustomIntelligenceKeywords(
  token: string,
  payload: KeywordSuggestionRequest,
  signal?: AbortSignal,
): Promise<KeywordSuggestionsResponse> {
  return requestJson<KeywordSuggestionsResponse>(
    "/api/custom-intelligence/keyword-suggestions",
    { method: "POST", body: JSON.stringify(payload), signal },
    token,
  );
}

export function fetchCustomIntelligenceTopics(
  token: string,
  signal?: AbortSignal,
): Promise<CustomIntelligenceTopicsResponse> {
  return requestJson<CustomIntelligenceTopicsResponse>(
    "/api/custom-intelligence/topics",
    { signal },
    token,
  );
}

export function createCustomIntelligenceTopic(
  token: string,
  payload: TopicPayload,
  signal?: AbortSignal,
): Promise<CustomIntelligenceTopicResponse> {
  return requestJson<CustomIntelligenceTopicResponse>(
    "/api/custom-intelligence/topics",
    { method: "POST", body: JSON.stringify(payload), signal },
    token,
  );
}

export function fetchCustomIntelligenceTopic(
  token: string,
  topicId: number,
  signal?: AbortSignal,
): Promise<CustomIntelligenceTopicResponse> {
  return requestJson<CustomIntelligenceTopicResponse>(
    `/api/custom-intelligence/topics/${encodeURIComponent(String(topicId))}`,
    { signal },
    token,
  );
}

export function updateCustomIntelligenceTopic(
  token: string,
  topicId: number,
  payload: TopicPayload,
  signal?: AbortSignal,
): Promise<CustomIntelligenceTopicResponse> {
  return requestJson<CustomIntelligenceTopicResponse>(
    `/api/custom-intelligence/topics/${encodeURIComponent(String(topicId))}`,
    { method: "POST", body: JSON.stringify(payload), signal },
    token,
  );
}

export function setCustomIntelligenceTopicEnabled(
  token: string,
  topicId: number,
  enabled: boolean,
  signal?: AbortSignal,
): Promise<CustomIntelligenceTopicResponse> {
  return requestJson<CustomIntelligenceTopicResponse>(
    `/api/custom-intelligence/topics/${encodeURIComponent(String(topicId))}/enabled`,
    { method: "POST", body: JSON.stringify({ enabled }), signal },
    token,
  );
}

export function deleteCustomIntelligenceTopic(
  token: string,
  topicId: number,
  signal?: AbortSignal,
): Promise<{ deleted: boolean; id: number }> {
  return requestJson<{ deleted: boolean; id: number }>(
    `/api/custom-intelligence/topics/${encodeURIComponent(String(topicId))}`,
    { method: "DELETE", signal },
    token,
  );
}

export function executeCustomIntelligenceTopic(
  token: string,
  topicId: number,
  signal?: AbortSignal,
): Promise<CustomIntelligenceExecutionResponse> {
  return requestJson<CustomIntelligenceExecutionResponse>(
    `/api/custom-intelligence/topics/${encodeURIComponent(String(topicId))}/execute`,
    { method: "POST", signal },
    token,
  );
}

export function fetchCustomIntelligenceExecutions(
  token: string,
  page = 1,
  pageSize = 20,
  signal?: AbortSignal,
): Promise<CustomIntelligenceExecutionsResponse> {
  const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
  return requestJson<CustomIntelligenceExecutionsResponse>(
    `/api/custom-intelligence/executions?${params.toString()}`,
    { signal },
    token,
  );
}

export function createCustomIntelligenceExecution(
  token: string,
  payload: InstantSearchRequest,
  signal?: AbortSignal,
): Promise<CustomIntelligenceExecutionResponse> {
  return requestJson<CustomIntelligenceExecutionResponse>(
    "/api/custom-intelligence/executions",
    { method: "POST", body: JSON.stringify(payload), signal },
    token,
  );
}

export function fetchCustomIntelligenceExecution(
  token: string,
  executionId: number,
  signal?: AbortSignal,
): Promise<CustomIntelligenceExecutionResponse> {
  return requestJson<CustomIntelligenceExecutionResponse>(
    `/api/custom-intelligence/executions/${encodeURIComponent(String(executionId))}`,
    { signal },
    token,
  );
}

export function rerunCustomIntelligenceExecution(
  token: string,
  executionId: number,
  signal?: AbortSignal,
): Promise<CustomIntelligenceExecutionResponse> {
  return requestJson<CustomIntelligenceExecutionResponse>(
    `/api/custom-intelligence/executions/${encodeURIComponent(String(executionId))}/rerun`,
    { method: "POST", signal },
    token,
  );
}

export function reanalyzeCustomIntelligenceExecution(
  token: string,
  executionId: number,
  signal?: AbortSignal,
): Promise<CustomIntelligenceExecutionResponse> {
  return requestJson<CustomIntelligenceExecutionResponse>(
    `/api/custom-intelligence/executions/${encodeURIComponent(String(executionId))}/reanalyze`,
    { method: "POST", signal },
    token,
  );
}

export async function downloadCustomIntelligenceReportPdf(
  token: string,
  executionId: number,
  signal?: AbortSignal,
): Promise<{ blob: Blob; filename: string | null }> {
  let response: Response;
  try {
    response = await fetch(
      buildApiUrl(`/api/custom-intelligence/executions/${encodeURIComponent(String(executionId))}/report/pdf`),
      {
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
        signal,
      },
    );
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new BackendApiError("无法访问后端 API", 0);
  }
  if (!response.ok) throw new BackendApiError(await readError(response), response.status);
  const disposition = response.headers.get("Content-Disposition") || "";
  let filename: string | null = null;
  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match) {
    try {
      filename = decodeURIComponent(utf8Match[1]);
    } catch {
      filename = null;
    }
  }
  return { blob: await response.blob(), filename };
}
