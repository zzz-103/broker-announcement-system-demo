import { requestJson } from "./core";
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
