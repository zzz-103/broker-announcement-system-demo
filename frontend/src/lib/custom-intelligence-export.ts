import type { CustomIntelligenceExecution } from "./api/contracts";

export const CUSTOM_INTELLIGENCE_EXPORT_FILE_PREFIX = "custom-intelligence-executions";
export const CUSTOM_INTELLIGENCE_CSV_FILENAME = `${CUSTOM_INTELLIGENCE_EXPORT_FILE_PREFIX}.csv`;
export const CUSTOM_INTELLIGENCE_JSON_FILENAME = `${CUSTOM_INTELLIGENCE_EXPORT_FILE_PREFIX}.json`;

const CSV_HEADERS = [
  "ID",
  "主题",
  "状态",
  "触发类型",
  "问题",
  "来源数",
  "创建时间",
  "开始时间",
  "完成时间",
  "错误信息",
  "报告标题",
] as const;

const SENSITIVE_KEY_PATTERN = /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|password|secret|cookie|token)/i;

function executionQuestion(execution: CustomIntelligenceExecution): string {
  return execution.original_query || (typeof execution.snapshot.question === "string" ? execution.snapshot.question : "");
}

function reportTitle(execution: CustomIntelligenceExecution): string {
  return typeof execution.report?.title === "string" ? execution.report.title : "";
}

function csvField(value: string | number | null): string {
  const text = value === null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function buildCsv(executions: readonly CustomIntelligenceExecution[]): string {
  const rows = executions.map((execution) => [
    execution.id,
    execution.topic_name,
    execution.status,
    execution.trigger_type,
    executionQuestion(execution),
    execution.sources.length,
    execution.created_at,
    execution.started_at,
    execution.completed_at,
    execution.error_message,
    reportTitle(execution),
  ]);
  return [
    CSV_HEADERS.map(csvField).join(","),
    ...rows.map((row) => row.map(csvField).join(",")),
  ].join("\r\n");
}

function removeSensitiveKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(removeSensitiveKeys);
  if (!value || typeof value !== "object") return value;

  const result: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    if (!SENSITIVE_KEY_PATTERN.test(key)) result[key] = removeSensitiveKeys(nestedValue);
  }
  return result;
}

function downloadBlob(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  if (document.body) document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportCustomIntelligenceCsv(
  executions: readonly CustomIntelligenceExecution[],
): void {
  downloadBlob(`\uFEFF${buildCsv(executions)}`, CUSTOM_INTELLIGENCE_CSV_FILENAME, "text/csv;charset=utf-8");
}

export function exportCustomIntelligenceJson(
  executions: readonly CustomIntelligenceExecution[],
): void {
  const safeExecutions = executions.map((execution) => removeSensitiveKeys(execution));
  downloadBlob(JSON.stringify(safeExecutions, null, 2), CUSTOM_INTELLIGENCE_JSON_FILENAME, "application/json;charset=utf-8");
}
