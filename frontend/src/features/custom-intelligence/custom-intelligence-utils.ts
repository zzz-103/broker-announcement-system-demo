import { BackendApiError, getApiBaseUrlLabel } from "@/lib/api/backend-client";
import type {
  CustomIntelligenceExecution,
  CustomIntelligenceExecutionStatus,
  CustomIntelligenceOptionsResponse,
  IntelligenceAnalysisDepth,
  IntelligenceTopic,
  InstantSearchRequest,
} from "@/lib/api/contracts";

export function isActiveExecution(status: CustomIntelligenceExecutionStatus): boolean {
  return status === "pending" || status === "running";
}

export function canSaveExecutionAsConfig(execution: CustomIntelligenceExecution): boolean {
  return execution.status === "succeeded"
    && execution.topic_id === null
    && execution.trigger_type !== "topic";
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.replace("T", " ").slice(0, 16);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatExecutionDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.replace("T", " ").slice(0, 16);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function errorMessage(error: unknown, fallback = "操作失败，请稍后重试"): string {
  if (!(error instanceof BackendApiError)) {
    return error instanceof Error && error.message ? error.message : fallback;
  }
  if (error.status === 0) return `无法访问后端服务（${getApiBaseUrlLabel()}），请检查服务状态后重试。`;
  if (error.status === 401) return "登录已失效，请重新登录。";
  if (error.status === 403) return "当前账号没有执行自定义情报的权限。";
  if (error.status === 409) return error.message || "当前已有情报执行正在进行，请稍后再试。";
  if (error.status === 404) return `自定义情报接口不可用，请确认前后端版本一致：${error.message || "请检查接口配置"}`;
  if (error.status === 422) return `请求参数有误：${error.message || "请检查表单内容"}`;
  if (error.status === 502) {
    if (/欠费|账单逾期|account_overdue/i.test(error.message)) return "搜索服务不可用：账户欠费或账单逾期，请联系管理员处理后重试。";
    if (/HTTP (401|403)\b/.test(error.message)) return "搜索服务鉴权失败，请检查服务端配置后重试。";
    return error.message || "上游服务暂时不可用，请稍后重试。";
  }
  if (error.status === 429) return "服务已达频率或额度限制，请稍后重试。";
  if (error.status === 503) return error.message || "服务尚未配置，请联系管理员。";
  if (error.status === 504) return error.message || "服务请求超时，请稍后重试。";
  if (error.status === 500) return `后端处理失败，请查看服务日志后重试：${error.message || ""}`.trim();
  return error.message || fallback;
}

export function safeHttpUrl(value: string): string | null {
  const trimmed = value.trim();
  return /^https?:\/\/[^\s]+$/i.test(trimmed) ? trimmed : null;
}

export function mergeExecution(
  list: CustomIntelligenceExecution[],
  incoming: CustomIntelligenceExecution,
): CustomIntelligenceExecution[] {
  const index = list.findIndex((item) => item.id === incoming.id);
  if (index < 0) return [incoming, ...list];
  const next = [...list];
  next[index] = incoming;
  return next;
}

export function formFromTopic(topic: IntelligenceTopic): InstantSearchRequest {
  return {
    question: topic.question || "",
    description: topic.description,
    keywords: [...topic.keywords],
    focus_objects: [...topic.focus_objects],
    analysis_perspective: topic.analysis_perspective,
    time_range: topic.time_range,
    source_preference: topic.source_preference,
    specified_sites: [...topic.specified_sites],
    report_type: topic.report_type,
    analysis_depth: topic.analysis_depth,
    extra_requirements: topic.extra_requirements,
  };
}

export function formFromExecution(execution: CustomIntelligenceExecution): InstantSearchRequest {
  const snapshot = execution.snapshot;
  return {
    question: snapshot.question || execution.original_query || "",
    description: snapshot.description || "",
    keywords: [...(snapshot.keywords ?? [])],
    focus_objects: [...(snapshot.focus_objects ?? [])],
    analysis_perspective: snapshot.analysis_perspective ?? "industry_research",
    time_range: snapshot.time_range ?? "month",
    source_preference: snapshot.source_preference ?? "balanced",
    specified_sites: [...(snapshot.specified_sites ?? [])],
    report_type: snapshot.report_type ?? "industry_trends",
    analysis_depth: snapshot.analysis_depth ?? "standard",
    extra_requirements: snapshot.extra_requirements || "",
  };
}

export function optionLabel(
  options: readonly { value: string; label: string }[],
  value: string | undefined,
): string {
  return options.find((item) => item.value === value)?.label ?? "—";
}

export function maxSourcesForDepth(
  options: CustomIntelligenceOptionsResponse,
  depth: string | undefined,
): number {
  const sourceLimits: Partial<Record<IntelligenceAnalysisDepth, number>> = options.max_sources_by_depth ?? {};
  const selected = depth ? sourceLimits[depth as IntelligenceAnalysisDepth] : undefined;
  return selected ?? sourceLimits.standard ?? 20;
}

export function sourceCountLabel(
  execution: CustomIntelligenceExecution,
  options: CustomIntelligenceOptionsResponse,
): string {
  return `${execution.sources.length}/${maxSourcesForDepth(options, execution.snapshot.analysis_depth)} 条来源`;
}

export type ReportPhase =
  | "queued"
  | "searching"
  | "analyzing"
  | "done"
  | "empty"
  | "search_failed"
  | "analysis_failed";

export function getReportPhase(execution: CustomIntelligenceExecution): ReportPhase {
  if (execution.status === "empty") return "empty";
  if (execution.search_status === "failed") return "search_failed";
  if (execution.status === "failed" && execution.search_status !== "succeeded") return "search_failed";
  if (execution.search_status === "succeeded" && execution.analysis_status === "failed") return "analysis_failed";
  if (execution.status === "succeeded") return "done";
  if (execution.search_status === "succeeded") return "analyzing";
  return execution.status === "running" ? "searching" : "queued";
}

export const PHASE_CHIP: Record<ReportPhase, { label: string; className: string }> = {
  queued: { label: "排队中", className: "bg-slate-100 text-slate-600" },
  searching: { label: "正在检索", className: "bg-blue-50 text-blue-700" },
  analyzing: { label: "正在生成报告", className: "bg-amber-50 text-amber-700" },
  done: { label: "已完成", className: "bg-emerald-50 text-emerald-700" },
  empty: { label: "无结果", className: "bg-slate-100 text-slate-600" },
  search_failed: { label: "检索失败", className: "bg-red-50 text-red-700" },
  analysis_failed: { label: "分析失败", className: "bg-amber-50 text-amber-700" },
};

export type StepState = "done" | "active" | "pending" | "failed";
