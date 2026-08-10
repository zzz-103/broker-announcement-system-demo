"use client";

import { FileText, Loader2, RefreshCw, Search } from "lucide-react";
import type { IntelligenceAssistantExecution } from "@/lib/api/contracts";

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value.replace("T", " ").slice(0, 16) : date.toLocaleString("zh-CN", { hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function statusLabel(execution: IntelligenceAssistantExecution): string {
  if (execution.status === "pending" || execution.status === "running") return "生成中";
  if (execution.status === "succeeded") return execution.analysis_status === "failed" ? "分析失败" : "已完成";
  if (execution.status === "empty") return "无结果";
  return "生成失败";
}

export function ExecutionList({
  executions,
  loading,
  total,
  page,
  totalPages,
  activeExecutionId,
  onPageChange,
  onRefresh,
  onStartSearch,
  onOpenReport,
  onRerun,
  onReanalyze,
}: {
  executions: IntelligenceAssistantExecution[];
  loading: boolean;
  total: number;
  page: number;
  totalPages: number;
  activeExecutionId: number | null;
  onPageChange: (page: number) => void;
  onRefresh: () => void;
  onStartSearch: () => void;
  onOpenReport: (execution: IntelligenceAssistantExecution) => void;
  onRerun: (execution: IntelligenceAssistantExecution) => void;
  onReanalyze: (execution: IntelligenceAssistantExecution) => void;
}) {
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-base font-semibold text-[#172033]">历史报告</h3><p className="mt-1 text-xs text-[#667085]">保留最近 30 条，打开后可下载 PDF、发送邮件或再次生成。</p></div><button type="button" onClick={onRefresh} disabled={loading} className="inline-flex items-center gap-1.5 rounded-md border border-[#D0D5DD] px-3 py-1.5 text-xs font-semibold text-[#475467] disabled:opacity-50"><RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />刷新</button></div>
      {loading && executions.length === 0 ? <div className="flex items-center gap-2 py-10 text-sm text-[#667085]" role="status"><Loader2 className="size-4 animate-spin" aria-hidden="true" />正在加载历史报告…</div> : executions.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[#C8D7F0] bg-[#F8FAFD] py-10 text-center"><FileText className="mx-auto size-7 text-[#9FB9E8]" aria-hidden="true" /><p className="mt-2 text-sm font-semibold text-[#344054]">还没有历史报告</p><p className="mt-1 text-xs text-[#98A2B3]">生成第一份报告后，它会保存在这里。</p><button type="button" onClick={onStartSearch} className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-[#2563EB] px-3 py-1.5 text-xs font-semibold text-white"><Search className="size-3.5" aria-hidden="true" />生成报告</button></div>
      ) : (
        <div className="space-y-3" aria-busy={loading}>
          {executions.map((execution) => {
            const active = execution.status === "pending" || execution.status === "running";
            const canOpen = execution.status !== "pending" && execution.status !== "running";
            const canReanalyze = execution.analysis_status === "failed";
            const title = execution.report && "title" in execution.report && execution.report.title ? execution.report.title : execution.original_query || execution.snapshot.focus || "未命名报告";
            return <article key={execution.id} className="rounded-lg border border-[#E4EAF2] bg-white p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h4 className="truncate text-sm font-semibold text-[#243B61]" title={title}>{title}</h4><span className={`rounded px-2 py-0.5 text-[10px] font-semibold ${active ? "bg-blue-50 text-blue-700" : execution.status === "failed" ? "bg-red-50 text-red-700" : execution.status === "empty" ? "bg-slate-100 text-slate-600" : canReanalyze ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>{active && <Loader2 className="mr-1 inline size-3 animate-spin" aria-hidden="true" />}{statusLabel(execution)}</span></div><p className="mt-1 line-clamp-2 text-xs leading-5 text-[#475467]">{execution.original_query || execution.snapshot.focus || "未记录问题"}</p><p className="mt-1 text-[10px] text-[#98A2B3]">{formatDate(execution.completed_at || execution.created_at)} · {execution.sources.length} 条来源</p></div><div className="flex shrink-0 flex-wrap items-center gap-2">{canOpen && <button type="button" onClick={() => onOpenReport(execution)} className="inline-flex items-center gap-1 rounded-md border border-[#C8D7F0] px-2.5 py-1.5 text-[11px] font-semibold text-[#315EA8]"><FileText className="size-3" aria-hidden="true" />打开报告</button>}{!active && <button type="button" onClick={() => onRerun(execution)} disabled={activeExecutionId !== null} className="inline-flex items-center gap-1 rounded-md border border-[#D0D5DD] px-2.5 py-1.5 text-[11px] font-semibold text-[#475467] disabled:opacity-45"><RefreshCw className="size-3" aria-hidden="true" />再次生成</button>}{canReanalyze && <button type="button" onClick={() => onReanalyze(execution)} disabled={activeExecutionId !== null} className="inline-flex items-center gap-1 rounded-md border border-[#D0D5DD] px-2.5 py-1.5 text-[11px] font-semibold text-[#475467] disabled:opacity-45"><RefreshCw className="size-3" aria-hidden="true" />重新分析</button>}</div></div></article>;
          })}
        </div>
      )}
      {total > 0 && <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[#F0F2F5] pt-3"><span className="text-[11px] text-[#98A2B3]">共 {total} 条 · 第 {page}/{totalPages} 页</span>{totalPages > 1 && <div className="flex items-center gap-1.5"><button type="button" onClick={() => onPageChange(page - 1)} disabled={page <= 1 || loading} className="rounded-md border border-[#D0D5DD] px-2.5 py-1.5 text-[11px] disabled:opacity-40">上一页</button><button type="button" onClick={() => onPageChange(page + 1)} disabled={page >= totalPages || loading} className="rounded-md border border-[#D0D5DD] px-2.5 py-1.5 text-[11px] disabled:opacity-40">下一页</button></div>}</div>}
    </>
  );
}
