"use client";

import {
  BrainCircuit,
  Clock3,
  FileText,
  Loader2,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  Tag,
} from "lucide-react";
import type {
  CustomIntelligenceExecution,
  CustomIntelligenceExecutionStatus,
  CustomIntelligenceOptionsResponse,
  IntelligenceTopic,
} from "@/lib/api/contracts";
import { formatCount, formatDateOnly } from "@/lib/display";

export type CustomIntelligenceTab = "instant" | "topics" | "executions";

interface CustomIntelligenceTabsProps {
  activeTab: CustomIntelligenceTab;
  executionCount: number;
  onChange: (tab: CustomIntelligenceTab) => void;
}

export function CustomIntelligenceTabs({
  activeTab,
  executionCount,
  onChange,
}: CustomIntelligenceTabsProps) {
  const tabs = [
    ["instant", "即时搜索", Search],
    ["topics", "情报主题", Tag],
    ["executions", "执行记录", Clock3],
  ] as const;

  return (
    <div className="flex gap-1 overflow-x-auto border-b border-[#E4EAF2]" role="tablist" aria-label="自定义情报内容">
      {tabs.map(([tab, label, Icon]) => {
        const selected = activeTab === tab;
        const panelId = `custom-intelligence-panel-${tab}`;
        return (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={panelId}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab)}
            onKeyDown={(event) => {
              if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
              event.preventDefault();
              const index = tabs.findIndex(([key]) => key === tab);
              const nextIndex = event.key === "ArrowRight"
                ? (index + 1) % tabs.length
                : (index - 1 + tabs.length) % tabs.length;
              onChange(tabs[nextIndex][0]);
              document.getElementById(`custom-intelligence-tab-${tabs[nextIndex][0]}`)?.focus();
            }}
            id={`custom-intelligence-tab-${tab}`}
            className={`inline-flex shrink-0 items-center gap-1.5 border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors motion-reduce:transition-none ${selected ? "border-[#3568C8] text-[#2455AC]" : "border-transparent text-[#667085] hover:text-[#344054]"}`}
          >
            <Icon className="size-4" aria-hidden="true" />
            {label}
            {tab === "executions" && executionCount > 0 && (
              <span className="rounded bg-[#EEF4FF] px-1.5 text-[10px] text-[#315EA8]" aria-label={`${formatCount(executionCount)} 条记录`}>
                {formatCount(executionCount)}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function optionLabel(
  options: CustomIntelligenceOptionsResponse["perspectives"] | CustomIntelligenceOptionsResponse["time_ranges"],
  value: string | undefined,
): string {
  return options.find((item) => item.value === value)?.label ?? "—";
}

interface TopicListProps {
  topics: IntelligenceTopic[];
  loading: boolean;
  options: CustomIntelligenceOptionsResponse;
  activeExecutionId: number | null;
  topicUpdatingId: number | null;
  onCreate: () => void;
  onToggle: (topic: IntelligenceTopic) => void;
  onEdit: (topic: IntelligenceTopic) => void;
  onExecute: (topic: IntelligenceTopic) => void;
}

export function TopicList({
  topics,
  loading,
  options,
  activeExecutionId,
  topicUpdatingId,
  onCreate,
  onToggle,
  onEdit,
  onExecute,
}: TopicListProps) {
  if (loading && topics.length === 0) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-[#667085]" role="status" aria-live="polite">
        <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        正在加载主题…
      </div>
    );
  }

  if (topics.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[#C8D7F0] bg-[#F8FAFD] py-8 text-center" role="status">
        <BrainCircuit className="mx-auto size-7 text-[#9FB9E8]" aria-hidden="true" />
        <p className="mt-2 text-sm font-semibold text-[#344054]">暂无情报主题</p>
        <p className="mt-1 text-xs text-[#98A2B3]">保存主题后可在此启停或执行。</p>
        <button type="button" onClick={onCreate} className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-[#2563EB] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1D4ED8]">
          <Plus className="size-3.5" aria-hidden="true" />新建主题
        </button>
      </div>
    );
  }

  return (
    <div className="divide-y divide-[#E4EAF2]" aria-busy={loading}>
      {topics.map((topic) => (
        <article key={topic.id} className={`grid gap-3 px-3 py-3.5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center ${topic.enabled ? "bg-white" : "bg-[#FAFBFC]"}`}>
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <h4 className="min-w-0 truncate text-sm font-semibold text-[#243B61]" title={topic.name}>{topic.name}</h4>
              <span className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold ${topic.enabled ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                {topic.enabled ? "已启用" : "已停用"}
              </span>
            </div>
            <p className="mt-1 truncate text-xs text-[#667085]" title={topic.description || "未填写主题描述"}>{topic.description || "未填写主题描述"}</p>
            <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5 text-[10px] text-[#98A2B3]">
              <span>{optionLabel(options.perspectives, topic.analysis_perspective)}</span>
              <span aria-hidden="true">·</span>
              <span>{optionLabel(options.time_ranges, topic.time_range)}</span>
              <span aria-hidden="true">·</span>
              <span>更新于 {topic.updated_at ? formatDateOnly(topic.updated_at) : "—"}</span>
              {topic.keywords.slice(0, 4).map((keyword) => (
                <span key={keyword} className="rounded bg-[#EEF4FF] px-1.5 py-0.5 text-[#315EA8]" title={keyword}>{keyword}</span>
              ))}
              {topic.keywords.length > 4 && <span>+{topic.keywords.length - 4}</span>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2 border-t border-[#F0F2F5] pt-2 lg:border-t-0 lg:pt-0">
            <button type="button" onClick={() => onToggle(topic)} disabled={topicUpdatingId === topic.id || activeExecutionId !== null} className="rounded-md border border-[#D0D5DD] px-2.5 py-1.5 text-[11px] font-semibold text-[#475467] hover:bg-[#F8FAFD] disabled:cursor-not-allowed disabled:opacity-50">
              {topicUpdatingId === topic.id ? "保存中…" : topic.enabled ? "停用" : "启用"}
            </button>
            <button type="button" onClick={() => onEdit(topic)} className="inline-flex items-center gap-1 rounded-md border border-[#D0D5DD] px-2.5 py-1.5 text-[11px] font-semibold text-[#475467] hover:bg-[#F8FAFD]">
              <Pencil className="size-3" aria-hidden="true" />编辑
            </button>
            <button type="button" onClick={() => onExecute(topic)} disabled={!topic.enabled || activeExecutionId !== null} className="inline-flex items-center gap-1 rounded-md bg-[#2563EB] px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-[#1D4ED8] disabled:cursor-not-allowed disabled:opacity-45 lg:ml-auto">
              <Play className="size-3" aria-hidden="true" />立即执行
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}

function isActiveExecution(status: CustomIntelligenceExecutionStatus): boolean {
  return status === "pending" || status === "running";
}

function StatusPill({ status }: { status: CustomIntelligenceExecutionStatus }) {
  const style = status === "succeeded"
    ? "bg-emerald-50 text-emerald-700 border-emerald-100"
    : status === "failed"
      ? "bg-red-50 text-red-700 border-red-100"
      : status === "empty"
        ? "bg-slate-100 text-slate-600 border-slate-200"
        : "bg-amber-50 text-amber-700 border-amber-100";
  const label = status === "succeeded" ? "已完成" : status === "failed" ? "失败" : status === "empty" ? "无结果" : status === "running" ? "执行中" : "待执行";
  return (
    <span className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] font-semibold ${style}`}>
      {isActiveExecution(status) && <Loader2 className="size-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
      {label}
    </span>
  );
}

function formatExecutionDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.replace("T", " ").slice(0, 16);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * 失败记录的简短摘要。完整原始错误在“查看详情”中展示，避免列表逐行重复。
 */
function errorSummary(message: string | null | undefined): string {
  if (!message) return "执行失败";
  if (/欠费|账单逾期|account_overdue/i.test(message)) return "搜索服务不可用";
  if (/HTTP (401|403)\b/i.test(message)) return "搜索服务鉴权异常";
  if (/超时|timeout/i.test(message)) return "搜索服务超时";
  if (/频率|额度|限流/i.test(message) || /429/.test(message)) return "搜索服务已达限制";
  if (/未配置|尚未配置/i.test(message)) return "搜索服务未配置";
  return "执行失败";
}

/**
 * 服务级错误提示：多条失败记录共享同一根因时，只在列表顶部提示一次。
 */
function serviceErrorNotice(errors: (string | null | undefined)[]): string | null {
  if (errors.some((message) => /欠费|账单逾期|account_overdue/i.test(message ?? ""))) {
    return "当前搜索服务不可用，请检查账户状态后重试。";
  }
  if (errors.some((message) => /HTTP (401|403)\b/i.test(message ?? ""))) {
    return "当前搜索服务鉴权异常，请检查服务端配置后重试。";
  }
  if (errors.some((message) => /频率|额度|限流/i.test(message ?? "") || /429/.test(message ?? ""))) {
    return "当前搜索服务已达频率或额度限制，请稍后重试。";
  }
  if (errors.some((message) => /超时|timeout/i.test(message ?? ""))) {
    return "当前搜索服务响应超时，请稍后重试。";
  }
  return null;
}

interface ExecutionListProps {
  executions: CustomIntelligenceExecution[];
  loading: boolean;
  onRefresh: () => void;
  onStartSearch: () => void;
  onSaveTopic: (execution: CustomIntelligenceExecution) => void;
  onOpenReport: (execution: CustomIntelligenceExecution) => void;
  onRerun: (execution: CustomIntelligenceExecution) => void;
  activeExecutionId: number | null;
}

export function ExecutionList({
  executions,
  loading,
  onRefresh,
  onStartSearch,
  onSaveTopic,
  onOpenReport,
  onRerun,
  activeExecutionId,
}: ExecutionListProps) {
  const serviceError = serviceErrorNotice(executions.map((execution) => execution.error_message));
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-[#172033]">执行记录</h3>
          <p className="mt-1 text-xs text-[#667085]">按时间查看状态和报告。</p>
        </div>
        <button type="button" onClick={onRefresh} disabled={loading} className="inline-flex items-center gap-1.5 rounded-md border border-[#D0D5DD] px-3 py-1.5 text-xs font-semibold text-[#475467] hover:bg-[#F8FAFD] disabled:cursor-not-allowed disabled:opacity-50">
          <RefreshCw className={`size-3.5 ${loading ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden="true" />刷新
        </button>
      </div>
      {serviceError && (
        <div role="alert" className="mb-4 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2.5 text-xs leading-5 text-amber-800">
          {serviceError}
        </div>
      )}
      {loading && executions.length === 0 ? (
        <div className="flex items-center gap-2 py-10 text-sm text-[#667085]" role="status" aria-live="polite">
          <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />正在加载执行记录…
        </div>
      ) : executions.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[#C8D7F0] bg-[#F8FAFD] py-8 text-center" role="status">
          <FileText className="mx-auto size-7 text-[#9FB9E8]" aria-hidden="true" />
          <p className="mt-2 text-sm font-semibold text-[#344054]">暂无执行记录</p>
          <p className="mt-1 text-xs text-[#98A2B3]">完成一次搜索后，结果会显示在这里。</p>
          <button type="button" onClick={onStartSearch} className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-[#2563EB] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1D4ED8]">
            <Search className="size-3.5" aria-hidden="true" />开始搜索
          </button>
        </div>
      ) : (
        <div className="overflow-x-auto" aria-busy={loading}>
          <table className="w-full min-w-[920px] table-fixed text-left" aria-label="自定义情报执行记录">
            <colgroup>
              <col className="w-[37%]" />
              <col className="w-[13%]" />
              <col className="w-[16%]" />
              <col className="w-[20%]" />
              <col className="w-[14%]" />
            </colgroup>
            <thead className="border-b border-[#E4EAF2] bg-[#F8FAFC] text-[11px] font-semibold text-[#667085]">
              <tr>
                <th className="px-3 py-2.5">任务</th>
                <th className="px-3 py-2.5">状态</th>
                <th className="px-3 py-2.5">执行时间</th>
                <th className="px-3 py-2.5">结果摘要</th>
                <th className="px-3 py-2.5 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0F2F5]">
              {executions.map((execution) => {
                const active = isActiveExecution(execution.status);
                const title = execution.topic_name || (execution.trigger_type === "instant" ? "即时搜索" : "自定义情报执行");
                const query = execution.original_query || execution.snapshot.question || "未记录问题";
                const rowError = execution.error_message ? `错误：${errorSummary(execution.error_message)}` : `报告：${execution.report?.title || "待生成"}`;
                return (
                  <tr key={execution.id} className={active ? "bg-amber-50/30" : "bg-white"}>
                    <td className="max-w-0 px-3 py-3 align-top">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-xs font-semibold text-[#243B61]" title={title}>{title}</span>
                        <span className="shrink-0 rounded bg-[#F2F4F7] px-1.5 py-0.5 text-[10px] text-[#667085]">{execution.trigger_type === "topic" ? "主题" : execution.trigger_type === "rerun" ? "重新执行" : "即时"}</span>
                      </div>
                      <p className="mt-1 truncate text-[11px] text-[#667085]" title={query}>{query}</p>
                    </td>
                    <td className="px-3 py-3 align-top"><StatusPill status={execution.status} /></td>
                    <td className="px-3 py-3 align-top text-[11px] tabular-nums text-[#667085]">{formatExecutionDate(execution.created_at)}</td>
                    <td className="max-w-0 px-3 py-3 align-top text-[11px] text-[#667085]">
                      <span className="block truncate" title={rowError}><span className={execution.error_message ? "text-red-600" : ""}>{rowError}</span></span>
                      <span className="mt-1 block text-[10px] text-[#98A2B3]">来源 {execution.sources.length} 条 · 完成 {formatExecutionDate(execution.completed_at)}</span>
                    </td>
                    <td className="px-3 py-3 align-top">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {execution.status === "succeeded" && execution.trigger_type === "instant" && <button type="button" onClick={() => onSaveTopic(execution)} className="inline-flex items-center gap-1 rounded-md border border-[#C8D7F0] px-2 py-1 text-[10px] font-semibold text-[#315EA8] hover:bg-[#EEF4FF]" title="保存为主题"><Plus className="size-3" aria-hidden="true" />保存</button>}
                        <button type="button" onClick={() => onOpenReport(execution)} disabled={!execution.report && active} className="inline-flex items-center gap-1 rounded-md border border-[#C8D7F0] px-2 py-1 text-[10px] font-semibold text-[#315EA8] hover:bg-[#EEF4FF] disabled:cursor-not-allowed disabled:opacity-50"><FileText className="size-3" aria-hidden="true" />{active ? "执行中" : execution.status === "succeeded" ? "查看报告" : "查看详情"}</button>
                        <button type="button" onClick={() => onRerun(execution)} disabled={activeExecutionId !== null || active} className="inline-flex items-center gap-1 rounded-md border border-[#D0D5DD] px-2 py-1 text-[10px] font-semibold text-[#475467] hover:bg-[#F8FAFD] disabled:cursor-not-allowed disabled:opacity-50"><RefreshCw className="size-3" aria-hidden="true" />重新执行</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
