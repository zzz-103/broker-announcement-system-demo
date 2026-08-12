import { BackendApiError, buildApiUrl, readError, requestJson } from "./core";
import type {
  CustomIntelligenceOptionsResponse,
  IntelligenceSearchConfigInput,
  IntelligenceSearchConfigResponse,
  IntelligenceSearchTestResponse,
  IntelligenceAssistantEmailInput,
  IntelligenceAssistantEmailResponse,
  IntelligenceAssistantExecutionResponse,
  IntelligenceAssistantExecutionInput,
  IntelligenceAssistantExecutionsResponse,
  IntelligenceConfirmedPlan,
  IntelligenceQueryPlanResponse,
  IntelligenceAssistantRequest,
  IntelligenceAssistantTopicResponse,
  IntelligenceAssistantTopicsResponse,
  IntelligenceAdminExecutionsResponse,
  IntelligenceAdminExecutionResponse,
  IntelligenceDefaultRulesInput,
  IntelligenceDefaultRulesResponse,
  IntelligenceExecutionDiagnosticsResponse,
  IntelligenceLlmConfigInput,
  IntelligenceLlmConfigResponse,
  IntelligenceReportTemplateStyle,
  IntelligenceSmtpConfigInput,
  IntelligenceSmtpConfigResponse,
} from "./contracts";

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

export async function downloadCustomIntelligenceReportPdf(
  token: string,
  executionId: number,
  templateStyleOrSignal: IntelligenceReportTemplateStyle | AbortSignal = "research",
  signal?: AbortSignal,
): Promise<{ blob: Blob; filename: string | null }> {
  const templateStyle = typeof templateStyleOrSignal === "string" ? templateStyleOrSignal : "research";
  const requestSignal = typeof templateStyleOrSignal === "string" ? signal : templateStyleOrSignal;
  let response: Response;
  try {
    const params = new URLSearchParams({ template_style: templateStyle });
    response = await fetch(
      buildApiUrl(`/api/custom-intelligence/executions/${encodeURIComponent(String(executionId))}/report/pdf?${params.toString()}`),
      {
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
        signal: requestSignal,
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

const assistantPath = (suffix = "") => `/api/custom-intelligence${suffix}`;

export function createAssistantExecution(
  token: string,
  payload: IntelligenceAssistantExecutionInput,
  signal?: AbortSignal,
): Promise<IntelligenceAssistantExecutionResponse> {
  return requestJson<IntelligenceAssistantExecutionResponse>(
    assistantPath("/executions"),
    { method: "POST", body: JSON.stringify(payload), signal },
    token,
  );
}

export function previewAssistantQueryPlan(
  token: string,
  payload: IntelligenceAssistantRequest,
  signal?: AbortSignal,
): Promise<IntelligenceQueryPlanResponse> {
  return requestJson<IntelligenceQueryPlanResponse>(
    assistantPath("/query-plan"),
    { method: "POST", body: JSON.stringify(payload), signal },
    token,
  );
}

export function fetchAssistantExecutions(
  token: string,
  page = 1,
  pageSize = 10,
  signal?: AbortSignal,
): Promise<IntelligenceAssistantExecutionsResponse> {
  const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
  return requestJson<IntelligenceAssistantExecutionsResponse>(
    `${assistantPath("/executions")}?${params.toString()}`,
    { signal },
    token,
  );
}

export function fetchAssistantExecution(
  token: string,
  executionId: number,
  signal?: AbortSignal,
): Promise<IntelligenceAssistantExecutionResponse> {
  return requestJson<IntelligenceAssistantExecutionResponse>(
    assistantPath(`/executions/${encodeURIComponent(String(executionId))}`),
    { signal },
    token,
  );
}

export function rerunAssistantExecution(
  token: string,
  executionId: number,
  confirmedPlan?: IntelligenceConfirmedPlan,
  signal?: AbortSignal,
): Promise<IntelligenceAssistantExecutionResponse> {
  return requestJson<IntelligenceAssistantExecutionResponse>(
    assistantPath(`/executions/${encodeURIComponent(String(executionId))}/rerun`),
    {
      method: "POST",
      body: confirmedPlan ? JSON.stringify({ confirmed_plan: confirmedPlan }) : undefined,
      signal,
    },
    token,
  );
}

export function reanalyzeAssistantExecution(
  token: string,
  executionId: number,
  signal?: AbortSignal,
): Promise<IntelligenceAssistantExecutionResponse> {
  return requestJson<IntelligenceAssistantExecutionResponse>(
    assistantPath(`/executions/${encodeURIComponent(String(executionId))}/reanalyze`),
    { method: "POST", signal },
    token,
  );
}

export function fetchAssistantTopics(
  token: string,
  signal?: AbortSignal,
): Promise<IntelligenceAssistantTopicsResponse> {
  return requestJson<IntelligenceAssistantTopicsResponse>(assistantPath("/topics"), { signal }, token);
}

export function createAssistantTopic(
  token: string,
  payload: IntelligenceAssistantRequest & { name: string },
  signal?: AbortSignal,
): Promise<IntelligenceAssistantTopicResponse> {
  return requestJson<IntelligenceAssistantTopicResponse>(
    assistantPath("/topics"),
    { method: "POST", body: JSON.stringify(payload), signal },
    token,
  );
}

export function updateAssistantTopic(
  token: string,
  topicId: number,
  payload: IntelligenceAssistantRequest & { name: string },
  signal?: AbortSignal,
): Promise<IntelligenceAssistantTopicResponse> {
  return requestJson<IntelligenceAssistantTopicResponse>(
    assistantPath(`/topics/${encodeURIComponent(String(topicId))}`),
    { method: "POST", body: JSON.stringify(payload), signal },
    token,
  );
}

export function deleteAssistantTopic(token: string, topicId: number, signal?: AbortSignal): Promise<{ deleted: boolean; id: number }> {
  return requestJson<{ deleted: boolean; id: number }>(
    assistantPath(`/topics/${encodeURIComponent(String(topicId))}`),
    { method: "DELETE", signal },
    token,
  );
}

export function executeAssistantTopic(
  token: string,
  topicId: number,
  confirmedPlan?: IntelligenceConfirmedPlan,
  signal?: AbortSignal,
): Promise<IntelligenceAssistantExecutionResponse> {
  return requestJson<IntelligenceAssistantExecutionResponse>(
    assistantPath(`/topics/${encodeURIComponent(String(topicId))}/execute`),
    {
      method: "POST",
      body: confirmedPlan ? JSON.stringify({ confirmed_plan: confirmedPlan }) : undefined,
      signal,
    },
    token,
  );
}

export function sendAssistantExecutionEmail(
  token: string,
  executionId: number,
  payload: IntelligenceAssistantEmailInput,
  signal?: AbortSignal,
): Promise<IntelligenceAssistantEmailResponse> {
  return requestJson<IntelligenceAssistantEmailResponse>(
    assistantPath(`/executions/${encodeURIComponent(String(executionId))}/email`),
    { method: "POST", body: JSON.stringify(payload), signal },
    token,
  );
}

export function fetchAdminLlmConfig(token: string, signal?: AbortSignal): Promise<IntelligenceLlmConfigResponse> {
  return requestJson<IntelligenceLlmConfigResponse>("/api/admin/custom-intelligence/llm-config", { signal }, token);
}
export function saveAdminLlmConfig(token: string, payload: IntelligenceLlmConfigInput, signal?: AbortSignal): Promise<IntelligenceLlmConfigResponse> {
  return requestJson<IntelligenceLlmConfigResponse>("/api/admin/custom-intelligence/llm-config", { method: "POST", body: JSON.stringify(payload), signal }, token);
}
export function testAdminLlmConfig(token: string, signal?: AbortSignal): Promise<IntelligenceSearchTestResponse> {
  return requestJson<IntelligenceSearchTestResponse>("/api/admin/custom-intelligence/llm-config/test", { method: "POST", signal }, token);
}
export function revealAdminLlmConfigKey(token: string, password: string, signal?: AbortSignal): Promise<{ api_key: string }> {
  return requestJson<{ api_key: string }>("/api/admin/custom-intelligence/llm-config/reveal-key", { method: "POST", body: JSON.stringify({ password }), signal }, token);
}

export function fetchAdminSmtpConfig(token: string, signal?: AbortSignal): Promise<IntelligenceSmtpConfigResponse> {
  return requestJson<IntelligenceSmtpConfigResponse>("/api/admin/custom-intelligence/smtp-config", { signal }, token);
}
export function saveAdminSmtpConfig(token: string, payload: IntelligenceSmtpConfigInput, signal?: AbortSignal): Promise<IntelligenceSmtpConfigResponse> {
  return requestJson<IntelligenceSmtpConfigResponse>("/api/admin/custom-intelligence/smtp-config", { method: "POST", body: JSON.stringify(payload), signal }, token);
}
export function testAdminSmtpConfig(token: string, signal?: AbortSignal): Promise<IntelligenceSearchTestResponse> {
  return requestJson<IntelligenceSearchTestResponse>("/api/admin/custom-intelligence/smtp-config/test", { method: "POST", signal }, token);
}
export function revealAdminSmtpAuthorizationCode(token: string, adminPassword: string, signal?: AbortSignal): Promise<{ authorization_code: string }> {
  return requestJson<{ authorization_code: string }>("/api/admin/custom-intelligence/smtp-config/reveal-authorization-code", { method: "POST", body: JSON.stringify({ password: adminPassword }), signal }, token);
}

export function fetchAdminDefaultRules(token: string, signal?: AbortSignal): Promise<IntelligenceDefaultRulesResponse> {
  return requestJson<IntelligenceDefaultRulesResponse>("/api/admin/custom-intelligence/default-rules", { signal }, token);
}
export function saveAdminDefaultRules(token: string, payload: IntelligenceDefaultRulesInput, signal?: AbortSignal): Promise<IntelligenceDefaultRulesResponse> {
  return requestJson<IntelligenceDefaultRulesResponse>("/api/admin/custom-intelligence/default-rules", { method: "POST", body: JSON.stringify(payload), signal }, token);
}
export function fetchAdminAssistantExecutions(token: string, page = 1, pageSize = 10, signal?: AbortSignal): Promise<IntelligenceAdminExecutionsResponse> {
  const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
  return requestJson<IntelligenceAdminExecutionsResponse>(`/api/admin/custom-intelligence/executions?${params.toString()}`, { signal }, token);
}
export function fetchAdminUserAssistantExecutions(token: string, ownerUserId: number, page = 1, pageSize = 10, signal?: AbortSignal): Promise<IntelligenceAdminExecutionsResponse> {
  const params = new URLSearchParams({ owner_user_id: String(ownerUserId), page: String(page), page_size: String(pageSize) });
  return requestJson<IntelligenceAdminExecutionsResponse>(`/api/admin/custom-intelligence/executions?${params.toString()}`, { signal }, token);
}
export function fetchAdminAssistantExecution(token: string, executionId: number, signal?: AbortSignal): Promise<IntelligenceAdminExecutionResponse> {
  return requestJson<IntelligenceAdminExecutionResponse>(`/api/admin/custom-intelligence/executions/${encodeURIComponent(String(executionId))}`, { signal }, token);
}
export function fetchAdminExecutionDiagnostics(token: string, executionId: number, signal?: AbortSignal): Promise<IntelligenceExecutionDiagnosticsResponse> {
  return requestJson<IntelligenceExecutionDiagnosticsResponse>(`/api/admin/custom-intelligence/executions/${encodeURIComponent(String(executionId))}/diagnostics`, { signal }, token);
}
