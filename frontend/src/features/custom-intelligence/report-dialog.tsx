"use client";

import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { IntelligenceAssistantExecution } from "@/lib/api/contracts";
import { ReportActions } from "./report-actions";
import { ReportBody } from "./report-content";

export function ReportDialog({
  execution,
  open,
  loading,
  pdfExporting,
  onOpenChange,
  onExportPdf,
  onEmail,
  onRerun,
  onReanalyze,
}: {
  execution: IntelligenceAssistantExecution | null;
  open: boolean;
  loading: boolean;
  pdfExporting: boolean;
  onOpenChange: (open: boolean) => void;
  onExportPdf: (execution: IntelligenceAssistantExecution) => void;
  onEmail: (execution: IntelligenceAssistantExecution) => void;
  onRerun: (execution: IntelligenceAssistantExecution) => void;
  onReanalyze: (execution: IntelligenceAssistantExecution) => void;
}) {
  const title = execution?.report && "title" in execution.report && execution.report.title ? execution.report.title : execution?.original_query || execution?.snapshot.focus || "情报报告";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-dvh w-full flex-col gap-0 overflow-hidden rounded-none border-0 bg-white p-0 sm:h-[min(92dvh,900px)] sm:w-[min(1120px,92vw)] sm:max-w-[1120px] sm:rounded-lg sm:border sm:border-[#D9E2EC]">
        <DialogHeader className="shrink-0 border-b border-[#E4EAF2] bg-[#F8FAFD] px-4 py-4 pr-12 sm:px-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between"><div className="min-w-0"><DialogTitle className="break-words text-lg leading-7 text-[#172033]">{title}</DialogTitle><DialogDescription className="mt-1 text-xs leading-5 text-[#667085]">{execution?.status === "running" || execution?.status === "pending" ? "报告正在生成" : execution?.status === "failed" ? "生成失败，可再次生成" : "AI 情报助手报告"}</DialogDescription></div>{execution && <ReportActions execution={execution} pdfExporting={pdfExporting} onExportPdf={onExportPdf} onEmail={onEmail} onRerun={onRerun} onReanalyze={onReanalyze} />}</div>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain"><div className="mx-auto min-w-0 max-w-[880px] px-4 py-6 sm:px-8 sm:py-8">{loading && <div className="mb-4 flex items-center gap-2 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700"><Loader2 className="size-4 animate-spin" aria-hidden="true" />正在加载报告…</div>}{execution ? <ReportBody execution={execution} /> : <p className="text-sm text-[#667085]">暂无报告内容。</p>}</div></div>
      </DialogContent>
    </Dialog>
  );
}
