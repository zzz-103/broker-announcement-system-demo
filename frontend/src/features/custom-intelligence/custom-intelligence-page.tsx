"use client";

import {
  AlertCircle,
  Bookmark,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  FileText,
  Loader2,
  Play,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/auth-store";
import { LoginPageWithApply } from "@/components/login-page-with-apply";
import { DashboardHeader } from "@/components/dashboard-header";
import { HoverSelect } from "@/components/hover-select";
import { BackendApiError, getApiBaseUrlLabel, isAbortError } from "@/lib/api/backend-client";
import { exportCustomIntelligenceCsv, exportCustomIntelligenceJson } from "@/lib/custom-intelligence-export";
import {
  createCustomIntelligenceExecution,
  createCustomIntelligenceTopic,
  executeCustomIntelligenceTopic,
  fetchCustomIntelligenceExecution,
  fetchCustomIntelligenceExecutions,
  fetchCustomIntelligenceOptions,
  fetchCustomIntelligenceTopic,
  fetchCustomIntelligenceTopics,
  reanalyzeCustomIntelligenceExecution,
  rerunCustomIntelligenceExecution,
  setCustomIntelligenceTopicEnabled,
  suggestCustomIntelligenceKeywords,
  updateCustomIntelligenceTopic,
} from "@/lib/api/custom-intelligence";
import type {
  CustomIntelligenceExecution,
  CustomIntelligenceOptionsResponse,
  CustomIntelligenceExecutionStatus,
  IntelligenceTopic,
  InstantSearchRequest,
  IntelligenceAnalysisDepth,
  IntelligenceReport,
  IntelligenceReportType,
  IntelligenceSource,
  IntelligencePerspective,
  IntelligenceSourcePreference,
  IntelligenceTimeRange,
} from "@/lib/api/contracts";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  CustomIntelligenceTabs,
  ExecutionList,
  TopicList,
  type CustomIntelligenceTab,
} from "@/features/custom-intelligence/custom-intelligence-sections";

type ActiveTab = CustomIntelligenceTab;

const DEFAULT_FORM: InstantSearchRequest = {
  question: "",
  description: "",
  keywords: [],
  focus_objects: [],
  analysis_perspective: "industry_research",
  time_range: "month",
  source_preference: "balanced",
  specified_sites: [],
  report_type: "industry_trends",
  analysis_depth: "standard",
  extra_requirements: "",
};

const FALLBACK_OPTIONS: CustomIntelligenceOptionsResponse = {
  perspectives: [
    { value: "management", label: "管理层视角" },
    { value: "product_business", label: "产品与业务视角" },
    { value: "technology", label: "技术视角" },
    { value: "compliance_risk", label: "合规与风险视角" },
    { value: "industry_research", label: "行业研究视角" },
  ],
  time_ranges: [
    { value: "week", label: "最近 7 天" },
    { value: "month", label: "最近 30 天" },
    { value: "semiyear", label: "最近 180 天" },
    { value: "year", label: "最近 365 天" },
  ],
  report_types: [
    { value: "management_brief", label: "管理层简报" },
    { value: "competitive_analysis", label: "竞争分析" },
    { value: "industry_trends", label: "行业动态" },
    { value: "risk_monitoring", label: "风险监控" },
  ],
  analysis_depths: [
    { value: "concise", label: "简洁" },
    { value: "standard", label: "标准" },
    { value: "deep", label: "深入" },
  ],
  source_preferences: [
    { value: "authoritative", label: "权威来源优先" },
    { value: "balanced", label: "综合平衡" },
    { value: "news", label: "新闻与公告优先" },
    { value: "research", label: "研究资料优先" },
  ],
  preset_questions: [],
  service_configured: true,
  service_enabled: true,
  service_status: "enabled",
  deep_search_enabled: false,
  analysis_configured: true,
  analysis_service_status: "configured",
};

const FIELD_INPUT_CLASS = "w-full rounded-md border border-[#D0D5DD] bg-white px-3 py-2.5 text-sm text-[#172033] outline-none transition placeholder:text-[#98A2B3] focus:border-[#4F7CFF] focus:ring-2 focus:ring-[#4F7CFF]/15";
const REPORT_HEADING_CLASS = "mb-2 text-sm font-bold text-[#243B61]";

function isActiveExecution(status: CustomIntelligenceExecutionStatus): boolean {
  return status === "pending" || status === "running";
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.replace("T", " ").slice(0, 16);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function errorMessage(error: unknown, fallback = "操作失败，请稍后重试"): string {
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
    return "搜索服务暂时不可用，请稍后重试。";
  }
  if (error.status === 429) return "搜索服务已达频率或额度限制，请稍后重试。";
  if (error.status === 503) return "搜索服务尚未配置，请联系管理员。";
  if (error.status === 504) return "搜索服务请求超时，请稍后重试。";
  if (error.status === 500) return `后端处理失败，请查看服务日志后重试：${error.message || ""}`.trim();
  return error.message || fallback;
}

function safeHttpUrl(value: string): string | null {
  const trimmed = value.trim();
  return /^https?:\/\/[^\s]+$/i.test(trimmed) ? trimmed : null;
}

function mergeExecution(
  list: CustomIntelligenceExecution[],
  incoming: CustomIntelligenceExecution,
): CustomIntelligenceExecution[] {
  const index = list.findIndex((item) => item.id === incoming.id);
  if (index < 0) return [incoming, ...list];
  const next = [...list];
  next[index] = incoming;
  return next;
}

function FieldLabel({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="mb-1.5 flex items-center justify-between gap-2">
      <label className="text-xs font-semibold text-[#344054]">{children}</label>
      {hint && <span className="text-[10px] text-[#98A2B3]">{hint}</span>}
    </div>
  );
}

function TagEditor({
  label,
  values,
  placeholder,
  onChange,
  hint,
}: {
  label: string;
  values: string[];
  placeholder: string;
  onChange: (values: string[]) => void;
  hint?: string;
}) {
  const [draft, setDraft] = useState("");
  const add = useCallback(() => {
    const value = draft.trim();
    if (!value || values.includes(value)) {
      setDraft("");
      return;
    }
    onChange([...values, value]);
    setDraft("");
  }, [draft, onChange, values]);
  return (
    <div>
      <FieldLabel hint={hint}>{label}</FieldLabel>
      <div className="min-h-10 rounded-md border border-[#D0D5DD] bg-white px-2 py-1.5 focus-within:border-[#4F7CFF] focus-within:ring-2 focus-within:ring-[#4F7CFF]/10">
        <div className="flex flex-wrap gap-1.5">
          {values.map((value) => (
            <span key={value} className="inline-flex max-w-full items-center gap-1 rounded-md bg-[#EEF4FF] px-2 py-1 text-[11px] font-medium text-[#315EA8]">
              <span className="truncate">{value}</span>
              <button type="button" onClick={() => onChange(values.filter((item) => item !== value))} className="rounded p-0.5 text-[#6B8BC7] hover:bg-[#DCE8FF] hover:text-[#1D4ED8]" aria-label={`移除${value}`}>
                <X className="size-3" />
              </button>
            </span>
          ))}
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === "," || event.key === "，") {
                event.preventDefault();
                add();
              }
            }}
            onBlur={add}
            placeholder={values.length ? "继续添加…" : placeholder}
            className="min-w-[120px] flex-1 border-0 bg-transparent px-1 py-1 text-xs text-[#172033] outline-none placeholder:text-[#98A2B3]"
          />
        </div>
      </div>
      <p className="mt-1 text-[10px] text-[#98A2B3]">按 Enter 添加，可重复点击标签右侧删除。</p>
    </div>
  );
}

function ConfigFields({
  value,
  onChange,
  options,
  showQuestion = true,
  advancedDefaultOpen = false,
}: {
  value: InstantSearchRequest;
  onChange: (value: InstantSearchRequest) => void;
  options: CustomIntelligenceOptionsResponse;
  showQuestion?: boolean;
  advancedDefaultOpen?: boolean;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(advancedDefaultOpen);
  const update = <K extends keyof InstantSearchRequest>(key: K, next: InstantSearchRequest[K]) => {
    onChange({ ...value, [key]: next });
  };
  const recommendedQuestions = options.preset_questions.filter(
    (preset) => preset.analysis_perspective === value.analysis_perspective,
  );
  return (
    <div className="space-y-4">
      {showQuestion && (
        <div>
          <FieldLabel hint="必填">业务问题</FieldLabel>
          <textarea
            id="custom-intelligence-question"
            value={value.question}
            onChange={(event) => update("question", event.target.value)}
            rows={3}
            maxLength={1000}
            placeholder="例如：近期券商财富管理业务的竞争变化和潜在机会有哪些？"
            className="w-full resize-y rounded-md border border-[#D0D5DD] bg-white px-3 py-2.5 text-sm leading-6 text-[#172033] outline-none transition focus:border-[#4F7CFF] focus:ring-2 focus:ring-[#4F7CFF]/15"
          />
          <div className="mt-1 text-right text-[10px] text-[#98A2B3]">{value.question.length}/1000</div>
          <div className="mt-3">
            <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-[#475467]">
              常用查询
            </div>
            {recommendedQuestions.length ? (
              <div className="flex flex-wrap gap-2">
                {recommendedQuestions.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => onChange({
                      ...value,
                      question: preset.question,
                      report_type: preset.report_type,
                    })}
                    className="max-w-full rounded-md border border-[#E4EAF2] bg-[#F8FAFC] px-3 py-2 text-left text-[11px] leading-5 text-[#475467] transition hover:border-[#9FB9E8] hover:bg-[#EEF4FF] hover:text-[#315EA8]"
                    title={preset.question}
                  >
                    <span className="font-semibold text-[#315EA8]">{preset.title}</span>
                    <span className="ml-1.5">{preset.question}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-[#98A2B3]">当前角度暂无常用查询。</p>
            )}
          </div>
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <FieldLabel>分析角度</FieldLabel>
          <HoverSelect
            value={value.analysis_perspective}
            onChange={(next) => update("analysis_perspective", next as IntelligencePerspective)}
            options={options.perspectives}
            className="w-full"
          />
        </div>
        <div>
          <FieldLabel>时间范围</FieldLabel>
          <HoverSelect
            value={value.time_range}
            onChange={(next) => update("time_range", next as IntelligenceTimeRange)}
            options={options.time_ranges}
            className="w-full"
          />
        </div>
      </div>
      <details
        open={advancedOpen}
        onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
        className="group rounded-lg border border-[#E4EAF2] bg-[#F8FAFD] px-3.5 py-3"
      >
        <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-semibold text-[#344054]">
          <span className="inline-flex items-center gap-1.5"><ChevronDown className="size-4 transition group-open:rotate-180" />高级设置</span>
          <span className="text-[10px] font-normal text-[#98A2B3]">报告、来源、关键词等</span>
        </summary>
        <div className="mt-3 space-y-4 border-t border-[#E4EAF2] pt-3">
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <FieldLabel>报告类型</FieldLabel>
              <HoverSelect
                value={value.report_type}
                onChange={(next) => update("report_type", next as IntelligenceReportType)}
                options={options.report_types}
                className="w-full"
              />
            </div>
            <div>
              <FieldLabel>分析深度</FieldLabel>
              <HoverSelect
                value={value.analysis_depth}
                onChange={(next) => update("analysis_depth", next as IntelligenceAnalysisDepth)}
                options={options.analysis_depths}
                className="w-full"
              />
            </div>
            <div>
              <FieldLabel>来源偏好</FieldLabel>
              <HoverSelect
                value={value.source_preference}
                onChange={(next) => update("source_preference", next as IntelligenceSourcePreference)}
                options={options.source_preferences}
                className="w-full"
              />
            </div>
          </div>
          <div>
            <FieldLabel hint="可选">业务背景</FieldLabel>
            <input value={value.description} onChange={(event) => update("description", event.target.value)} maxLength={2000} placeholder="补充业务背景、判断边界或关注原因" className={FIELD_INPUT_CLASS} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <TagEditor label="检索关键词" values={value.keywords} onChange={(next) => update("keywords", next)} placeholder="例如：财富管理" />
            <TagEditor label="关注对象" values={value.focus_objects} onChange={(next) => update("focus_objects", next)} placeholder="例如：头部券商、投顾团队" />
          </div>
          <TagEditor label="指定站点" values={value.specified_sites} onChange={(next) => update("specified_sites", next)} placeholder="例如：csrc.gov.cn" hint="仅填写域名；提交时再次校验" />
          <div>
            <FieldLabel hint="可选">补充要求</FieldLabel>
            <textarea value={value.extra_requirements} onChange={(event) => update("extra_requirements", event.target.value)} rows={3} maxLength={2000} placeholder="例如：结论要区分已发生事实与推测，并给出可执行的跟进建议。" className="w-full resize-y rounded-md border border-[#D0D5DD] bg-white px-3 py-2.5 text-sm leading-6 text-[#172033] outline-none transition focus:border-[#4F7CFF] focus:ring-2 focus:ring-[#4F7CFF]/15" />
          </div>
        </div>
      </details>
    </div>
  );
}

function TextList({ items, empty = "暂无" }: { items: string[] | undefined; empty?: string }) {
  const values = (items ?? []).filter(Boolean);
  if (!values.length) return <span className="text-sm text-[#98A2B3]">{empty}</span>;
  return <ul className="space-y-1.5">{values.map((item, index) => <li key={`${item}-${index}`} className="flex gap-2 text-sm leading-6 text-[#344054]"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-[#7699D7]" /> <span className="whitespace-pre-wrap break-words">{item}</span></li>)}</ul>;
}

function SourceCard({ source, index }: { source: IntelligenceSource; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const url = safeHttpUrl(source.url);
  const snippet = source.snippet?.trim();
  return (
    <article id={`report-source-${source.id}`} className="scroll-mt-24 rounded-lg border border-[#E4EAF2] bg-white p-4">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start gap-2">
            <span className="shrink-0 rounded bg-[#F2F4F7] px-1.5 py-0.5 text-[10px] font-semibold text-[#667085]">{index}</span>
            <h4 className="min-w-0 break-words text-sm font-semibold leading-6 text-[#243B61]">{source.title || "未命名来源"}</h4>
          </div>
          <p className="mt-1 text-[11px] leading-5 text-[#667085]">{source.site_name || "未知站点"}{source.date ? ` · ${source.date}` : ""}</p>
        </div>
        {url ? (
          <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[#C8D7F0] bg-white px-2.5 py-1.5 text-[11px] font-semibold text-[#315EA8] hover:bg-[#EEF4FF]">
            <ExternalLink className="size-3.5" aria-hidden="true" />打开原文
          </a>
        ) : (
          <span className="shrink-0 text-[10px] text-[#98A2B3]">链接不可用</span>
        )}
      </div>
      {snippet && (
        <div className="mt-3">
          <p className={`whitespace-pre-wrap break-words text-sm leading-6 text-[#667085] ${expanded ? "" : "line-clamp-3"}`}>{snippet}</p>
          <button type="button" onClick={() => setExpanded((current) => !current)} className="mt-1.5 inline-flex items-center gap-1 rounded-md text-[11px] font-semibold text-[#315EA8] hover:text-[#1D4ED8]">
            {expanded ? <ChevronUp className="size-3.5" aria-hidden="true" /> : <ChevronDown className="size-3.5" aria-hidden="true" />}
            {expanded ? "收起摘要" : "展开摘要"}
          </button>
        </div>
      )}
    </article>
  );
}

function SourceBadge({
  sourceId,
  source,
  index,
}: {
  sourceId: string;
  source?: IntelligenceSource;
  index?: number;
}) {
  if (!source) {
    return <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">来源 {index ?? "?"}（未匹配）</span>;
  }
  return (
    <button
      type="button"
      onClick={() => document.getElementById(`report-source-${sourceId}`)?.scrollIntoView({ behavior: "smooth", block: "start" })}
      title={`定位到来源：${source.title || "未命名来源"}`}
      className="max-w-full min-w-0 truncate rounded border border-[#C8D7F0] bg-white px-1.5 py-0.5 text-[10px] text-[#315EA8] hover:bg-[#EEF4FF]"
    >
      来源 {index ?? "?"} · {source.title || "来源"}
    </button>
  );
}

function DynamicCard({
  dynamic,
  index,
  sourceMap,
  sourceIndexes,
}: {
  dynamic: IntelligenceReport["key_dynamics"][number];
  index: number;
  sourceMap: Map<string, IntelligenceSource>;
  sourceIndexes: Map<string, number>;
}) {
  const sourceIds = dynamic.source_ids ?? [];
  return (
    <article className="min-w-0 rounded-lg border border-[#E4EAF2] bg-[#FBFCFE] p-4">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <h4 className="min-w-0 break-words text-sm font-bold leading-6 text-[#243B61]">{dynamic.title || `动态 ${index + 1}`}</h4>
        {dynamic.information_time ? <span className="shrink-0 text-[11px] leading-5 text-[#98A2B3]">{dynamic.information_time}</span> : null}
      </div>
      {dynamic.institutions?.length ? (
        <p className="mt-1.5 text-xs leading-5 text-[#667085]">涉及机构：{dynamic.institutions.join("、")}</p>
      ) : null}
      {dynamic.event_tags?.length ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {dynamic.event_tags.map((tag) => (
            <span key={tag} className="rounded bg-[#EEF4FF] px-1.5 py-0.5 text-[10px] text-[#315EA8]">{tag}</span>
          ))}
        </div>
      ) : null}
      {dynamic.summary ? (
        <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-7 text-[#344054]">{dynamic.summary}</p>
      ) : null}
      {dynamic.impact_analysis ? (
        <p className="mt-3 whitespace-pre-wrap break-words text-xs leading-6 text-[#667085]">
          <span className="font-semibold text-[#344054]">影响分析：</span>{dynamic.impact_analysis}
        </p>
      ) : null}
      {sourceIds.length ? (
        <div className="mt-3 border-t border-[#E4E9F0] pt-2">
          <p className="mb-1 text-[10px] font-semibold text-[#667085]">来源角标</p>
          <div className="flex flex-wrap gap-1.5">
            {sourceIds.map((sourceId) => (
              <SourceBadge key={sourceId} sourceId={sourceId} source={sourceMap.get(sourceId)} index={sourceIndexes.get(sourceId)} />
            ))}
          </div>
        </div>
      ) : null}
    </article>
  );
}

function ReportSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0">
      <h3 className={REPORT_HEADING_CLASS}>{title}</h3>
      {children}
    </section>
  );
}

function ReportOverview({
  execution,
  options,
  onOpenReport,
  onSaveTopic,
  onRerun,
  onReanalyze,
  onNewSearch,
  analysisAvailable,
  serviceAvailable,
  activeExecutionId,
}: {
  execution: CustomIntelligenceExecution | null;
  options: CustomIntelligenceOptionsResponse;
  onOpenReport: (execution: CustomIntelligenceExecution) => void;
  onSaveTopic: (execution: CustomIntelligenceExecution) => void;
  onRerun: (execution: CustomIntelligenceExecution) => void;
  onReanalyze?: (execution: CustomIntelligenceExecution) => void;
  onNewSearch: () => void;
  analysisAvailable: boolean;
  serviceAvailable: boolean;
  activeExecutionId: number | null;
}) {
  if (!execution || execution.search_status !== "succeeded") return null;

  const report = execution.report ?? {};
  const isGenerating = execution.status === "pending" || execution.status === "running";
  const analysisFailed = execution.analysis_status === "failed";
  const dynamics = (report.key_dynamics ?? []).slice(0, 3);
  const sourceCount = report.valid_source_count ?? execution.sources.length;
  const title = report.title || execution.topic_name || execution.original_query || "即时情报报告";
  const statusLabel = analysisFailed
    ? "分析失败"
    : execution.status === "succeeded"
      ? "报告已生成"
      : isGenerating
        ? "报告生成中"
        : execution.status === "empty"
          ? "无结果"
          : "已完成";

  return (
    <section id="instant-report-overview" aria-label="即时搜索报告概览" className="mt-5 scroll-mt-5 rounded-lg border border-[#C8D7F0] bg-[#F8FAFD] p-4 sm:p-5">
      <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold text-[#315EA8]">报告概览</span>
            <span className={`rounded px-2 py-0.5 text-[10px] font-semibold ${analysisFailed ? "bg-red-50 text-red-700" : isGenerating ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>{statusLabel}</span>
          </div>
          <h4 className="mt-2 min-w-0 break-words text-base font-bold leading-7 text-[#172033]">{title}</h4>
          <p className="mt-1 text-[11px] leading-5 text-[#667085]">
            {execution.original_query || execution.snapshot.question || "—"}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenReport(execution)}>
            <FileText className="size-3.5" aria-hidden="true" />查看完整报告
          </Button>
          {execution.status === "succeeded" && execution.topic_id === null && execution.trigger_type !== "topic" && (
            <Button variant="outline" size="sm" onClick={() => onSaveTopic(execution)}>
              <Bookmark className="size-3.5" aria-hidden="true" />保存为主题
            </Button>
          )}
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-[#E4EAF2] bg-white px-3 py-2.5">
          <p className="text-[10px] font-semibold text-[#98A2B3]">完成时间</p>
          <p className="mt-1 text-xs leading-5 text-[#344054]">{isGenerating ? "生成中" : formatDate(execution.completed_at || execution.created_at)}</p>
        </div>
        <div className="rounded-lg border border-[#E4EAF2] bg-white px-3 py-2.5">
          <p className="text-[10px] font-semibold text-[#98A2B3]">时间范围</p>
          <p className="mt-1 text-xs leading-5 text-[#344054]">{optionLabel(options.time_ranges, report.time_range || execution.snapshot.time_range)}</p>
        </div>
        <div className="rounded-lg border border-[#E4EAF2] bg-white px-3 py-2.5">
          <p className="text-[10px] font-semibold text-[#98A2B3]">有效来源数</p>
          <p className="mt-1 text-xs leading-5 text-[#344054]">{sourceCount} 条</p>
        </div>
        <div className="rounded-lg border border-[#E4EAF2] bg-white px-3 py-2.5">
          <p className="text-[10px] font-semibold text-[#98A2B3]">报告类型</p>
          <p className="mt-1 text-xs leading-5 text-[#344054]">{optionLabel(options.report_types, report.report_type || execution.snapshot.report_type)}</p>
        </div>
      </div>

      <div className="mt-5 space-y-5">
        <ReportSection title="核心结论">
          {analysisFailed ? (
            <div role="status" className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
              百度搜索已完成，DeepSeek 分析失败。可查看来源、重新分析或重新执行。
            </div>
          ) : report.core_conclusion ? (
            <p className="whitespace-pre-wrap break-words text-sm leading-7 text-[#344054]">{report.core_conclusion}</p>
          ) : isGenerating ? (
            <div role="status" className="flex items-center gap-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-700">
              <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />完整报告正在生成…
            </div>
          ) : (
            <p className="text-sm leading-7 text-[#98A2B3]">暂无核心结论。</p>
          )}
        </ReportSection>

        {dynamics.length > 0 && (
          <ReportSection title="重点动态">
            <div className="space-y-3">
              {dynamics.map((dynamic, index) => (
                <article key={`${dynamic.title}-${index}`} className="min-w-0 rounded-lg border border-[#E4EAF2] bg-white p-3">
                  <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                    <h5 className="min-w-0 break-words text-sm font-semibold leading-6 text-[#243B61]">{dynamic.title || `动态 ${index + 1}`}</h5>
                    {dynamic.information_time ? <span className="shrink-0 text-[11px] text-[#98A2B3]">{dynamic.information_time}</span> : null}
                  </div>
                  {dynamic.institutions?.length ? (
                    <p className="mt-1 text-xs leading-5 text-[#667085]">涉及机构：{dynamic.institutions.join("、")}</p>
                  ) : null}
                  {dynamic.event_tags?.length ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {dynamic.event_tags.map((tag) => (
                        <span key={tag} className="rounded bg-[#EEF4FF] px-1.5 py-0.5 text-[10px] text-[#315EA8]">{tag}</span>
                      ))}
                    </div>
                  ) : null}
                  {dynamic.summary ? (
                    <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-6 text-[#667085] line-clamp-2">{dynamic.summary}</p>
                  ) : null}
                </article>
              ))}
            </div>
          </ReportSection>
        )}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-[#E4EAF2] pt-4">
        {analysisFailed && onReanalyze && (
          <Button variant="outline" size="sm" onClick={() => onReanalyze(execution)} disabled={!analysisAvailable || activeExecutionId !== null}>
            <RefreshCw className="size-3.5" aria-hidden="true" />重新分析
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={() => onRerun(execution)} disabled={!serviceAvailable || activeExecutionId !== null}>
          <RefreshCw className="size-3.5" aria-hidden="true" />重新执行
        </Button>
        <Button variant="ghost" size="sm" onClick={onNewSearch}>
          <Search className="size-3.5" aria-hidden="true" />重新搜索
        </Button>
      </div>
    </section>
  );
}

function optionLabel(
  options: CustomIntelligenceOptionsResponse["perspectives"] | CustomIntelligenceOptionsResponse["time_ranges"] | CustomIntelligenceOptionsResponse["report_types"] | CustomIntelligenceOptionsResponse["analysis_depths"] | CustomIntelligenceOptionsResponse["source_preferences"],
  value: string | undefined,
): string {
  return options.find((item) => item.value === value)?.label ?? "—";
}

function ExecutionErrorDetail({
  execution,
  options,
  onRerun,
}: {
  execution: CustomIntelligenceExecution;
  options: CustomIntelligenceOptionsResponse;
  onRerun?: (execution: CustomIntelligenceExecution) => void;
}) {
  const snapshot = execution.snapshot;
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-red-100 bg-red-50/60 p-4">
        <h3 className="mb-1.5 text-sm font-bold text-[#243B61]">执行失败</h3>
        <p className="whitespace-pre-wrap break-words text-sm leading-6 text-[#991B1B]">
          {execution.error_message || "未提供错误信息。"}
        </p>
      </div>
      <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><p className="text-[10px] font-semibold text-[#98A2B3]">业务问题</p><p className="mt-1 break-words text-xs leading-5 text-[#344054]">{execution.original_query || snapshot.question || "—"}</p></div>
        <div><p className="text-[10px] font-semibold text-[#98A2B3]">分析角度</p><p className="mt-1 text-xs text-[#344054]">{optionLabel(options.perspectives, snapshot.analysis_perspective)}</p></div>
        <div><p className="text-[10px] font-semibold text-[#98A2B3]">时间范围</p><p className="mt-1 text-xs text-[#344054]">{optionLabel(options.time_ranges, snapshot.time_range)}</p></div>
        <div><p className="text-[10px] font-semibold text-[#98A2B3]">报告类型</p><p className="mt-1 text-xs text-[#344054]">{optionLabel(options.report_types, snapshot.report_type)}</p></div>
        <div><p className="text-[10px] font-semibold text-[#98A2B3]">来源数量</p><p className="mt-1 text-xs text-[#344054]">{execution.sources.length} 条</p></div>
        <div><p className="text-[10px] font-semibold text-[#98A2B3]">完成时间</p><p className="mt-1 text-xs text-[#344054]">{formatDate(execution.completed_at || execution.created_at)}</p></div>
        <div><p className="text-[10px] font-semibold text-[#98A2B3]">提交时间</p><p className="mt-1 text-xs text-[#344054]">{formatDate(execution.created_at)}</p></div>
      </div>
      {snapshot.keywords?.length ? (
        <div><p className="text-[10px] font-semibold text-[#98A2B3]">检索关键词</p><div className="mt-1 flex flex-wrap gap-1.5">{snapshot.keywords.map((keyword) => <span key={keyword} className="rounded bg-[#EEF4FF] px-1.5 py-0.5 text-[10px] text-[#315EA8]">{keyword}</span>)}</div></div>
      ) : null}
      {onRerun && (
        <div className="flex items-center gap-3 border-t border-[#E4EAF2] pt-3">
          <button type="button" onClick={() => onRerun(execution)} className="inline-flex items-center gap-1.5 rounded-md bg-[#2563EB] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#1D4ED8]">
            <RefreshCw className="size-3.5" />重新执行
          </button>
          <span className="text-[11px] text-[#667085]">请确认问题与配置无误后再试。</span>
        </div>
      )}
    </div>
  );
}

function ReportDialog({
  execution,
  open,
  loading,
  options,
  onOpenChange,
  onRerun,
  onSaveTopic,
  onReanalyze,
  analysisAvailable,
}: {
  execution: CustomIntelligenceExecution | null;
  open: boolean;
  loading: boolean;
  options: CustomIntelligenceOptionsResponse;
  onOpenChange: (open: boolean) => void;
  onRerun?: (execution: CustomIntelligenceExecution) => void;
  onSaveTopic?: (execution: CustomIntelligenceExecution) => void;
  onReanalyze?: (execution: CustomIntelligenceExecution) => void;
  analysisAvailable?: boolean;
}) {
  const report = (execution?.report ?? null) as Partial<IntelligenceReport> | null;
  const sources = useMemo(() => execution?.sources ?? [], [execution?.sources]);
  const sourceMap = useMemo(() => new Map(sources.map((source) => [source.id, source])), [sources]);
  const sourceIndexes = useMemo(
    () => new Map(sources.map((source, index) => [source.id, index + 1])),
    [sources],
  );
  const currentExecution = execution;
  const focusSections = (report?.focus_sections ?? []).filter(
    (section) => section.title?.trim() && section.items?.length,
  );
  const dynamics = report?.key_dynamics ?? [];
  const opportunities = report?.opportunities ?? [];
  const risks = report?.risks ?? [];
  const watchItems = report?.watch_items ?? [];
  const recommendedFollowups = report?.recommended_followups ?? [];
  const searchSucceeded = currentExecution?.search_status === "succeeded";
  const analysisFailed = searchSucceeded && currentExecution?.analysis_status === "failed";
  const executionActive = currentExecution?.status === "pending" || currentExecution?.status === "running";
  const canSaveTopic = currentExecution?.status === "succeeded" && currentExecution.topic_id === null && currentExecution.trigger_type !== "topic";
  const scrollToSources = () => {
    document.getElementById("report-sources")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const title = report?.title || currentExecution?.topic_name || currentExecution?.original_query || "情报报告";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-dvh w-full flex-col gap-0 overflow-hidden rounded-none border-0 bg-white p-0 sm:h-[min(92dvh,880px)] sm:w-[min(1120px,92vw)] sm:max-h-[calc(100dvh-2rem)] sm:max-w-[1120px] sm:rounded-lg sm:border sm:border-[#D9E2EC] sm:p-0">
        <DialogHeader className="shrink-0 border-b border-[#E4EAF2] bg-[#F8FAFD] px-4 py-4 pr-12 sm:px-6 sm:py-5">
          <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 flex-1">
              <DialogTitle className="min-w-0 break-words text-lg leading-7 text-[#172033] sm:text-xl sm:leading-8">{title}</DialogTitle>
              <DialogDescription className="mt-1 text-xs leading-5 text-[#667085]">
                {currentExecution
                  ? analysisFailed
                    ? "搜索完成，分析失败，可查看原始来源或重新分析"
                    : currentExecution.search_status !== "succeeded"
                      ? "执行失败，详情见下方"
                      : `已完成 · ${formatDate(currentExecution.completed_at || currentExecution.created_at)} · ${currentExecution.sources.length} 条有效来源`
                  : "正在加载完整报告…"}
              </DialogDescription>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {canSaveTopic && currentExecution && (
                <Button variant="outline" size="sm" onClick={() => onSaveTopic?.(currentExecution)}>
                  <Bookmark className="size-3.5" aria-hidden="true" />保存为主题
                </Button>
              )}
              {analysisFailed && currentExecution && (
                <Button variant="outline" size="sm" onClick={() => onReanalyze?.(currentExecution)} disabled={!analysisAvailable}>
                  <RefreshCw className="size-3.5" aria-hidden="true" />重新分析
                </Button>
              )}
              {searchSucceeded && currentExecution && (
                <Button variant="outline" size="sm" onClick={() => onRerun?.(currentExecution)} disabled={executionActive}>
                  <RefreshCw className="size-3.5" aria-hidden="true" />重新执行
                </Button>
              )}
              {searchSucceeded && sources.length > 0 && (
                <Button variant="outline" size="sm" onClick={scrollToSources}>
                  <ExternalLink className="size-3.5" aria-hidden="true" />查看全部来源
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
                <X className="size-3.5" aria-hidden="true" />关闭
              </Button>
            </div>
          </div>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div className="mx-auto min-w-0 max-w-[840px] px-4 py-5 sm:px-8 sm:py-7">
          {loading && <div className="mb-4 flex items-center gap-2 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700"><Loader2 className="size-4 animate-spin" />正在加载完整报告…</div>}
          {!currentExecution ? <p className="text-sm text-[#667085]">暂无报告内容。</p> : currentExecution.search_status !== "succeeded" ? (
            <ExecutionErrorDetail execution={currentExecution} options={options} onRerun={onRerun} />
          ) : (
            <div className="min-w-0 space-y-8">
                {analysisFailed && (
                  <div role="status" className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    百度搜索已完成，DeepSeek 分析失败。当前可查看原始来源，也可以重新分析。
                  </div>
                )}
                {report?.is_fallback && (
                  <div role="status" className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    本次报告使用基础格式展示。
                  </div>
                )}
                <section className="grid gap-3 rounded-lg border border-[#E4EAF2] bg-[#F8FAFD] p-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div><p className="text-[10px] font-semibold text-[#98A2B3]">完成时间</p><p className="mt-1 text-xs leading-5 text-[#344054]">{report?.executed_at || formatDate(currentExecution.completed_at || currentExecution.created_at)}</p></div>
                  <div><p className="text-[10px] font-semibold text-[#98A2B3]">时间范围</p><p className="mt-1 text-xs leading-5 text-[#344054]">{optionLabel(options.time_ranges, report?.time_range || currentExecution.snapshot.time_range)}</p></div>
                  <div><p className="text-[10px] font-semibold text-[#98A2B3]">报告类型</p><p className="mt-1 text-xs leading-5 text-[#344054]">{optionLabel(options.report_types, report?.report_type || currentExecution.snapshot.report_type)}</p></div>
                  <div><p className="text-[10px] font-semibold text-[#98A2B3]">有效来源数</p><p className="mt-1 text-xs leading-5 text-[#344054]">{report?.valid_source_count ?? sources.length}</p></div>
                </section>
                <ReportSection title="核心结论">
                  <p className="whitespace-pre-wrap break-words text-sm leading-7 text-[#344054]">{report?.core_conclusion || "暂无核心结论。"}</p>
                </ReportSection>
                {focusSections.length > 0 && (
                  <ReportSection title="报告重点章节">
                    <div className="space-y-4">
                      {focusSections.map((section) => (
                        <div key={section.title} className="min-w-0 rounded-lg border border-[#E4EAF2] bg-[#FBFCFE] p-4">
                          <h4 className="text-sm font-bold text-[#243B61]">{section.title}</h4>
                          <div className="mt-2"><TextList items={section.items} /></div>
                        </div>
                      ))}
                    </div>
                  </ReportSection>
                )}
                {dynamics.length > 0 && (
                  <ReportSection title="重点动态">
                    <div className="space-y-3">
                      {dynamics.map((dynamic, index) => (
                        <DynamicCard key={`${dynamic.title}-${index}`} dynamic={dynamic} index={index} sourceMap={sourceMap} sourceIndexes={sourceIndexes} />
                      ))}
                    </div>
                  </ReportSection>
                )}
                {report?.impact_analysis?.trim() ? (
                  <ReportSection title="影响分析">
                    <p className="whitespace-pre-wrap break-words text-sm leading-7 text-[#344054]">{report.impact_analysis}</p>
                  </ReportSection>
                ) : null}
                {(opportunities.length > 0 || risks.length > 0 || watchItems.length > 0) && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    {opportunities.length > 0 && <ReportSection title="机会"><TextList items={opportunities} /></ReportSection>}
                    {risks.length > 0 && <ReportSection title="风险"><TextList items={risks} /></ReportSection>}
                    {watchItems.length > 0 && <ReportSection title="关注事项"><TextList items={watchItems} /></ReportSection>}
                  </div>
                )}
                {recommendedFollowups.length > 0 && (
                  <ReportSection title="推荐追问">
                    <TextList items={recommendedFollowups} />
                  </ReportSection>
                )}
                {sources.length > 0 && (
                  <section id="report-sources" className="scroll-mt-24 border-t border-[#E4EAF2] pt-6">
                    <h3 className={REPORT_HEADING_CLASS}>本次报告参考来源（{sources.length}）</h3>
                    <div className="mt-3 space-y-3">
                      {sources.map((source, index) => <SourceCard key={source.id} source={source} index={index + 1} />)}
                    </div>
                  </section>
                )}
            </div>
          )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function CustomIntelligencePage() {
  const router = useRouter();
  const { isLoggedIn, token, username, isAdmin, logout, clearAuth } = useAuthStore();
  const restoreSession = useAuthStore((state) => state.restoreSession);
  const [activeTab, setActiveTab] = useState<ActiveTab>("instant");
  const [form, setForm] = useState<InstantSearchRequest>(DEFAULT_FORM);
  const [options, setOptions] = useState<CustomIntelligenceOptionsResponse>(FALLBACK_OPTIONS);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [topics, setTopics] = useState<IntelligenceTopic[]>([]);
  const [executions, setExecutions] = useState<CustomIntelligenceExecution[]>([]);
  const [executionsTotal, setExecutionsTotal] = useState(0);
  const [loadingExecutions, setLoadingExecutions] = useState(false);
  const [activeExecutionId, setActiveExecutionId] = useState<number | null>(null);
  const [pageError, setPageError] = useState("");
  const [notice, setNotice] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  const [keywordSuggestions, setKeywordSuggestions] = useState<string[]>([]);
  const [selectedSuggestions, setSelectedSuggestions] = useState<string[]>([]);
  const [topicDialogOpen, setTopicDialogOpen] = useState(false);
  const [topicEditorId, setTopicEditorId] = useState<number | null>(null);
  const [topicName, setTopicName] = useState("");
  const [topicDraft, setTopicDraft] = useState<InstantSearchRequest>(DEFAULT_FORM);
  const [topicSaving, setTopicSaving] = useState(false);
  const [topicSuggesting, setTopicSuggesting] = useState(false);
  const [topicKeywordSuggestions, setTopicKeywordSuggestions] = useState<string[]>([]);
  const [selectedTopicSuggestions, setSelectedTopicSuggestions] = useState<string[]>([]);
  const [topicUpdatingId, setTopicUpdatingId] = useState<number | null>(null);
  const [selectedExecution, setSelectedExecution] = useState<CustomIntelligenceExecution | null>(null);
  const [instantOverviewExecution, setInstantOverviewExecution] = useState<CustomIntelligenceExecution | null>(null);
  const [reportDialogOpen, setReportDialogOpen] = useState(false);
  const [reportLoading, setReportLoading] = useState(false);
  const serviceAvailable = !optionsLoading && options.service_status === "enabled";
  const analysisAvailable = !optionsLoading && options.analysis_configured;

  useEffect(() => {
    restoreSession();
  }, [restoreSession]);

  const handleError = useCallback((error: unknown, fallback?: string): boolean => {
    if (error instanceof BackendApiError && error.status === 401) {
      clearAuth("登录已失效，请重新登录");
      return true;
    }
    setPageError(errorMessage(error, fallback));
    return false;
  }, [clearAuth]);

  const loadExecutions = useCallback(async (signal?: AbortSignal) => {
    if (!token) return;
    setLoadingExecutions(true);
    try {
      const response = await fetchCustomIntelligenceExecutions(token, 1, 50, signal);
      setExecutions(response.executions);
      setExecutionsTotal(response.meta.total);
      const active = response.executions.find((execution) => isActiveExecution(execution.status));
      if (active) setActiveExecutionId(active.id);
    } catch (error) {
      if (!isAbortError(error)) handleError(error, "无法加载执行记录");
    } finally {
      if (!signal?.aborted) setLoadingExecutions(false);
    }
  }, [handleError, token]);

  const recentExecutionsByTopic = useMemo(() => {
    const latest = new Map<number, CustomIntelligenceExecution>();
    for (const execution of executions) {
      if (execution.topic_id === null) continue;
      const current = latest.get(execution.topic_id);
      if (!current || new Date(execution.created_at).getTime() > new Date(current.created_at).getTime()) {
        latest.set(execution.topic_id, execution);
      }
    }
    return latest;
  }, [executions]);

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    setOptionsLoading(true);
    Promise.all([
      fetchCustomIntelligenceOptions(token, controller.signal),
      fetchCustomIntelligenceTopics(token, controller.signal),
      fetchCustomIntelligenceExecutions(token, 1, 50, controller.signal),
    ]).then(([loadedOptions, loadedTopics, loadedExecutions]) => {
      setOptions(loadedOptions);
      setTopics(loadedTopics.topics);
      setExecutions(loadedExecutions.executions);
      setExecutionsTotal(loadedExecutions.meta.total);
      const active = loadedExecutions.executions.find((execution) => isActiveExecution(execution.status));
      if (active) setActiveExecutionId(active.id);
    }).catch((error: unknown) => {
      if (!isAbortError(error)) handleError(error, "无法加载自定义情报配置");
    }).finally(() => {
      if (!controller.signal.aborted) setOptionsLoading(false);
    });
    return () => controller.abort();
  }, [handleError, token]);

  useEffect(() => {
    if (!token || activeExecutionId === null) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const response = await fetchCustomIntelligenceExecution(token, activeExecutionId);
        if (disposed) return;
        const execution = response.execution;
        setExecutions((current) => mergeExecution(current, execution));
        setSelectedExecution((current) => current?.id === execution.id ? execution : current);
        setInstantOverviewExecution((current) => current?.id === execution.id ? execution : current);
        if (isActiveExecution(execution.status)) {
          timer = setTimeout(poll, 2000);
        } else {
          setActiveExecutionId(null);
          setNotice(execution.status === "succeeded" ? "情报报告已生成。" : execution.error_message || "本次情报执行已结束。 ");
          void loadExecutions();
        }
      } catch (error) {
        if (disposed) return;
        if (error instanceof BackendApiError && error.status === 401) {
          clearAuth("登录已失效，请重新登录");
          return;
        }
        // Keep polling through a transient network failure; the next request can recover.
        timer = setTimeout(poll, 2000);
      }
    };
    timer = setTimeout(poll, 2000);
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
    };
  }, [activeExecutionId, clearAuth, loadExecutions, token]);

  const startPolling = useCallback((execution: CustomIntelligenceExecution) => {
    setExecutions((current) => mergeExecution(current, execution));
    setActiveExecutionId(execution.id);
    setPageError("");
    setNotice("已提交执行，正在检索并整理来源（约每 2 秒更新一次）…");
  }, []);

  const submitInstant = async () => {
    if (!token || !serviceAvailable || activeExecutionId !== null || !form.question.trim()) {
      if (!form.question.trim()) setPageError("请先填写业务问题。");
      else if (!serviceAvailable) setPageError("当前情报搜索服务暂不可用，请联系管理员。");
      return;
    }
    setPageError("");
    setNotice("");
    try {
      const response = await createCustomIntelligenceExecution(token, { ...form, question: form.question.trim() });
      startPolling(response.execution);
      setSelectedExecution(response.execution);
      setInstantOverviewExecution(response.execution);
      setNotice("搜索已提交，报告概览将显示在下方。");
    } catch (error) {
      handleError(error, "无法启动即时情报搜索");
    }
  };

  const requestKeywordSuggestions = async () => {
    if (!token || suggesting || !serviceAvailable) {
      if (!serviceAvailable) setPageError("当前情报搜索服务暂不可用，请联系管理员。");
      return;
    }
    setSuggesting(true);
    setPageError("");
    try {
      const response = await suggestCustomIntelligenceKeywords(token, {
        description: form.description,
        keywords: form.keywords,
        focus_objects: form.focus_objects,
        analysis_perspective: form.analysis_perspective,
        max_suggestions: 8,
      });
      setKeywordSuggestions(response.suggestions);
      setSelectedSuggestions(response.suggestions);
      if (!response.suggestions.length) setNotice("暂未生成新的关键词，可调整问题或关注对象后重试。");
    } catch (error) {
      handleError(error, "补充关键词失败");
    } finally {
      setSuggesting(false);
    }
  };

  const mergeKeywordSuggestions = () => {
    setForm((current) => ({ ...current, keywords: [...current.keywords, ...selectedSuggestions.filter((item) => !current.keywords.includes(item))] }));
    setKeywordSuggestions([]);
    setSelectedSuggestions([]);
    setNotice("已将确认的关键词合并到当前配置。");
  };

  const resetInstantOverview = () => {
    setInstantOverviewExecution(null);
    setPageError("");
    setNotice("");
    document.getElementById("custom-intelligence-question")?.focus();
  };

  const openCreateTopic = () => {
    setTopicEditorId(null);
    setTopicName("");
    setTopicDraft({
      ...form,
      question: "",
      description: form.description.trim() || form.question.trim(),
    });
    setTopicKeywordSuggestions([]);
    setSelectedTopicSuggestions([]);
    setTopicDialogOpen(true);
  };

  const openCreateTopicFromExecution = (execution: CustomIntelligenceExecution) => {
    const snapshot = execution.snapshot;
    const question = String(snapshot.question || execution.original_query || "").trim();
    const suggestedName = String(execution.report?.title || question).trim().slice(0, 120);
    setTopicEditorId(null);
    setTopicName(suggestedName);
    setTopicDraft({
      question: "",
      description: String(snapshot.description || "").trim() || question,
      keywords: snapshot.keywords ?? [],
      focus_objects: snapshot.focus_objects ?? [],
      analysis_perspective: snapshot.analysis_perspective ?? DEFAULT_FORM.analysis_perspective,
      time_range: snapshot.time_range ?? DEFAULT_FORM.time_range,
      source_preference: snapshot.source_preference ?? DEFAULT_FORM.source_preference,
      specified_sites: snapshot.specified_sites ?? [],
      report_type: snapshot.report_type ?? DEFAULT_FORM.report_type,
      analysis_depth: snapshot.analysis_depth ?? DEFAULT_FORM.analysis_depth,
      extra_requirements: snapshot.extra_requirements ?? "",
    });
    setTopicKeywordSuggestions([]);
    setSelectedTopicSuggestions([]);
    setTopicDialogOpen(true);
  };

  const openEditTopic = async (topic: IntelligenceTopic) => {
    setTopicEditorId(topic.id);
    setTopicName(topic.name);
    setTopicDraft({ ...topic, question: "" });
    setTopicKeywordSuggestions([]);
    setSelectedTopicSuggestions([]);
    setTopicDialogOpen(true);
    if (!token) return;
    try {
      const response = await fetchCustomIntelligenceTopic(token, topic.id);
      setTopicName(response.topic.name);
      setTopicDraft({ ...response.topic, question: "" });
    } catch (error) {
      if (error instanceof BackendApiError && error.status === 401) clearAuth("登录已失效，请重新登录");
      else setPageError(errorMessage(error, "无法加载主题详情"));
    }
  };

  const requestTopicKeywordSuggestions = async () => {
    if (!token || topicSuggesting || activeExecutionId !== null || !serviceAvailable) {
      if (!serviceAvailable) setPageError("当前情报搜索服务暂不可用，请联系管理员。");
      return;
    }
    setTopicSuggesting(true);
    setPageError("");
    try {
      const response = await suggestCustomIntelligenceKeywords(token, {
        description: topicDraft.description,
        keywords: topicDraft.keywords,
        focus_objects: topicDraft.focus_objects,
        analysis_perspective: topicDraft.analysis_perspective,
        max_suggestions: 8,
      });
      setTopicKeywordSuggestions(response.suggestions);
      setSelectedTopicSuggestions(response.suggestions);
      if (!response.suggestions.length) setNotice("暂未生成新的主题关键词。");
    } catch (error) {
      handleError(error, "主题关键词生成失败");
    } finally {
      setTopicSuggesting(false);
    }
  };

  const mergeTopicKeywordSuggestions = () => {
    setTopicDraft((current) => ({
      ...current,
      keywords: [
        ...current.keywords,
        ...selectedTopicSuggestions.filter((item) => !current.keywords.includes(item)),
      ],
    }));
    setTopicKeywordSuggestions([]);
    setSelectedTopicSuggestions([]);
  };

  const saveTopic = async () => {
    if (!token || !topicName.trim()) {
      setPageError("请填写主题名称。");
      return;
    }
    setTopicSaving(true);
    setPageError("");
    // The topic endpoints intentionally accept only configuration fields.
    const topicPayload = {
      name: topicName.trim(),
      description: topicDraft.description,
      keywords: topicDraft.keywords,
      focus_objects: topicDraft.focus_objects,
      analysis_perspective: topicDraft.analysis_perspective,
      time_range: topicDraft.time_range,
      source_preference: topicDraft.source_preference,
      specified_sites: topicDraft.specified_sites,
      report_type: topicDraft.report_type,
      analysis_depth: topicDraft.analysis_depth,
      extra_requirements: topicDraft.extra_requirements,
    };
    try {
      const response = topicEditorId === null
        ? await createCustomIntelligenceTopic(token, topicPayload)
        : await updateCustomIntelligenceTopic(token, topicEditorId, topicPayload);
      setTopics((current) => topicEditorId === null ? [response.topic, ...current] : current.map((topic) => topic.id === response.topic.id ? response.topic : topic));
      setTopicDialogOpen(false);
      setNotice(topicEditorId === null ? "情报主题已保存。" : "情报主题已更新。");
    } catch (error) {
      handleError(error, topicEditorId === null ? "无法创建情报主题" : "无法更新情报主题");
    } finally {
      setTopicSaving(false);
    }
  };

  const toggleTopic = async (topic: IntelligenceTopic) => {
    if (!token || topicUpdatingId !== null) return;
    setTopicUpdatingId(topic.id);
    try {
      const response = await setCustomIntelligenceTopicEnabled(token, topic.id, !topic.enabled);
      setTopics((current) => current.map((item) => item.id === topic.id ? response.topic : item));
    } catch (error) {
      handleError(error, "无法更新主题状态");
    } finally {
      setTopicUpdatingId(null);
    }
  };

  const executeTopic = async (topic: IntelligenceTopic) => {
    if (!token || !serviceAvailable || activeExecutionId !== null) {
      if (!serviceAvailable) setPageError("当前情报搜索服务暂不可用，请联系管理员。");
      return;
    }
    setPageError("");
    try {
      const response = await executeCustomIntelligenceTopic(token, topic.id);
      startPolling(response.execution);
      setSelectedExecution(response.execution);
      setReportDialogOpen(true);
    } catch (error) {
      handleError(error, "无法启动主题执行");
    }
  };

  const openReport = async (execution: CustomIntelligenceExecution) => {
    setSelectedExecution(execution);
    setReportDialogOpen(true);
    if (!token) return;
    setReportLoading(true);
    try {
      const response = await fetchCustomIntelligenceExecution(token, execution.id);
      setSelectedExecution(response.execution);
      setExecutions((current) => mergeExecution(current, response.execution));
    } catch (error) {
      if (error instanceof BackendApiError && error.status === 401) clearAuth("登录已失效，请重新登录");
      else setPageError(errorMessage(error, "无法加载完整报告"));
    } finally {
      setReportLoading(false);
    }
  };

  const rerun = async (
    execution: CustomIntelligenceExecution,
    openReportAfterStart = true,
    keepInstantOverview = false,
  ) => {
    if (!token || !serviceAvailable || activeExecutionId !== null) {
      if (!serviceAvailable) setPageError("当前情报搜索服务暂不可用，请联系管理员。");
      return;
    }
    setPageError("");
    try {
      const response = await rerunCustomIntelligenceExecution(token, execution.id);
      startPolling(response.execution);
      setSelectedExecution(response.execution);
      if (keepInstantOverview) setInstantOverviewExecution(response.execution);
      if (openReportAfterStart) setReportDialogOpen(true);
    } catch (error) {
      handleError(error, "无法重新执行情报记录");
    }
  };

  const reanalyze = async (
    execution: CustomIntelligenceExecution,
    openReportAfterStart = true,
    keepInstantOverview = false,
  ) => {
    if (!token || activeExecutionId !== null || !options.analysis_configured) {
      if (!options.analysis_configured) setPageError("DeepSeek 分析服务未配置，请先联系管理员。");
      return;
    }
    setPageError("");
    try {
      const response = await reanalyzeCustomIntelligenceExecution(token, execution.id);
      startPolling(response.execution);
      setSelectedExecution(response.execution);
      if (keepInstantOverview) setInstantOverviewExecution(response.execution);
      if (openReportAfterStart) setReportDialogOpen(true);
    } catch (error) {
      handleError(error, "无法重新分析情报记录");
    }
  };

  const visibleOptions = optionsLoading ? FALLBACK_OPTIONS : options;

  if (!isLoggedIn) return <LoginPageWithApply />;

  return (
    <div className="min-h-screen min-w-0 overflow-x-hidden bg-[#F4F7FB]">
      <DashboardHeader
        username={username}
        isAdmin={isAdmin}
        activeModule="custom-intelligence"
        statusLabel="当前状态"
        statusText={
          activeExecutionId !== null
            ? "执行中"
            : optionsLoading
              ? "加载中"
              : serviceAvailable
                ? "服务正常"
                : "服务不可用"
        }
        statusTone={activeExecutionId !== null || optionsLoading ? "loading" : serviceAvailable ? "ready" : "unavailable"}
        statusDescription={
          activeExecutionId !== null
            ? "当前有一条自定义情报正在执行"
            : serviceAvailable
              ? "自定义情报搜索服务可用"
              : "当前情报搜索服务暂不可用"
        }
        exportOptions={[
          {
            id: "executions-csv",
            label: "执行记录（表格）",
            description: `${executions.length} 条记录`,
            disabled: executions.length === 0,
            onSelect: () => exportCustomIntelligenceCsv(executions),
          },
          {
            id: "executions-json",
            label: "执行记录（完整数据）",
            description: "保留结构化报告与来源",
            disabled: executions.length === 0,
            onSelect: () => exportCustomIntelligenceJson(executions),
          },
        ]}
        onOpenAdmin={() => router.push("/admin")}
        onLogout={logout}
      />

      <main className="mx-auto max-w-[1600px] min-w-0 space-y-4 px-3 py-4 sm:px-8 sm:py-5">
        {(pageError || notice) && <div role={pageError ? "alert" : "status"} aria-live={pageError ? "assertive" : "polite"} className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm ${pageError ? "border-red-100 bg-red-50 text-red-700" : "border-blue-100 bg-blue-50 text-blue-700"}`}><AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" /><span className="min-w-0 whitespace-pre-wrap break-words">{pageError || notice}</span><button type="button" className="ml-auto shrink-0 opacity-60 hover:opacity-100" onClick={() => { setPageError(""); setNotice(""); }} aria-label="关闭提示"><X className="size-4" aria-hidden="true" /></button></div>}
        {!optionsLoading && !serviceAvailable && <div role="status" className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">当前情报搜索服务暂不可用，请联系管理员。</div>}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-[#172033] sm:text-[26px]">自定义情报</h2>
            <p className="mt-1 text-xs text-[#667085]">按业务问题检索公开信息，并保存常用配置。</p>
          </div>
          {activeExecutionId !== null && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              <span className="inline-flex items-center gap-1.5" role="status" aria-live="polite"><Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />有一条情报正在执行</span>
            </div>
          )}
        </div>

        <CustomIntelligenceTabs activeTab={activeTab} executionCount={executionsTotal} onChange={setActiveTab} />

        {activeTab === "instant" && (
          <section id="custom-intelligence-panel-instant" role="tabpanel" aria-label="即时搜索" aria-busy={optionsLoading} className="surface-panel px-3 py-4 sm:px-4">
            <div className="mb-5">
              <h3 className="text-base font-semibold text-[#172033]">搜索情报</h3>
              <p className="mt-1 text-xs leading-5 text-[#667085]">输入业务问题，选择分析角度和时间范围。</p>
            </div>
            <div className="mb-5"><ConfigFields value={form} onChange={setForm} options={visibleOptions} /></div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#E4EAF2] pt-4">
              <button onClick={requestKeywordSuggestions} disabled={suggesting || activeExecutionId !== null || !serviceAvailable} className="inline-flex items-center gap-1.5 rounded-md border border-[#C8D7F0] bg-[#F8FAFD] px-3 py-2 text-xs font-semibold text-[#315EA8] transition hover:bg-[#EEF4FF] disabled:cursor-not-allowed disabled:opacity-50">
                {suggesting ? "正在生成…" : "补充关键词"}
              </button>
              <button onClick={submitInstant} disabled={activeExecutionId !== null || !form.question.trim() || optionsLoading || !serviceAvailable} className="inline-flex items-center gap-2 rounded-md bg-[#2563EB] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#1D4ED8] disabled:cursor-not-allowed disabled:opacity-50">
                <Play className="size-4" />开始搜索
              </button>
            </div>
            {keywordSuggestions.length > 0 && (
              <div className="mt-4 rounded-lg border border-[#E4EAF2] bg-[#F8FAFD] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div><h4 className="text-sm font-bold text-[#243B61]">生成的关键词</h4><p className="mt-1 text-[11px] text-[#667085]">勾选需要的词，确认后加入当前配置。</p></div>
                  <div className="flex gap-2"><button onClick={() => setSelectedSuggestions(selectedSuggestions.length === keywordSuggestions.length ? [] : keywordSuggestions)} className="rounded-md border border-[#D0D5DD] px-2.5 py-1.5 text-[11px] text-[#475467]">{selectedSuggestions.length === keywordSuggestions.length ? "取消全选" : "全选"}</button><button onClick={mergeKeywordSuggestions} disabled={!selectedSuggestions.length} className="rounded-md bg-[#315EA8] px-2.5 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50">确认合并</button></div>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{keywordSuggestions.map((suggestion) => <label key={suggestion} className="flex cursor-pointer items-center gap-2 rounded-lg border border-[#E4EAF2] bg-white px-3 py-2 text-xs text-[#344054] hover:border-[#9FB9E8]"><input type="checkbox" checked={selectedSuggestions.includes(suggestion)} onChange={(event) => setSelectedSuggestions((current) => event.target.checked ? [...current, suggestion] : current.filter((item) => item !== suggestion))} className="size-3.5 accent-[#315EA8]" />{suggestion}</label>)}</div>
              </div>
            )}
            <ReportOverview
              execution={instantOverviewExecution}
              options={visibleOptions}
              onOpenReport={(execution) => void openReport(execution)}
              onSaveTopic={openCreateTopicFromExecution}
              onRerun={(execution) => void rerun(execution, false, true)}
              onReanalyze={(execution) => void reanalyze(execution, false, true)}
              onNewSearch={resetInstantOverview}
              analysisAvailable={analysisAvailable}
              serviceAvailable={serviceAvailable}
              activeExecutionId={activeExecutionId}
            />
          </section>
        )}

        {activeTab === "topics" && (
          <section id="custom-intelligence-panel-topics" role="tabpanel" aria-label="情报主题" className="surface-panel px-3 py-4 sm:px-4">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-[#172033]">情报主题</h3>
                <p className="mt-1 text-xs text-[#667085]">保存常用配置，按需启停或执行。</p>
              </div>
              <button type="button" onClick={openCreateTopic} className="inline-flex items-center gap-1.5 rounded-md bg-[#2563EB] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1D4ED8]"><span aria-hidden="true">＋</span>新建主题</button>
            </div>
            <TopicList topics={topics} loading={optionsLoading} options={visibleOptions} serviceAvailable={serviceAvailable} activeExecutionId={activeExecutionId} topicUpdatingId={topicUpdatingId} recentExecutionsByTopic={recentExecutionsByTopic} onCreate={openCreateTopic} onToggle={toggleTopic} onEdit={openEditTopic} onExecute={executeTopic} onOpenReport={(execution) => void openReport(execution)} />
          </section>
        )}

        {activeTab === "executions" && (
          <section id="custom-intelligence-panel-executions" role="tabpanel" aria-label="执行记录" className="surface-panel px-3 py-4 sm:px-4">
            <ExecutionList executions={executions} loading={loadingExecutions} serviceAvailable={serviceAvailable} analysisAvailable={analysisAvailable} onRefresh={() => void loadExecutions()} onStartSearch={() => setActiveTab("instant")} onSaveTopic={openCreateTopicFromExecution} onOpenReport={(execution) => void openReport(execution)} onRerun={(execution) => void rerun(execution)} onReanalyze={(execution) => void reanalyze(execution)} activeExecutionId={activeExecutionId} />
          </section>
        )}
      </main>

      <Dialog open={topicDialogOpen} onOpenChange={(open) => !topicSaving && setTopicDialogOpen(open)}>
        <DialogContent className="flex w-[calc(100%-1rem)] max-h-[calc(100dvh-1rem)] max-w-[900px] flex-col gap-0 overflow-hidden border-[#D9E2EC] bg-white p-0 sm:w-[calc(100%-2rem)] sm:max-h-[calc(100dvh-2rem)] sm:!max-w-[900px]">
          <DialogHeader className="shrink-0 border-b border-[#E4EAF2] bg-[#F8FAFD] px-4 py-4 pr-12 sm:px-6 sm:py-5">
            <DialogTitle className="text-base text-[#172033]">{topicEditorId === null ? "保存为情报主题" : "编辑情报主题"}</DialogTitle>
            <DialogDescription className="text-[#667085]">主题保存后可在列表中启停或执行。</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-5">
            <div className="mb-4">
              <FieldLabel hint="必填">主题名称</FieldLabel>
              <input value={topicName} onChange={(event) => setTopicName(event.target.value)} maxLength={120} placeholder="例如：券商财富管理竞争监测" className={FIELD_INPUT_CLASS} />
            </div>
            <ConfigFields value={topicDraft} onChange={setTopicDraft} options={visibleOptions} showQuestion={false} />
            <div className="mt-4 rounded-lg border border-[#E4EAF2] bg-[#F8FAFD] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 className="text-sm font-bold text-[#243B61]">生成的关键词</h4>
                  <p className="mt-1 text-[11px] text-[#667085]">根据主题描述、已有关键词和关注对象生成，确认后才合并。</p>
                </div>
                <button type="button" onClick={() => void requestTopicKeywordSuggestions()} disabled={topicSuggesting || activeExecutionId !== null || !serviceAvailable} className="inline-flex items-center gap-1.5 rounded-md border border-[#C8D7F0] bg-white px-2.5 py-1.5 text-[11px] font-semibold text-[#315EA8] disabled:opacity-50">{topicSuggesting ? "生成中…" : "补充关键词"}</button>
              </div>
              {topicKeywordSuggestions.length > 0 && <>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{topicKeywordSuggestions.map((suggestion) => <label key={suggestion} className="flex cursor-pointer items-center gap-2 rounded-lg border border-[#E4EAF2] bg-white px-3 py-2 text-xs text-[#344054]"><input type="checkbox" checked={selectedTopicSuggestions.includes(suggestion)} onChange={(event) => setSelectedTopicSuggestions((current) => event.target.checked ? [...current, suggestion] : current.filter((item) => item !== suggestion))} className="size-3.5 accent-[#315EA8]" />{suggestion}</label>)}</div>
                <div className="mt-3 flex justify-end"><button type="button" onClick={mergeTopicKeywordSuggestions} disabled={!selectedTopicSuggestions.length} className="rounded-md bg-[#315EA8] px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50">确认合并</button></div>
              </>}
            </div>
          </div>
          <DialogFooter className="relative z-10 shrink-0 border-t border-[#E4EAF2] bg-[#FBFCFE] px-4 py-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-4">
            <button type="button" onClick={() => setTopicDialogOpen(false)} disabled={topicSaving} className="rounded-md border border-[#D0D5DD] px-3.5 py-2 text-sm font-semibold text-[#475467] hover:bg-white">取消</button>
            <button type="button" onClick={() => void saveTopic()} disabled={topicSaving || !topicName.trim()} className="inline-flex items-center gap-1.5 rounded-md bg-[#2563EB] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-50">{topicSaving && <Loader2 className="size-4 animate-spin" />}保存主题</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ReportDialog
        execution={selectedExecution}
        open={reportDialogOpen}
        loading={reportLoading}
        options={visibleOptions}
        onOpenChange={setReportDialogOpen}
        onRerun={(execution) => {
          setReportDialogOpen(false);
          void rerun(execution);
        }}
        onSaveTopic={(execution) => {
          setReportDialogOpen(false);
          openCreateTopicFromExecution(execution);
        }}
        onReanalyze={(execution) => {
          setReportDialogOpen(false);
          void reanalyze(execution);
        }}
        analysisAvailable={analysisAvailable}
      />
    </div>
  );
}
