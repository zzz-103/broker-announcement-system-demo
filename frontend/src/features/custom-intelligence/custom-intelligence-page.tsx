"use client";

import {
  AlertCircle,
  BrainCircuit,
  Check,
  ChevronDown,
  Clock3,
  FileText,
  Lightbulb,
  Loader2,
  LogOut,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Tag,
  X,
} from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuthStore } from "@/store/auth-store";
import { LoginPageWithApply } from "@/components/login-page-with-apply";
import { ModuleSwitcher } from "@/components/app-watch/module-switcher";
import { APP_VERSION } from "@/lib/app-version";
import { BackendApiError } from "@/lib/api/backend-client";
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
  CustomIntelligenceOption,
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

type ActiveTab = "instant" | "topics" | "executions";

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
const FIELD_SELECT_CLASS = "w-full rounded-lg border border-[#D0D5DD] bg-white px-3 py-2.5 text-sm text-[#172033] shadow-sm outline-none transition focus:border-[#4F7CFF] focus:ring-2 focus:ring-[#4F7CFF]/15";
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
  if (error.status === 0) return "无法连接后端服务，请确认 FastAPI 已启动。";
  if (error.status === 401) return "登录已失效，请重新登录。";
  if (error.status === 409) return error.message || "当前已有情报执行正在进行，请稍后再试。";
  if (error.status === 502) return "搜索服务暂不可用，请稍后重试。";
  if (error.status === 503) return "搜索服务尚未配置，请联系管理员。";
  if (error.status === 504) return "搜索服务请求超时，请稍后重试。";
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

function optionLabel<T extends string>(
  options: CustomIntelligenceOption<T>[],
  value: string | undefined,
  fallback = "—",
): string {
  return options.find((item) => item.value === value)?.label ?? fallback;
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
}: {
  value: InstantSearchRequest;
  onChange: (value: InstantSearchRequest) => void;
  options: CustomIntelligenceOptionsResponse;
  showQuestion?: boolean;
}) {
  const update = <K extends keyof InstantSearchRequest>(key: K, next: InstantSearchRequest[K]) => {
    onChange({ ...value, [key]: next });
  };
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
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <FieldLabel>分析视角</FieldLabel>
          <select value={value.analysis_perspective} onChange={(event) => update("analysis_perspective", event.target.value as IntelligencePerspective)} className={FIELD_SELECT_CLASS}>
            {options.perspectives.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </div>
        <div>
          <FieldLabel>时间范围</FieldLabel>
          <select value={value.time_range} onChange={(event) => update("time_range", event.target.value as IntelligenceTimeRange)} className={FIELD_SELECT_CLASS}>
            {options.time_ranges.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </div>
        <div>
          <FieldLabel>报告类型</FieldLabel>
          <select value={value.report_type} onChange={(event) => update("report_type", event.target.value as IntelligenceReportType)} className={FIELD_SELECT_CLASS}>
            {options.report_types.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <FieldLabel>分析深度</FieldLabel>
          <select value={value.analysis_depth} onChange={(event) => update("analysis_depth", event.target.value as IntelligenceAnalysisDepth)} className={FIELD_SELECT_CLASS}>
            {options.analysis_depths.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </div>
        <div>
          <FieldLabel>来源偏好</FieldLabel>
          <select value={value.source_preference} onChange={(event) => update("source_preference", event.target.value as IntelligenceSourcePreference)} className={FIELD_SELECT_CLASS}>
            {options.source_preferences.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </div>
        <div>
          <FieldLabel hint="可选">背景描述</FieldLabel>
          <input value={value.description} onChange={(event) => update("description", event.target.value)} maxLength={2000} placeholder="补充业务背景、判断边界或关注原因" className={FIELD_INPUT_CLASS} />
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <TagEditor label="检索关键词" values={value.keywords} onChange={(next) => update("keywords", next)} placeholder="例如：财富管理" />
        <TagEditor label="关注对象" values={value.focus_objects} onChange={(next) => update("focus_objects", next)} placeholder="例如：头部券商、投顾团队" />
      </div>
      <details className="group rounded-xl border border-[#E4E9F0] bg-[#F8FAFD] px-3.5 py-3">
        <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-semibold text-[#344054]">
          <span className="inline-flex items-center gap-1.5"><ChevronDown className="size-4 transition group-open:rotate-180" />高级检索设置</span>
          <span className="text-[10px] font-normal text-[#98A2B3]">指定站点、额外要求</span>
        </summary>
        <div className="mt-3 space-y-4 border-t border-[#E4E9F0] pt-3">
          <TagEditor label="指定站点" values={value.specified_sites} onChange={(next) => update("specified_sites", next)} placeholder="例如：csrc.gov.cn" hint="仅填写域名；服务端会再次校验" />
          <div>
            <FieldLabel hint="可选">额外要求</FieldLabel>
            <textarea value={value.extra_requirements} onChange={(event) => update("extra_requirements", event.target.value)} rows={3} maxLength={2000} placeholder="例如：结论要区分已发生事实与推测，并给出可执行的跟进建议。" className="w-full resize-y rounded-lg border border-[#D0D5DD] bg-white px-3 py-2.5 text-sm leading-6 text-[#172033] shadow-sm outline-none transition focus:border-[#4F7CFF] focus:ring-2 focus:ring-[#4F7CFF]/15" />
          </div>
        </div>
      </details>
    </div>
  );
}

function StatusPill({ status }: { status: CustomIntelligenceExecutionStatus }) {
  const style = status === "succeeded"
    ? "bg-emerald-50 text-emerald-700 border-emerald-100"
    : status === "failed"
      ? "bg-red-50 text-red-700 border-red-100"
      : status === "empty"
        ? "bg-slate-100 text-slate-600 border-slate-200"
        : "bg-amber-50 text-amber-700 border-amber-100";
  const label = status === "succeeded" ? "已完成" : status === "failed" ? "失败" : status === "empty" ? "无结果" : status === "running" ? "执行中" : "排队中";
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${style}`}>{isActiveExecution(status) && <Loader2 className="size-3 animate-spin" />}{label}</span>;
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
  const sources = execution?.sources ?? [];
  const sourceMap = useMemo(() => new Map(sources.map((source) => [source.id, source])), [sources]);
  const focusSections = (report?.focus_sections ?? []) as IntelligenceFocusSection[];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-[1120px] overflow-hidden border-[#D9E2EC] bg-white p-0">
        <DialogHeader className="border-b border-[#E4E9F0] bg-[#F8FAFD] px-6 py-5 pr-12">
          <DialogTitle className="text-lg text-[#172033]">{report?.title || execution?.topic_name || "情报执行报告"}</DialogTitle>
          <DialogDescription className="text-[#667085]">{execution ? `${formatDate(execution.completed_at || execution.created_at)} · ${execution.sources.length} 条有效来源` : "正在加载完整报告…"}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[calc(90vh-100px)] overflow-y-auto px-6 py-5">
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
  const { isLoggedIn, token, username, logout, clearAuth } = useAuthStore();
  const restoreSession = useAuthStore((state) => state.restoreSession);
  const [activeTab, setActiveTab] = useState<ActiveTab>("instant");
  const [form, setForm] = useState<InstantSearchRequest>(DEFAULT_FORM);
  const [options, setOptions] = useState<CustomIntelligenceOptionsResponse>(FALLBACK_OPTIONS);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [topics, setTopics] = useState<IntelligenceTopic[]>([]);
  const [executions, setExecutions] = useState<CustomIntelligenceExecution[]>([]);
  const [executionsTotal, setExecutionsTotal] = useState(0);
  const [loadingTopics, setLoadingTopics] = useState(false);
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

  const loadTopics = useCallback(async (signal?: AbortSignal) => {
    if (!token) return;
    setLoadingTopics(true);
    try {
      const response = await fetchCustomIntelligenceTopics(token, signal);
      setTopics(response.topics);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) handleError(error, "无法加载情报主题");
    } finally {
      if (!signal?.aborted) setLoadingTopics(false);
    }
  }, [handleError, token]);

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
      if (!(error instanceof DOMException && error.name === "AbortError")) handleError(error, "无法加载执行记录");
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
      if (!(error instanceof DOMException && error.name === "AbortError")) handleError(error, "无法加载自定义情报配置");
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
      <header className="relative z-40 flex min-w-0 flex-col overflow-hidden border-b border-blue-500/20 bg-[linear-gradient(105deg,#102847_0%,#17385F_58%,#1E4070_100%)] px-3 py-3 text-white sm:h-[76px] sm:flex-row sm:items-center sm:px-8 sm:py-0">
        <div className="relative z-10 flex min-w-0 flex-1 items-center gap-2">
          <Image src="/brand/company-icon.png" alt="世纪证券" width={36} height={36} className="size-8 shrink-0 rounded-lg sm:size-9" priority />
          <div className="min-w-0"><h1 className="truncate text-[16px] font-bold tracking-wide sm:text-[18px]">AI 自定义情报中心</h1><p className="hidden truncate text-[11px] text-[#B7C6D9] sm:block">围绕业务问题自主配置检索范围，沉淀可复用的情报主题</p></div>
          <span className="rounded border border-white/15 bg-white/10 px-1.5 py-0.5 text-[9px] text-blue-100">v{APP_VERSION}</span>
        </div>
        <div className="relative z-10 mt-2 flex min-w-0 items-center gap-1.5 text-[11px] text-slate-300 sm:mt-0 sm:gap-4 sm:text-[12px]">
          <div className="flex shrink-0 items-center border-r border-white/10 pr-1.5 sm:border-l sm:border-r-0 sm:pr-0 sm:pl-3.5"><ModuleSwitcher activeModule="custom-intelligence" /></div>
          <div className="hidden items-center gap-1.5 border-r border-white/10 pr-3.5 md:flex"><span className="size-1.5 rounded-full bg-emerald-400" />当前登录：<span className="font-medium text-white">{username}</span></div>
          <button onClick={logout} className="inline-flex items-center gap-1 rounded-lg border border-white/15 px-2.5 py-1.5 text-slate-200 transition hover:bg-white/10 hover:text-white"><LogOut className="size-3.5" /><span className="hidden sm:inline">退出</span></button>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] min-w-0 space-y-4 px-3 py-4 sm:px-8 sm:py-5">
        {(pageError || notice) && <div className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${pageError ? "border-red-100 bg-red-50 text-red-700" : "border-blue-100 bg-blue-50 text-blue-700"}`}><AlertCircle className="mt-0.5 size-4 shrink-0" /><span className="whitespace-pre-wrap break-words">{pageError || notice}</span><button className="ml-auto shrink-0 opacity-60 hover:opacity-100" onClick={() => { setPageError(""); setNotice(""); }} aria-label="关闭提示"><X className="size-4" /></button></div>}
        {!optionsLoading && !options.service_configured && <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-800">搜索服务尚未配置。你仍可先编辑和保存主题，执行时请联系管理员完成服务端配置。</div>}
        <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#6B8BC7]">CUSTOM INTELLIGENCE</p><h2 className="mt-1 text-2xl font-bold tracking-tight text-[#172033] sm:text-[28px]">把问题变成可追踪的情报任务</h2></div><div className="rounded-lg border border-[#E4E9F0] bg-white px-3 py-2 text-xs text-[#667085]">{activeExecutionId !== null ? <span className="inline-flex items-center gap-1.5 text-amber-700"><Loader2 className="size-3.5 animate-spin" />有一条情报正在执行</span> : <span className="inline-flex items-center gap-1.5 text-emerald-700"><Check className="size-3.5" />当前无执行中的任务</span>}</div></div>

        <div className="flex gap-1 overflow-x-auto border-b border-[#DDE5F0]">
          {([ ["instant", "即时搜索", Search], ["topics", "情报主题", Tag], ["executions", "执行记录", Clock3] ] as const).map(([tab, label, Icon]) => <button key={tab} onClick={() => setActiveTab(tab)} className={`inline-flex shrink-0 items-center gap-1.5 border-b-2 px-4 py-2.5 text-sm font-semibold transition ${activeTab === tab ? "border-[#3568C8] text-[#2455AC]" : "border-transparent text-[#667085] hover:text-[#344054]"}`}><Icon className="size-4" />{label}{tab === "executions" && executionsTotal > 0 && <span className="rounded-full bg-[#EEF4FF] px-1.5 text-[10px] text-[#315EA8]">{executionsTotal}</span>}</button>)}
        </div>

        {activeTab === "instant" && <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
          <div className="rounded-2xl border border-[#E4E9F0] bg-white p-4 shadow-[0_4px_18px_rgba(16,40,71,0.05)] sm:p-6"><div className="mb-5 flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-base font-bold text-[#172033]">即时情报搜索</h3><p className="mt-1 text-xs leading-5 text-[#667085]">填写一个明确的问题，选择分析口径后即可生成一次独立报告。</p></div><button onClick={openCreateTopic} disabled={activeExecutionId !== null} className="inline-flex items-center gap-1.5 rounded-lg border border-[#C8D7F0] px-3 py-2 text-xs font-semibold text-[#315EA8] transition hover:bg-[#EEF4FF] disabled:cursor-not-allowed disabled:opacity-50"><Plus className="size-3.5" />保存为主题</button></div><div className="mb-5"><ConfigFields value={form} onChange={setForm} options={visibleOptions} /></div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#E4E9F0] pt-4"><button onClick={requestKeywordSuggestions} disabled={suggesting || activeExecutionId !== null} className="inline-flex items-center gap-1.5 rounded-lg border border-[#C8D7F0] bg-[#F8FAFD] px-3 py-2 text-xs font-semibold text-[#315EA8] transition hover:bg-[#EEF4FF] disabled:cursor-not-allowed disabled:opacity-50"><Sparkles className="size-3.5" />{suggesting ? "正在生成建议…" : "AI 建议关键词"}</button><button onClick={submitInstant} disabled={activeExecutionId !== null || !form.question.trim() || optionsLoading} className="inline-flex items-center gap-2 rounded-lg bg-[#2563EB] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_3px_10px_rgba(37,99,235,0.25)] transition hover:bg-[#1D4ED8] disabled:cursor-not-allowed disabled:opacity-50"><Play className="size-4" />开始即时搜索</button></div>
            {keywordSuggestions.length > 0 && <div className="mt-4 rounded-xl border border-[#C8D7F0] bg-[#F8FAFD] p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><h4 className="text-sm font-bold text-[#243B61]">AI 关键词建议</h4><p className="mt-1 text-[11px] text-[#667085]">先勾选需要的词，确认后才会加入当前配置。</p></div><div className="flex gap-2"><button onClick={() => setSelectedSuggestions(selectedSuggestions.length === keywordSuggestions.length ? [] : keywordSuggestions)} className="rounded-md border border-[#D0D5DD] px-2.5 py-1.5 text-[11px] text-[#475467]">{selectedSuggestions.length === keywordSuggestions.length ? "取消全选" : "全选"}</button><button onClick={mergeKeywordSuggestions} disabled={!selectedSuggestions.length} className="rounded-md bg-[#315EA8] px-2.5 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50">确认合并</button></div></div><div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{keywordSuggestions.map((suggestion) => <label key={suggestion} className="flex cursor-pointer items-center gap-2 rounded-lg border border-[#E4E9F0] bg-white px-3 py-2 text-xs text-[#344054] hover:border-[#9FB9E8]"><input type="checkbox" checked={selectedSuggestions.includes(suggestion)} onChange={(event) => setSelectedSuggestions((current) => event.target.checked ? [...current, suggestion] : current.filter((item) => item !== suggestion))} className="size-3.5 accent-[#315EA8]" />{suggestion}</label>)}</div></div>}
          </div>
          <aside className="space-y-4"><div className="rounded-2xl border border-[#E4E9F0] bg-white p-4 shadow-[0_4px_18px_rgba(16,40,71,0.04)]"><h3 className="flex items-center gap-1.5 text-sm font-bold text-[#172033]"><Lightbulb className="size-4 text-amber-500" />推荐问题</h3><p className="mt-1 text-[11px] leading-5 text-[#667085]">快速套用一个分析框架，再按需补充关键词和关注对象。</p><div className="mt-3 space-y-2">{options.preset_questions.length ? options.preset_questions.map((preset) => <button key={preset.id} onClick={() => setForm((current) => ({ ...current, question: preset.question, analysis_perspective: preset.analysis_perspective, report_type: preset.report_type }))} className="w-full rounded-lg border border-[#E4E9F0] bg-[#FBFCFE] p-3 text-left transition hover:border-[#9FB9E8] hover:bg-[#F8FAFD]"><p className="text-xs font-semibold text-[#315EA8]">{preset.title}</p><p className="mt-1 line-clamp-2 text-[11px] leading-5 text-[#667085]">{preset.question}</p></button>) : <p className="text-xs text-[#98A2B3]">暂无预设问题。</p>}</div></div><div className="rounded-2xl border border-[#E4E9F0] bg-[#F8FAFD] p-4"><h3 className="text-sm font-bold text-[#243B61]">使用提示</h3><ul className="mt-2 space-y-2 text-xs leading-5 text-[#667085]"><li>• 问题越具体，检索结果越容易聚焦。</li><li>• 指定站点只填写域名，适合限定监管机构或券商官网。</li><li>• 报告生成后可保存为主题，下一次一键复用。</li></ul></div></aside>
        </section>}

        {activeTab === "topics" && <section className="rounded-2xl border border-[#E4E9F0] bg-white p-4 shadow-[0_4px_18px_rgba(16,40,71,0.05)] sm:p-6"><div className="mb-5 flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-base font-bold text-[#172033]">情报主题</h3><p className="mt-1 text-xs text-[#667085]">保存常用配置，按需启停或手动执行。主题属于当前登录用户。</p></div><button onClick={openCreateTopic} className="inline-flex items-center gap-1.5 rounded-lg bg-[#2563EB] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#1D4ED8]"><Plus className="size-3.5" />新建主题</button></div>{loadingTopics ? <div className="flex items-center gap-2 py-10 text-sm text-[#667085]"><Loader2 className="size-4 animate-spin" />正在加载主题…</div> : topics.length === 0 ? <div className="rounded-xl border border-dashed border-[#C8D7F0] bg-[#F8FAFD] py-12 text-center"><BrainCircuit className="mx-auto size-8 text-[#9FB9E8]" /><p className="mt-3 text-sm font-semibold text-[#344054]">还没有保存的情报主题</p><p className="mt-1 text-xs text-[#98A2B3]">可以从即时搜索配置中保存，或直接新建。</p></div> : <div className="grid gap-3 lg:grid-cols-2">{topics.map((topic) => <article key={topic.id} className={`rounded-xl border p-4 transition ${topic.enabled ? "border-[#D8E4F7] bg-white" : "border-[#E4E9F0] bg-[#FAFBFC] opacity-75"}`}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h4 className="truncate text-sm font-bold text-[#243B61]">{topic.name}</h4><p className="mt-1 line-clamp-2 text-xs leading-5 text-[#667085]">{topic.description || "未填写主题描述"}</p></div><span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${topic.enabled ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{topic.enabled ? "已启用" : "已停用"}</span></div><div className="mt-3 flex flex-wrap gap-1.5">{topic.keywords.slice(0, 5).map((keyword) => <span key={keyword} className="rounded bg-[#EEF4FF] px-1.5 py-0.5 text-[10px] text-[#315EA8]">{keyword}</span>)}{topic.keywords.length > 5 && <span className="text-[10px] text-[#98A2B3]">+{topic.keywords.length - 5}</span>}</div><p className="mt-3 text-[10px] text-[#98A2B3]">{optionLabel(visibleOptions.perspectives, topic.analysis_perspective)} · {optionLabel(visibleOptions.time_ranges, topic.time_range)} · 更新于 {formatDate(topic.updated_at)}</p><div className="mt-4 flex flex-wrap gap-2 border-t border-[#E4E9F0] pt-3"><button onClick={() => toggleTopic(topic)} disabled={topicUpdatingId === topic.id || activeExecutionId !== null} className="rounded-md border border-[#D0D5DD] px-2.5 py-1.5 text-[11px] font-semibold text-[#475467] hover:bg-[#F8FAFD] disabled:opacity-50">{topicUpdatingId === topic.id ? "保存中…" : topic.enabled ? "停用" : "启用"}</button><button onClick={() => openEditTopic(topic)} className="inline-flex items-center gap-1 rounded-md border border-[#D0D5DD] px-2.5 py-1.5 text-[11px] font-semibold text-[#475467] hover:bg-[#F8FAFD]"><Pencil className="size-3" />编辑</button><button onClick={() => executeTopic(topic)} disabled={!topic.enabled || activeExecutionId !== null} className="ml-auto inline-flex items-center gap-1 rounded-md bg-[#2563EB] px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-[#1D4ED8] disabled:cursor-not-allowed disabled:opacity-45"><Play className="size-3" />手动执行</button></div></article>)}</div>}</section>}

        {activeTab === "executions" && <section className="rounded-2xl border border-[#E4E9F0] bg-white p-4 shadow-[0_4px_18px_rgba(16,40,71,0.05)] sm:p-6"><div className="mb-5 flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-base font-bold text-[#172033]">执行记录</h3><p className="mt-1 text-xs text-[#667085]">查看每次检索的状态、来源与完整报告；失败记录可重新执行。</p></div><button onClick={() => void loadExecutions()} disabled={loadingExecutions} className="inline-flex items-center gap-1.5 rounded-lg border border-[#D0D5DD] px-3 py-2 text-xs font-semibold text-[#475467] hover:bg-[#F8FAFD] disabled:opacity-50"><RefreshCw className={`size-3.5 ${loadingExecutions ? "animate-spin" : ""}`} />刷新记录</button></div>{loadingExecutions && executions.length === 0 ? <div className="flex items-center gap-2 py-10 text-sm text-[#667085]"><Loader2 className="size-4 animate-spin" />正在加载执行记录…</div> : executions.length === 0 ? <div className="rounded-xl border border-dashed border-[#C8D7F0] bg-[#F8FAFD] py-12 text-center"><FileText className="mx-auto size-8 text-[#9FB9E8]" /><p className="mt-3 text-sm font-semibold text-[#344054]">暂无执行记录</p><p className="mt-1 text-xs text-[#98A2B3]">完成一次即时搜索或主题执行后，结果会显示在这里。</p></div> : <div className="space-y-3">{executions.map((execution) => <article key={execution.id} className={`rounded-xl border p-4 ${isActiveExecution(execution.status) ? "border-amber-200 bg-amber-50/30" : "border-[#E4E9F0] bg-white"}`}><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h4 className="truncate text-sm font-bold text-[#243B61]">{execution.topic_name || (execution.trigger_type === "instant" ? "即时搜索" : "自定义情报执行")}</h4><StatusPill status={execution.status} /><span className="rounded bg-[#F2F4F7] px-1.5 py-0.5 text-[10px] text-[#667085]">{execution.trigger_type === "topic" ? "主题执行" : execution.trigger_type === "rerun" ? "重跑" : "即时搜索"}</span></div><p className="mt-1 line-clamp-2 text-xs leading-5 text-[#667085]">{execution.original_query || execution.snapshot.question || "未记录问题"}</p></div><div className="shrink-0 text-right text-[11px] text-[#98A2B3]">{formatDate(execution.created_at)}</div></div><div className="mt-3 grid gap-2 text-xs text-[#667085] sm:grid-cols-3"><span>来源数：<b className="text-[#344054]">{execution.sources.length}</b></span><span>完成时间：<b className="text-[#344054]">{formatDate(execution.completed_at)}</b></span><span className="truncate">{execution.error_message ? <span className="text-red-600">错误：{execution.error_message}</span> : <span>报告：{execution.report?.title || "待生成"}</span>}</span></div><div className="mt-3 flex flex-wrap justify-end gap-2 border-t border-[#E4E9F0] pt-3"><button onClick={() => void openReport(execution)} disabled={!execution.report && isActiveExecution(execution.status)} className="inline-flex items-center gap-1 rounded-md border border-[#C8D7F0] px-2.5 py-1.5 text-[11px] font-semibold text-[#315EA8] hover:bg-[#EEF4FF] disabled:cursor-not-allowed disabled:opacity-50"><FileText className="size-3" />{isActiveExecution(execution.status) ? "执行中" : "查看报告"}</button><button onClick={() => void rerun(execution)} disabled={activeExecutionId !== null || isActiveExecution(execution.status)} className="inline-flex items-center gap-1 rounded-md border border-[#D0D5DD] px-2.5 py-1.5 text-[11px] font-semibold text-[#475467] hover:bg-[#F8FAFD] disabled:cursor-not-allowed disabled:opacity-50"><RefreshCw className="size-3" />重跑</button></div></article>)}</div>}</section>}
      </main>

      <Dialog open={topicDialogOpen} onOpenChange={(open) => !topicSaving && setTopicDialogOpen(open)}>
        <DialogContent className="max-h-[90vh] max-w-[920px] overflow-hidden border-[#D9E2EC] bg-white p-0"><DialogHeader className="border-b border-[#E4E9F0] bg-[#F8FAFD] px-6 py-5 pr-12"><DialogTitle className="text-base text-[#172033]">{topicEditorId === null ? "保存为情报主题" : "编辑情报主题"}</DialogTitle><DialogDescription className="text-[#667085]">主题保存后可在列表中启停和手动执行。</DialogDescription></DialogHeader><div className="max-h-[calc(90vh-160px)] overflow-y-auto px-6 py-5"><div className="mb-4"><FieldLabel hint="必填">主题名称</FieldLabel><input value={topicName} onChange={(event) => setTopicName(event.target.value)} maxLength={120} placeholder="例如：券商财富管理竞争监测" className={FIELD_INPUT_CLASS} /></div><ConfigFields value={topicDraft} onChange={setTopicDraft} options={visibleOptions} showQuestion={false} /><div className="mt-4 rounded-xl border border-[#C8D7F0] bg-[#F8FAFD] p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><h4 className="text-sm font-bold text-[#243B61]">主题关键词建议</h4><p className="mt-1 text-[11px] text-[#667085]">根据主题描述、已有关键词和关注对象生成，确认后才合并。</p></div><button type="button" onClick={() => void requestTopicKeywordSuggestions()} disabled={topicSuggesting || activeExecutionId !== null} className="inline-flex items-center gap-1.5 rounded-md border border-[#C8D7F0] bg-white px-2.5 py-1.5 text-[11px] font-semibold text-[#315EA8] disabled:opacity-50"><Sparkles className="size-3" />{topicSuggesting ? "生成中…" : "AI 补充关键词"}</button></div>{topicKeywordSuggestions.length > 0 && <><div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{topicKeywordSuggestions.map((suggestion) => <label key={suggestion} className="flex cursor-pointer items-center gap-2 rounded-lg border border-[#E4E9F0] bg-white px-3 py-2 text-xs text-[#344054]"><input type="checkbox" checked={selectedTopicSuggestions.includes(suggestion)} onChange={(event) => setSelectedTopicSuggestions((current) => event.target.checked ? [...current, suggestion] : current.filter((item) => item !== suggestion))} className="size-3.5 accent-[#315EA8]" />{suggestion}</label>)}</div><div className="mt-3 flex justify-end"><button type="button" onClick={mergeTopicKeywordSuggestions} disabled={!selectedTopicSuggestions.length} className="rounded-md bg-[#315EA8] px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50">确认合并</button></div></>}</div></div><DialogFooter className="border-t border-[#E4E9F0] bg-[#FBFCFE] px-6 py-4"><button type="button" onClick={() => setTopicDialogOpen(false)} disabled={topicSaving} className="rounded-lg border border-[#D0D5DD] px-3.5 py-2 text-sm font-semibold text-[#475467] hover:bg-white">取消</button><button type="button" onClick={() => void saveTopic()} disabled={topicSaving || !topicName.trim()} className="inline-flex items-center gap-1.5 rounded-lg bg-[#2563EB] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-50">{topicSaving && <Loader2 className="size-4 animate-spin" />}保存主题</button></DialogFooter></DialogContent>
      </Dialog>
      <ReportDialog execution={selectedExecution} open={reportDialogOpen} loading={reportLoading} onOpenChange={setReportDialogOpen} />
    </div>
  );
}
