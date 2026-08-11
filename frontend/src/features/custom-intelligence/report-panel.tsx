"use client";

import { AlertCircle, Check, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { IntelligenceAssistantExecution } from "@/lib/api/contracts";
import { ReportActions } from "./report-actions";
import { ReportBody } from "./report-content";

const STEP_LABELS = ["理解需求", "检索资料", "筛选来源", "生成报告"] as const;

function stepState(execution: IntelligenceAssistantExecution, index: number): "done" | "active" | "pending" | "failed" {
  if (execution.status === "failed") {
    if (execution.analysis_status === "failed") return index < 3 ? "done" : "failed";
    if (execution.search_status === "failed") return index === 0 ? "done" : index === 1 ? "failed" : "pending";
    return index === 0 ? "failed" : "pending";
  }
  if (execution.status === "succeeded" || execution.status === "empty") return "done";
  if (execution.analysis_status === "running") return index < 3 ? "done" : "active";
  if (execution.search_status === "succeeded") return index < 3 ? "done" : "pending";
  if (execution.status === "pending") return index === 0 ? "active" : "pending";
  if (index === 0) return "done";
  if (index === 1 && execution.status === "running") return "active";
  return "pending";
}

function Stepper({ execution }: { execution: IntelligenceAssistantExecution }) {
  return (
    <ol className="grid gap-3 sm:grid-cols-4" aria-label="报告生成进度">
      {STEP_LABELS.map((label, index) => {
        const state = stepState(execution, index);
        return (
          <li key={label} className="flex items-center gap-2 text-xs">
            <span className={`flex size-6 shrink-0 items-center justify-center rounded-full border ${state === "done" ? "border-emerald-200 bg-emerald-50 text-emerald-600" : state === "active" ? "border-blue-200 bg-blue-50 text-blue-600" : state === "failed" ? "border-red-200 bg-red-50 text-red-600" : "border-[#E4EAF2] bg-[#F8FAFD] text-[#98A2B3]"}`}>
              {state === "done" ? <Check className="size-3" aria-hidden="true" /> : state === "active" ? <Loader2 className="size-3 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : state === "failed" ? <AlertCircle className="size-3" aria-hidden="true" /> : index + 1}
            </span>
            <span className={state === "pending" ? "text-[#98A2B3]" : state === "failed" ? "text-red-700" : "text-[#344054]"}>{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

export function ReportPanel({
  execution,
  pdfExporting,
  onExportPdf,
  onEmail,
  onRerun,
  onReanalyze,
  onNewSearch,
  onOpenReport,
}: {
  execution: IntelligenceAssistantExecution | null;
  pdfExporting: boolean;
  onExportPdf: (execution: IntelligenceAssistantExecution) => void;
  onEmail: (execution: IntelligenceAssistantExecution) => void;
  onRerun: (execution: IntelligenceAssistantExecution) => void;
  onReanalyze: (execution: IntelligenceAssistantExecution) => void;
  onNewSearch: () => void;
  onOpenReport: (execution: IntelligenceAssistantExecution) => void;
}) {
  if (!execution) return null;
  const active = execution.status === "pending" || execution.status === "running";
  const title = execution.report && "title" in execution.report && execution.report.title ? execution.report.title : "正在整理你的情报";
  return (
    <section aria-label="情报报告" className="rounded-lg border border-[#E4EAF2] bg-white">
      <header className="sticky top-0 z-20 rounded-t-lg border-b border-[#E4EAF2] bg-white px-4 py-3 sm:px-5">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <span className={`inline-flex rounded px-2 py-0.5 text-[10px] font-semibold ${active ? "bg-blue-50 text-blue-700" : execution.status === "failed" ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>{active ? "生成中" : execution.status === "failed" ? "需要处理" : "已完成"}</span>
            <h3 className="mt-1 truncate text-sm font-bold text-[#172033]" title={title}>{title}</h3>
          </div>
          <span className="text-[11px] text-[#98A2B3]">{execution.sources.length} 条来源</span>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <ReportActions execution={execution} pdfExporting={pdfExporting} onExportPdf={onExportPdf} onEmail={onEmail} onRerun={onRerun} onReanalyze={onReanalyze} />
          {!active && execution.status !== "failed" && <Button variant="outline" size="sm" onClick={() => onOpenReport(execution)}>展开阅读</Button>}
          <Button variant="ghost" size="sm" onClick={onNewSearch}><Search className="size-3.5" aria-hidden="true" />新问题</Button>
        </div>
      </header>
      <div className="px-4 py-5 sm:px-5">
        {active && <Stepper execution={execution} />}
        {execution.status === "failed" && <div role="alert" className="rounded-lg border border-red-100 bg-red-50 p-4 text-sm leading-6 text-red-700">{execution.error_message || "报告生成失败，请再次生成。"}</div>}
        {execution.status === "empty" && <div role="status" className="rounded-lg border border-[#E4EAF2] bg-[#F8FAFD] p-4 text-sm leading-6 text-[#667085]">没有找到足够的公开资料，可以调整主题或扩大时间范围后再次生成。</div>}
        {active && <div className="mt-5 animate-pulse space-y-3 motion-reduce:animate-none" aria-hidden="true"><div className="h-3 w-2/3 rounded bg-[#EEF2F7]" /><div className="h-3 w-full rounded bg-[#EEF2F7]" /><div className="h-24 rounded-lg bg-[#F4F7FB]" /></div>}
        {!active && execution.status === "succeeded" && <div className="mt-1"><ReportBody execution={execution} /></div>}
      </div>
    </section>
  );
}
