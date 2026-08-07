"use client";

import { FileText, Loader2, RefreshCw, Search } from "lucide-react";
import type {
  CustomIntelligenceExecution,
  CustomIntelligenceExecutionStatus,
} from "@/lib/api/contracts";
import {
  canSaveExecutionAsConfig,
  formatExecutionDate,
  isActiveExecution,
} from "./custom-intelligence-utils";
import { RowMenu } from "./row-menu";

function statusText(status: CustomIntelligenceExecutionStatus, analysisFailed: boolean): string {
  if (isActiveExecution(status)) return "执行中";
  if (status === "succeeded") return analysisFailed ? "分析失败" : "已完成";
  if (status === "failed") return "失败";
  if (status === "empty") return "无结果";
  return "待执行";
}

function statusColor(status: CustomIntelligenceExecutionStatus, analysisFailed: boolean): string {
  if (isActiveExecution(status)) return "text-amber-600";
  if (status === "succeeded") return analysisFailed ? "text-amber-600" : "text-emerald-600";
  if (status === "failed") return "text-red-600";
  return "text-[#667085]";
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

function resultSummary(execution: CustomIntelligenceExecution): string {
  const conclusion = (execution.report?.core_conclusion || "").trim();
  if (conclusion) return conclusion.split("\n").filter(Boolean)[0] || conclusion;
  return execution.report?.title || "报告已生成";
}

interface ExecutionListProps {
  executions: CustomIntelligenceExecution[];
  loading: boolean;
  serviceAvailable: boolean;
  analysisAvailable: boolean;
  page: number;
  totalPages: number;
  total: number;
  onPageChange: (page: number) => void;
  onRefresh: () => void;
  onStartSearch: () => void;
  onSaveTopic: (execution: CustomIntelligenceExecution) => void;
  onOpenReport: (execution: CustomIntelligenceExecution) => void;
  onRerun: (execution: CustomIntelligenceExecution) => void;
  onReanalyze: (execution: CustomIntelligenceExecution) => void;
  activeExecutionId: number | null;
}

/**
 * 页码窗口：最多显示 7 个页码，超出时用省略号收拢。
 */
function pageNumberWindow(page: number, totalPages: number): (number | "ellipsis")[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);
  const pages = new Set<number>([1, totalPages, page - 1, page, page + 1]);
  if (page <= 3) { pages.add(2); pages.add(3); pages.add(4); }
  if (page >= totalPages - 2) { pages.add(totalPages - 1); pages.add(totalPages - 2); pages.add(totalPages - 3); }
  const sorted = [...pages].filter((value) => value >= 1 && value <= totalPages).sort((a, b) => a - b);
  const result: (number | "ellipsis")[] = [];
  let previous = 0;
  for (const value of sorted) {
    if (previous && value - previous > 1) result.push("ellipsis");
    result.push(value);
    previous = value;
  }
  return result;
}

export function ExecutionList({
  executions,
  loading,
  serviceAvailable,
  analysisAvailable,
  page,
  totalPages,
  total,
  onPageChange,
  onRefresh,
  onStartSearch,
  onSaveTopic,
  onOpenReport,
  onRerun,
  onReanalyze,
  activeExecutionId,
}: ExecutionListProps) {
  const serviceError = serviceErrorNotice(executions.map((execution) => execution.error_message));
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-[#172033]">执行记录</h3>
          <p className="mt-1 text-xs text-[#667085]">按时间查看状态和报告，低频操作收纳在行末菜单。</p>
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
          <table className="w-full min-w-[860px] table-fixed text-left" aria-label="自定义情报执行记录">
            <colgroup>
              <col className="w-[36%]" />
              <col className="w-[17%]" />
              <col className="w-[47%]" />
            </colgroup>
            <thead className="border-b border-[#E4EAF2] bg-[#F8FAFC] text-[11px] font-semibold text-[#667085]">
              <tr>
                <th className="px-3 py-2.5">任务</th>
                <th className="px-3 py-2.5">状态 / 时间</th>
                <th className="px-3 py-2.5">结果</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0F2F5]">
              {executions.map((execution) => {
                const active = isActiveExecution(execution.status);
                const analysisFailed = execution.search_status === "succeeded" && execution.analysis_status === "failed";
                const searchSucceeded = execution.search_status === "succeeded";
                const title = execution.topic_name || (execution.trigger_type === "instant" ? "即时搜索" : "自定义情报执行");
                const query = execution.original_query || execution.snapshot.question || "未记录问题";
                const triggerLabel = execution.trigger_type === "topic" ? "配置" : execution.trigger_type === "rerun" ? "重新执行" : "即时";
                const canSaveConfig = canSaveExecutionAsConfig(execution);
                return (
                  <tr key={execution.id} className={active ? "bg-amber-50/30" : "bg-white"}>
                    <td className="max-w-0 px-3 py-3 align-top">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-xs font-semibold text-[#243B61]" title={title}>{title}</span>
                        <span className="shrink-0 rounded bg-[#F2F4F7] px-1.5 py-0.5 text-[10px] text-[#667085]">{triggerLabel}</span>
                      </div>
                      <p className="mt-1 truncate text-[11px] text-[#667085]" title={query}>{query}</p>
                    </td>
                    <td className="px-3 py-3 align-top">
                      <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${statusColor(execution.status, analysisFailed)}`}>
                        {active && <Loader2 className="size-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
                        {statusText(execution.status, analysisFailed)}
                      </span>
                      <span className="mt-1 block text-[11px] tabular-nums text-[#98A2B3]">{formatExecutionDate(execution.completed_at || execution.created_at)}</span>
                    </td>
                    <td className="max-w-0 px-3 py-3 align-top">
                      <div className="flex min-w-0 items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          {active ? (
                            <span className="text-[11px] text-[#667085]">正在检索并分析，完成后可查看报告…</span>
                          ) : execution.status === "failed" && !searchSucceeded ? (
                            <span className="text-[11px] text-red-600" title={execution.error_message || ""}>{errorSummary(execution.error_message)}</span>
                          ) : analysisFailed ? (
                            <span className="text-[11px] text-amber-700" title={execution.analysis_error_message || ""}>搜索完成，DeepSeek 分析失败，可重新分析</span>
                          ) : execution.status === "empty" ? (
                            <span className="text-[11px] text-[#667085]">未检索到有效来源</span>
                          ) : (
                            <span className="block truncate text-[11px] text-[#667085]" title={resultSummary(execution)}>{resultSummary(execution)}</span>
                          )}
                          {!active && searchSucceeded && (
                            <span className="mt-1 block text-[10px] text-[#98A2B3]">来源 {execution.sources.length} 条</span>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          {!active && searchSucceeded && (
                            <button type="button" onClick={() => onOpenReport(execution)} className="inline-flex items-center gap-1 rounded-md border border-[#C8D7F0] px-2 py-1 text-[10px] font-semibold text-[#315EA8] hover:bg-[#EEF4FF]">
                              <FileText className="size-3" aria-hidden="true" />{execution.analysis_status === "succeeded" ? "查看报告" : "查看原始结果"}
                            </button>
                          )}
                          {!active && execution.status === "failed" && !searchSucceeded && (
                            <button type="button" onClick={() => onRerun(execution)} disabled={activeExecutionId !== null || !serviceAvailable} className="inline-flex items-center gap-1 rounded-md border border-[#D0D5DD] px-2 py-1 text-[10px] font-semibold text-[#475467] hover:bg-[#F8FAFD] disabled:cursor-not-allowed disabled:opacity-50">
                              <RefreshCw className="size-3" aria-hidden="true" />重新执行
                            </button>
                          )}
                          <RowMenu
                            label={`执行记录 ${execution.id} 更多操作`}
                            items={[
                              { label: "查看详情", onSelect: () => onOpenReport(execution), disabled: active },
                              { label: "重新执行", onSelect: () => onRerun(execution), disabled: active || activeExecutionId !== null || !serviceAvailable },
                              { label: "重新分析", onSelect: () => onReanalyze(execution), disabled: !analysisFailed || active || activeExecutionId !== null || !analysisAvailable },
                              { label: "保存为配置", onSelect: () => onSaveTopic(execution), disabled: !canSaveConfig },
                            ]}
                          />
                        </div>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {total > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[#F0F2F5] pt-3">
          <span className="text-[11px] tabular-nums text-[#98A2B3]">共 {total} 条 · 第 {page} / {totalPages} 页</span>
          {totalPages > 1 && (
            <div className="flex items-center gap-1.5">
              <button type="button" onClick={() => onPageChange(page - 1)} disabled={page <= 1 || loading} className="rounded-md border border-[#D0D5DD] px-2.5 py-1.5 text-[11px] font-semibold text-[#475467] hover:bg-[#F8FAFD] disabled:cursor-not-allowed disabled:opacity-40">上一页</button>
              {pageNumberWindow(page, totalPages).map((item, index) => item === "ellipsis" ? (
                <span key={`ellipsis-${index}`} className="px-1 text-[11px] text-[#98A2B3]">…</span>
              ) : (
                <button key={item} type="button" onClick={() => onPageChange(item)} aria-current={item === page ? "page" : undefined} className={`min-w-[30px] rounded-md px-2 py-1.5 text-[11px] font-semibold tabular-nums transition ${item === page ? "bg-[#2563EB] text-white" : "border border-[#D0D5DD] text-[#475467] hover:bg-[#F8FAFD]"}`}>{item}</button>
              ))}
              <button type="button" onClick={() => onPageChange(page + 1)} disabled={page >= totalPages || loading} className="rounded-md border border-[#D0D5DD] px-2.5 py-1.5 text-[11px] font-semibold text-[#475467] hover:bg-[#F8FAFD] disabled:cursor-not-allowed disabled:opacity-40">下一页</button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
