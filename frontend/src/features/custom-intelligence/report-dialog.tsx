"use client";

import { ExternalLink, Loader2, RefreshCw, X } from "lucide-react";
import { useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type {
  CustomIntelligenceExecution,
  CustomIntelligenceOptionsResponse,
} from "@/lib/api/contracts";
import { ReportBody } from "./report-content";
import { ReportActions } from "./report-actions";
import { formatDate, optionLabel } from "./custom-intelligence-utils";

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

export function ReportDialog({
  execution,
  open,
  loading,
  options,
  pdfExporting,
  activeExecutionId,
  serviceAvailable,
  onOpenChange,
  onExportPdf,
  onRerun,
  onSaveConfig,
  onReanalyze,
  analysisAvailable,
}: {
  execution: CustomIntelligenceExecution | null;
  open: boolean;
  loading: boolean;
  options: CustomIntelligenceOptionsResponse;
  pdfExporting: boolean;
  activeExecutionId: number | null;
  serviceAvailable: boolean;
  onOpenChange: (open: boolean) => void;
  onExportPdf?: (execution: CustomIntelligenceExecution) => void;
  onRerun?: (execution: CustomIntelligenceExecution) => void;
  onSaveConfig?: (execution: CustomIntelligenceExecution) => void;
  onReanalyze?: (execution: CustomIntelligenceExecution) => void;
  analysisAvailable?: boolean;
}) {
  const sources = useMemo(() => execution?.sources ?? [], [execution?.sources]);
  const currentExecution = execution;
  const searchSucceeded = currentExecution?.search_status === "succeeded";
  const analysisFailed = searchSucceeded && currentExecution?.analysis_status === "failed";
  const scrollToSources = () => {
    document.getElementById("report-sources")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const title = currentExecution?.report?.title || currentExecution?.original_query || currentExecution?.snapshot.question || "情报报告";
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
              {currentExecution && (
                <ReportActions
                  execution={currentExecution}
                  analysisAvailable={Boolean(analysisAvailable)}
                  serviceAvailable={serviceAvailable}
                  activeExecutionId={activeExecutionId}
                  pdfExporting={pdfExporting}
                  onExportPdf={(execution) => onExportPdf?.(execution)}
                  onSaveConfig={(execution) => onSaveConfig?.(execution)}
                  onReanalyze={(execution) => onReanalyze?.(execution)}
                  onRerun={(execution) => onRerun?.(execution)}
                />
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
          <div className="mx-auto min-w-0 max-w-[840px] px-4 py-6 sm:px-8 sm:py-8">
            {loading && <div className="mb-4 flex items-center gap-2 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700"><Loader2 className="size-4 animate-spin" />正在加载完整报告…</div>}
            {!currentExecution ? (
              <p className="text-sm text-[#667085]">暂无报告内容。</p>
            ) : currentExecution.search_status !== "succeeded" ? (
              <ExecutionErrorDetail execution={currentExecution} options={options} onRerun={onRerun} />
            ) : (
              <ReportBody execution={currentExecution} options={options} anchorPrefix="report-source" />
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
