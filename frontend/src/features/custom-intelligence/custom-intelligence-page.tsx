"use client";

import {
  AlertCircle,
  ChevronDown,
  Lightbulb,
  Loader2,
  Play,
  Sparkles,
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
  IntelligenceFocusSection,
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
  deep_search_enabled: false,
};

const FIELD_INPUT_CLASS = "w-full rounded-lg border border-[#D0D5DD] bg-white px-3 py-2.5 text-sm text-[#172033] shadow-sm outline-none transition placeholder:text-[#98A2B3] focus:border-[#4F7CFF] focus:ring-2 focus:ring-[#4F7CFF]/15";
const REPORT_HEADING_CLASS = "mb-2 text-sm font-bold text-[#243B61]";

function isActiveExecution(status: CustomIntelligenceExecutionStatus): boolean {
  return status === "pending" || status === "running";
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.replace("T", " ").slice(0, 16);
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function errorMessage(error: unknown, fallback = "操作失败，请稍后重试"): string {
  if (!(error instanceof BackendApiError)) {
    return error instanceof Error && error.message ? error.message : fallback;
  }
  if (error.status === 0) return `无法访问后端 API（${getApiBaseUrlLabel()}），请检查 FastAPI 端口、前端 API 地址和网关配置。`;
  if (error.status === 401) return "登录已失效，请重新登录。";
  if (error.status === 403) return "当前账号没有执行自定义情报的权限。";
  if (error.status === 409) return error.message || "当前已有情报执行正在进行，请稍后再试。";
  if (error.status === 404) return `自定义情报接口不存在，可能是前后端版本或代理路径不一致：${error.message || "请检查 API 路由"}`;
  if (error.status === 422) return `请求参数有误：${error.message || "请检查表单内容"}`;
  if (error.status === 502) {
    if (/欠费|账单逾期|account_overdue/i.test(error.message)) return "百度搜索账户欠费或账单逾期，请联系管理员处理千帆账户后重试。";
    if (/HTTP (401|403)\b/.test(error.message)) return "百度搜索鉴权失败，请检查服务端密钥、模型和鉴权头配置。";
    return `百度搜索上游服务失败：${error.message || "请稍后重试"}`;
  }
  if (error.status === 429) return "百度搜索达到频率或额度限制，请稍后重试。";
  if (error.status === 503) return "搜索服务尚未配置，请联系管理员。";
  if (error.status === 504) return "搜索服务请求超时，请稍后重试。";
  if (error.status === 500) return `后端处理失败：${error.message || "请查看服务日志"}`;
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
      <div className="min-h-10 rounded-lg border border-[#D0D5DD] bg-white px-2 py-1.5 shadow-sm focus-within:border-[#4F7CFF] focus-within:ring-2 focus-within:ring-[#4F7CFF]/10">
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
          <FieldLabel hint="必填">核心问题</FieldLabel>
          <textarea
            value={value.question}
            onChange={(event) => update("question", event.target.value)}
            rows={3}
            maxLength={1000}
            placeholder="例如：近期券商财富管理业务的竞争变化和潜在机会有哪些？"
            className="w-full resize-y rounded-lg border border-[#D0D5DD] bg-white px-3 py-2.5 text-sm leading-6 text-[#172033] shadow-sm outline-none transition focus:border-[#4F7CFF] focus:ring-2 focus:ring-[#4F7CFF]/15"
          />
          <div className="mt-1 text-right text-[10px] text-[#98A2B3]">{value.question.length}/1000</div>
          <div className="mt-3">
            <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-[#475467]">
              <Lightbulb className="size-3.5 text-amber-500" />
              推荐问题
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
                    className="max-w-full rounded-lg border border-[#E4E9F0] bg-[#F8FAFC] px-3 py-2 text-left text-[11px] leading-5 text-[#475467] transition hover:border-[#9FB9E8] hover:bg-[#EEF4FF] hover:text-[#315EA8]"
                    title={preset.question}
                  >
                    <span className="font-semibold text-[#315EA8]">{preset.title}</span>
                    <span className="ml-1.5">{preset.question}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-[#98A2B3]">当前视角暂无推荐问题。</p>
            )}
          </div>
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <FieldLabel>分析视角</FieldLabel>
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
        className="group rounded-xl border border-[#E4E9F0] bg-[#F8FAFD] px-3.5 py-3"
      >
        <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-semibold text-[#344054]">
          <span className="inline-flex items-center gap-1.5"><ChevronDown className="size-4 transition group-open:rotate-180" />高级搜索设置</span>
          <span className="text-[10px] font-normal text-[#98A2B3]">报告、来源、关键词等</span>
        </summary>
        <div className="mt-3 space-y-4 border-t border-[#E4E9F0] pt-3">
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
            <FieldLabel hint="可选">背景描述</FieldLabel>
            <input value={value.description} onChange={(event) => update("description", event.target.value)} maxLength={2000} placeholder="补充业务背景、判断边界或关注原因" className={FIELD_INPUT_CLASS} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <TagEditor label="检索关键词" values={value.keywords} onChange={(next) => update("keywords", next)} placeholder="例如：财富管理" />
            <TagEditor label="关注对象" values={value.focus_objects} onChange={(next) => update("focus_objects", next)} placeholder="例如：头部券商、投顾团队" />
          </div>
          <TagEditor label="指定站点" values={value.specified_sites} onChange={(next) => update("specified_sites", next)} placeholder="例如：csrc.gov.cn" hint="仅填写域名；服务端会再次校验" />
          <div>
            <FieldLabel hint="可选">额外分析要求</FieldLabel>
            <textarea value={value.extra_requirements} onChange={(event) => update("extra_requirements", event.target.value)} rows={3} maxLength={2000} placeholder="例如：结论要区分已发生事实与推测，并给出可执行的跟进建议。" className="w-full resize-y rounded-lg border border-[#D0D5DD] bg-white px-3 py-2.5 text-sm leading-6 text-[#172033] shadow-sm outline-none transition focus:border-[#4F7CFF] focus:ring-2 focus:ring-[#4F7CFF]/15" />
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

function SourceLink({ source }: { source: IntelligenceSource }) {
  const url = safeHttpUrl(source.url);
  return (
    <div className="rounded-lg border border-[#E4E9F0] bg-white p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="break-words text-sm font-semibold leading-5 text-[#243B61]">{source.title || "未命名来源"}</p>
          <p className="mt-1 text-[11px] text-[#667085]">{source.site_name || "未知站点"}{source.date ? ` · ${source.date}` : ""}</p>
        </div>
        {url ? <a href={url} target="_blank" rel="noopener noreferrer" className="shrink-0 rounded-md border border-[#C8D7F0] px-2 py-1 text-[11px] font-semibold text-[#315EA8] hover:bg-[#EEF4FF]">打开来源</a> : <span className="shrink-0 text-[10px] text-[#98A2B3]">链接不可用</span>}
      </div>
      {source.snippet && <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-5 text-[#667085]">{source.snippet}</p>}
      {source.provider_reference_ids?.length ? <p className="mt-2 break-words text-[10px] text-[#98A2B3]">引用 ID：{source.provider_reference_ids.join("、")}</p> : null}
    </div>
  );
}

function ReportDialog({
  execution,
  open,
  loading,
  onOpenChange,
}: {
  execution: CustomIntelligenceExecution | null;
  open: boolean;
  loading: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const report = (execution?.report ?? null) as Partial<IntelligenceReport> | null;
  const sources = useMemo(() => execution?.sources ?? [], [execution?.sources]);
  const sourceMap = useMemo(() => new Map(sources.map((source) => [source.id, source])), [sources]);
  const focusSections = (report?.focus_sections ?? []) as IntelligenceFocusSection[];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-1rem)] max-w-[1120px] flex-col gap-0 overflow-hidden border-[#D9E2EC] bg-white p-0">
        <DialogHeader className="shrink-0 border-b border-[#E4E9F0] bg-[#F8FAFD] px-6 py-5 pr-12">
          <DialogTitle className="text-lg text-[#172033]">{report?.title || execution?.topic_name || "情报报告"}</DialogTitle>
          <DialogDescription className="text-[#667085]">{execution ? `${formatDate(execution.completed_at || execution.created_at)} · ${execution.sources.length} 条有效来源` : "正在加载完整报告…"}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-5">
          {loading && <div className="mb-4 flex items-center gap-2 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700"><Loader2 className="size-4 animate-spin" />正在加载完整报告…</div>}
          {!execution ? <p className="text-sm text-[#667085]">暂无报告内容。</p> : (
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
              <div className="min-w-0 space-y-6">
                <section className="grid gap-3 rounded-xl border border-[#E4E9F0] bg-[#F8FAFD] p-3 sm:grid-cols-3">
                  <div><p className="text-[10px] font-semibold text-[#98A2B3]">执行时间</p><p className="mt-1 text-xs text-[#344054]">{report?.executed_at || formatDate(execution.completed_at || execution.created_at)}</p></div>
                  <div><p className="text-[10px] font-semibold text-[#98A2B3]">时间范围</p><p className="mt-1 text-xs text-[#344054]">{report?.time_range || "—"}</p></div>
                  <div><p className="text-[10px] font-semibold text-[#98A2B3]">有效来源数</p><p className="mt-1 text-xs text-[#344054]">{report?.valid_source_count ?? sources.length}</p></div>
                </section>
                <section>
                  <h3 className={REPORT_HEADING_CLASS}>核心结论</h3>
                  <p className="whitespace-pre-wrap break-words text-sm leading-7 text-[#344054]">{report?.core_conclusion || "暂无核心结论。"}</p>
                </section>
                <section className="grid gap-4 sm:grid-cols-2">
                  <div><h3 className={REPORT_HEADING_CLASS}>影响分析</h3><p className="whitespace-pre-wrap break-words text-sm leading-6 text-[#344054]">{report?.impact_analysis || "暂无影响分析。"}</p></div>
                  <div><h3 className={REPORT_HEADING_CLASS}>分析问题</h3><p className="whitespace-pre-wrap break-words text-sm leading-6 text-[#344054]">{report?.question || execution.original_query || "—"}</p></div>
                </section>
                {focusSections.map((section) => <section key={section.title}><h3 className={REPORT_HEADING_CLASS}>{section.title}</h3><TextList items={section.items} /></section>)}
                <section>
                  <h3 className={REPORT_HEADING_CLASS}>重点动态</h3>
                  <div className="space-y-3">
                    {(report?.key_dynamics ?? []).length ? (report?.key_dynamics ?? []).map((dynamic, index) => (
                      <article key={`${dynamic.title}-${index}`} className="rounded-xl border border-[#E4E9F0] bg-[#FBFCFE] p-4">
                        <div className="flex flex-wrap items-start justify-between gap-2"><h4 className="text-sm font-bold text-[#243B61]">{dynamic.title || `动态 ${index + 1}`}</h4>{dynamic.information_time && <span className="text-[11px] text-[#98A2B3]">{dynamic.information_time}</span>}</div>
                        {dynamic.institutions?.length ? <p className="mt-1 text-xs text-[#667085]">涉及主体：{dynamic.institutions.join("、")}</p> : null}
                        <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-[#344054]">{dynamic.summary || "暂无摘要。"}</p>
                        {dynamic.impact_analysis && <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-5 text-[#667085]">影响：{dynamic.impact_analysis}</p>}
                        {dynamic.event_tags?.length ? <div className="mt-2 flex flex-wrap gap-1.5">{dynamic.event_tags.map((tag) => <span key={tag} className="rounded bg-[#EEF4FF] px-1.5 py-0.5 text-[10px] text-[#315EA8]">{tag}</span>)}</div> : null}
                        {dynamic.source_ids?.length ? <div className="mt-3 border-t border-[#E4E9F0] pt-2"><p className="mb-1 text-[10px] font-semibold text-[#667085]">关联来源</p><div className="flex flex-wrap gap-1.5">{dynamic.source_ids.map((sourceId) => { const source = sourceMap.get(sourceId); const sourceUrl = source ? safeHttpUrl(source.url) : null; return source && sourceUrl ? <a key={sourceId} href={sourceUrl} target="_blank" rel="noopener noreferrer" className="max-w-full truncate rounded border border-[#C8D7F0] px-1.5 py-0.5 text-[10px] text-[#315EA8] hover:bg-[#EEF4FF]">{sourceId} · {source.title || "来源"}</a> : <span key={sourceId} className="max-w-full truncate rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">{source ? `${sourceId} · ${source.title || "来源"}（链接不可用）` : `${sourceId}（未匹配）`}</span>; })}</div></div> : null}
                      </article>
                    )) : <p className="text-sm text-[#98A2B3]">暂无重点动态。</p>}
                  </div>
                </section>
                <div className="grid gap-4 sm:grid-cols-2">
                  <section><h3 className={REPORT_HEADING_CLASS}>机会</h3><TextList items={report?.opportunities} /></section>
                  <section><h3 className={REPORT_HEADING_CLASS}>风险</h3><TextList items={report?.risks} /></section>
                  <section><h3 className={REPORT_HEADING_CLASS}>观察事项</h3><TextList items={report?.watch_items} /></section>
                  <section><h3 className={REPORT_HEADING_CLASS}>建议跟进</h3><TextList items={report?.recommended_followups} /></section>
                </div>
              </div>
              <aside className="min-w-0 xl:border-l xl:border-[#E4E9F0] xl:pl-5"><h3 className={REPORT_HEADING_CLASS}>完整来源（{sources.length}）</h3><div className="space-y-3">{sources.length ? sources.map((source) => <SourceLink key={source.id} source={source} />) : <p className="text-sm text-[#98A2B3]">暂无有效来源。</p>}</div></aside>
            </div>
          )}
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
  const [reportDialogOpen, setReportDialogOpen] = useState(false);
  const [reportLoading, setReportLoading] = useState(false);

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
        if (isActiveExecution(execution.status)) {
          timer = setTimeout(poll, 2000);
        } else {
          setActiveExecutionId(null);
          setNotice(execution.status === "succeeded" ? "情报报告已生成，可在执行记录中查看。" : execution.error_message || "本次情报执行已结束。 ");
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
    if (!token || activeExecutionId !== null || !form.question.trim()) {
      if (!form.question.trim()) setPageError("请先填写核心问题。");
      return;
    }
    setPageError("");
    setNotice("");
    try {
      const response = await createCustomIntelligenceExecution(token, { ...form, question: form.question.trim() });
      startPolling(response.execution);
      setActiveTab("executions");
    } catch (error) {
      handleError(error, "无法启动即时情报搜索");
    }
  };

  const requestKeywordSuggestions = async () => {
    if (!token || suggesting) return;
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
      if (!response.suggestions.length) setNotice("暂未生成新的关键词建议，可调整问题或关注对象后重试。");
    } catch (error) {
      handleError(error, "关键词建议生成失败");
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
    if (!token || topicSuggesting || activeExecutionId !== null) return;
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
      if (!response.suggestions.length) setNotice("暂未生成新的主题关键词建议。");
    } catch (error) {
      handleError(error, "主题关键词建议生成失败");
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
    if (!token || activeExecutionId !== null) return;
    setPageError("");
    try {
      const response = await executeCustomIntelligenceTopic(token, topic.id);
      startPolling(response.execution);
      setActiveTab("executions");
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

  const rerun = async (execution: CustomIntelligenceExecution) => {
    if (!token || activeExecutionId !== null) return;
    setPageError("");
    try {
      const response = await rerunCustomIntelligenceExecution(token, execution.id);
      startPolling(response.execution);
    } catch (error) {
      handleError(error, "无法重新执行情报记录");
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
              : options.service_configured
                ? "服务就绪"
                : "待配置"
        }
        statusTone={activeExecutionId !== null || optionsLoading ? "loading" : options.service_configured ? "ready" : "unavailable"}
        statusDescription={
          activeExecutionId !== null
            ? "当前有一条自定义情报正在执行"
            : options.service_configured
              ? "自定义情报搜索服务已配置"
              : "搜索服务尚未配置"
        }
        exportOptions={[
          {
            id: "executions-csv",
            label: "已加载记录 · CSV",
            description: `${executions.length} 条记录`,
            disabled: executions.length === 0,
            onSelect: () => exportCustomIntelligenceCsv(executions),
          },
          {
            id: "executions-json",
            label: "已加载记录 · JSON",
            description: "保留结构化报告与来源",
            disabled: executions.length === 0,
            onSelect: () => exportCustomIntelligenceJson(executions),
          },
        ]}
        onOpenAdmin={() => router.push("/")}
        onLogout={logout}
      />

      <main className="mx-auto max-w-[1600px] min-w-0 space-y-4 px-3 py-4 sm:px-8 sm:py-5">
        {(pageError || notice) && <div role={pageError ? "alert" : "status"} aria-live={pageError ? "assertive" : "polite"} className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm ${pageError ? "border-red-100 bg-red-50 text-red-700" : "border-blue-100 bg-blue-50 text-blue-700"}`}><AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" /><span className="min-w-0 whitespace-pre-wrap break-words">{pageError || notice}</span><button type="button" className="ml-auto shrink-0 opacity-60 hover:opacity-100" onClick={() => { setPageError(""); setNotice(""); }} aria-label="关闭提示"><X className="size-4" aria-hidden="true" /></button></div>}
        {!optionsLoading && !options.service_configured && <div role="status" className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">搜索服务尚未配置。可先编辑和保存主题，执行时再联系管理员完成服务端配置。</div>}
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
          <section id="custom-intelligence-panel-instant" role="tabpanel" aria-label="即时搜索" aria-busy={optionsLoading} className="border-y border-[#E4E9F0] bg-white px-3 py-4 sm:px-4">
            <div className="mb-5">
              <h3 className="text-base font-semibold text-[#172033]">即时搜索</h3>
              <p className="mt-1 text-xs leading-5 text-[#667085]">填写核心问题、分析视角和时间范围。</p>
            </div>
            <div className="mb-5"><ConfigFields value={form} onChange={setForm} options={visibleOptions} /></div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#E4E9F0] pt-4">
              <button onClick={requestKeywordSuggestions} disabled={suggesting || activeExecutionId !== null} className="inline-flex items-center gap-1.5 rounded-lg border border-[#C8D7F0] bg-[#F8FAFD] px-3 py-2 text-xs font-semibold text-[#315EA8] transition hover:bg-[#EEF4FF] disabled:cursor-not-allowed disabled:opacity-50">
                <Sparkles className="size-3.5" />{suggesting ? "正在生成建议…" : "关键词建议"}
              </button>
              <button onClick={submitInstant} disabled={activeExecutionId !== null || !form.question.trim() || optionsLoading} className="inline-flex items-center gap-2 rounded-lg bg-[#2563EB] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_3px_10px_rgba(37,99,235,0.25)] transition hover:bg-[#1D4ED8] disabled:cursor-not-allowed disabled:opacity-50">
                <Play className="size-4" />开始搜索
              </button>
            </div>
            {keywordSuggestions.length > 0 && (
              <div className="mt-4 rounded-xl border border-[#C8D7F0] bg-[#F8FAFD] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div><h4 className="text-sm font-bold text-[#243B61]">关键词建议</h4><p className="mt-1 text-[11px] text-[#667085]">勾选需要的词，确认后加入当前配置。</p></div>
                  <div className="flex gap-2"><button onClick={() => setSelectedSuggestions(selectedSuggestions.length === keywordSuggestions.length ? [] : keywordSuggestions)} className="rounded-md border border-[#D0D5DD] px-2.5 py-1.5 text-[11px] text-[#475467]">{selectedSuggestions.length === keywordSuggestions.length ? "取消全选" : "全选"}</button><button onClick={mergeKeywordSuggestions} disabled={!selectedSuggestions.length} className="rounded-md bg-[#315EA8] px-2.5 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50">确认合并</button></div>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{keywordSuggestions.map((suggestion) => <label key={suggestion} className="flex cursor-pointer items-center gap-2 rounded-lg border border-[#E4E9F0] bg-white px-3 py-2 text-xs text-[#344054] hover:border-[#9FB9E8]"><input type="checkbox" checked={selectedSuggestions.includes(suggestion)} onChange={(event) => setSelectedSuggestions((current) => event.target.checked ? [...current, suggestion] : current.filter((item) => item !== suggestion))} className="size-3.5 accent-[#315EA8]" />{suggestion}</label>)}</div>
              </div>
            )}
          </section>
        )}

        {activeTab === "topics" && (
          <section id="custom-intelligence-panel-topics" role="tabpanel" aria-label="情报主题" className="border-y border-[#E4E9F0] bg-white px-3 py-4 sm:px-4">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-[#172033]">情报主题</h3>
                <p className="mt-1 text-xs text-[#667085]">保存常用配置，按需启停或执行。</p>
              </div>
              <button type="button" onClick={openCreateTopic} className="inline-flex items-center gap-1.5 rounded-md bg-[#2563EB] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1D4ED8]"><span aria-hidden="true">＋</span>新建主题</button>
            </div>
            <TopicList topics={topics} loading={optionsLoading} options={visibleOptions} activeExecutionId={activeExecutionId} topicUpdatingId={topicUpdatingId} onCreate={openCreateTopic} onToggle={toggleTopic} onEdit={openEditTopic} onExecute={executeTopic} />
          </section>
        )}

        {activeTab === "executions" && (
          <section id="custom-intelligence-panel-executions" role="tabpanel" aria-label="执行记录" className="border-y border-[#E4E9F0] bg-white px-3 py-4 sm:px-4">
            <ExecutionList executions={executions} loading={loadingExecutions} onRefresh={() => void loadExecutions()} onStartSearch={() => setActiveTab("instant")} onSaveTopic={openCreateTopicFromExecution} onOpenReport={(execution) => void openReport(execution)} onRerun={(execution) => void rerun(execution)} activeExecutionId={activeExecutionId} />
          </section>
        )}
      </main>

      <Dialog open={topicDialogOpen} onOpenChange={(open) => !topicSaving && setTopicDialogOpen(open)}>
        <DialogContent className="flex w-[calc(100%-1rem)] max-h-[calc(100dvh-1rem)] max-w-[900px] flex-col gap-0 overflow-hidden border-[#D9E2EC] bg-white p-0 sm:w-[calc(100%-2rem)] sm:max-h-[calc(100dvh-2rem)] sm:!max-w-[900px]">
          <DialogHeader className="shrink-0 border-b border-[#E4E9F0] bg-[#F8FAFD] px-4 py-4 pr-12 sm:px-6 sm:py-5">
            <DialogTitle className="text-base text-[#172033]">{topicEditorId === null ? "保存为情报主题" : "编辑情报主题"}</DialogTitle>
            <DialogDescription className="text-[#667085]">主题保存后可在列表中启停和手动执行。</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-5">
            <div className="mb-4">
              <FieldLabel hint="必填">主题名称</FieldLabel>
              <input value={topicName} onChange={(event) => setTopicName(event.target.value)} maxLength={120} placeholder="例如：券商财富管理竞争监测" className={FIELD_INPUT_CLASS} />
            </div>
            <ConfigFields value={topicDraft} onChange={setTopicDraft} options={visibleOptions} showQuestion={false} />
            <div className="mt-4 rounded-xl border border-[#C8D7F0] bg-[#F8FAFD] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 className="text-sm font-bold text-[#243B61]">主题关键词建议</h4>
                  <p className="mt-1 text-[11px] text-[#667085]">根据主题描述、已有关键词和关注对象生成，确认后才合并。</p>
                </div>
                <button type="button" onClick={() => void requestTopicKeywordSuggestions()} disabled={topicSuggesting || activeExecutionId !== null} className="inline-flex items-center gap-1.5 rounded-md border border-[#C8D7F0] bg-white px-2.5 py-1.5 text-[11px] font-semibold text-[#315EA8] disabled:opacity-50"><Sparkles className="size-3" />{topicSuggesting ? "生成中…" : "补充关键词"}</button>
              </div>
              {topicKeywordSuggestions.length > 0 && <>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{topicKeywordSuggestions.map((suggestion) => <label key={suggestion} className="flex cursor-pointer items-center gap-2 rounded-lg border border-[#E4E9F0] bg-white px-3 py-2 text-xs text-[#344054]"><input type="checkbox" checked={selectedTopicSuggestions.includes(suggestion)} onChange={(event) => setSelectedTopicSuggestions((current) => event.target.checked ? [...current, suggestion] : current.filter((item) => item !== suggestion))} className="size-3.5 accent-[#315EA8]" />{suggestion}</label>)}</div>
                <div className="mt-3 flex justify-end"><button type="button" onClick={mergeTopicKeywordSuggestions} disabled={!selectedTopicSuggestions.length} className="rounded-md bg-[#315EA8] px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50">确认合并</button></div>
              </>}
            </div>
          </div>
          <DialogFooter className="relative z-10 shrink-0 border-t border-[#E4E9F0] bg-[#FBFCFE] px-4 py-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-4">
            <button type="button" onClick={() => setTopicDialogOpen(false)} disabled={topicSaving} className="rounded-lg border border-[#D0D5DD] px-3.5 py-2 text-sm font-semibold text-[#475467] hover:bg-white">取消</button>
            <button type="button" onClick={() => void saveTopic()} disabled={topicSaving || !topicName.trim()} className="inline-flex items-center gap-1.5 rounded-lg bg-[#2563EB] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-50">{topicSaving && <Loader2 className="size-4 animate-spin" />}保存主题</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ReportDialog execution={selectedExecution} open={reportDialogOpen} loading={reportLoading} onOpenChange={setReportDialogOpen} />
    </div>
  );
}
