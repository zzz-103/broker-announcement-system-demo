"use client";

import {
  AlertCircle,
  BookOpen,
  Check,
  Loader2,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type {
  CustomIntelligenceExecution,
  CustomIntelligenceOptionsResponse,
} from "@/lib/api/contracts";
import { ReportBody, SourceCard } from "./report-content";
import { ReportActions } from "./report-actions";
import {
  formatDate,
  getReportPhase,
  isActiveExecution,
  PHASE_CHIP,
  type StepState,
} from "./custom-intelligence-utils";

function PhaseStep({ state, label, detail }: { state: StepState; label: string; detail?: string }) {
  const iconWrap = state === "done"
    ? "border-emerald-200 bg-emerald-50 text-emerald-600"
    : state === "active"
      ? "border-blue-200 bg-blue-50 text-blue-600"
      : state === "failed"
        ? "border-red-200 bg-red-50 text-red-600"
        : "border-[#E4EAF2] bg-[#F8FAFD] text-[#98A2B3]";
  const textStyle = state === "pending" ? "text-[#98A2B3]" : state === "failed" ? "text-red-700" : "text-[#344054]";
  return (
    <li className="flex items-start gap-2.5">
      <span className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border ${iconWrap}`}>
        {state === "done" ? (
          <Check className="size-3" aria-hidden="true" />
        ) : state === "active" ? (
          <Loader2 className="size-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        ) : state === "failed" ? (
          <AlertCircle className="size-3" aria-hidden="true" />
        ) : (
          <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
        )}
      </span>
      <span className="min-w-0">
        <span className={`block text-xs font-semibold ${textStyle}`}>{label}</span>
        {detail && <span className="mt-0.5 block break-words text-[11px] leading-4 text-[#98A2B3]">{detail}</span>}
      </span>
    </li>
  );
}

/**
 * 右侧报告面板：按执行阶段渐进展示状态与真实数据，不使用模型伪造内容。
 * 头部为 sticky 轻量标题栏，长报告滚动时保持标题与操作可见。
 */
export function ReportPanel({
  execution,
  options,
  analysisAvailable,
  serviceAvailable,
  activeExecutionId,
  pdfExporting,
  onExpand,
  onExportPdf,
  onRerun,
  onReanalyze,
  onSaveConfig,
  onNewSearch,
}: {
  execution: CustomIntelligenceExecution | null;
  options: CustomIntelligenceOptionsResponse;
  analysisAvailable: boolean;
  serviceAvailable: boolean;
  activeExecutionId: number | null;
  pdfExporting: boolean;
  onExpand: (execution: CustomIntelligenceExecution) => void;
  onExportPdf: (execution: CustomIntelligenceExecution) => void;
  onRerun: (execution: CustomIntelligenceExecution) => void;
  onReanalyze: (execution: CustomIntelligenceExecution) => void;
  onSaveConfig: (execution: CustomIntelligenceExecution) => void;
  onNewSearch: () => void;
}) {
  if (!execution) return null;
  const phase = getReportPhase(execution);
  const chip = PHASE_CHIP[phase];
  const active = isActiveExecution(execution.status);
  const sources = execution.sources;
  const searchSucceeded = execution.search_status === "succeeded";
  const analysisFailed = phase === "analysis_failed";
  const reportReady = phase === "done" || phase === "analysis_failed";
  const title = execution.report?.title || execution.original_query || execution.snapshot.question || "即时情报报告";
  const question = execution.original_query || execution.snapshot.question || "";

  const searchStep: StepState = execution.search_status === "failed" ? "failed" : searchSucceeded ? "done" : active ? "active" : "pending";
  const sourcesStep: StepState = searchSucceeded ? "done" : "pending";
  const analysisStep: StepState = analysisFailed
    ? "failed"
    : execution.analysis_status === "succeeded"
      ? "done"
      : searchSucceeded && active
        ? "active"
        : "pending";
  const doneStep: StepState = execution.status === "succeeded" ? "done" : "pending";
  const steps: { state: StepState; label: string; detail?: string }[] = [
    {
      state: searchStep,
      label: "检索公开信息",
      detail: searchStep === "active"
        ? "正在检索公开信息…"
        : searchStep === "failed"
          ? execution.search_error_message || execution.error_message || "检索失败"
          : undefined,
    },
    {
      state: sourcesStep,
      label: "整理有效来源",
      detail: searchSucceeded ? `已获得 ${sources.length} 条有效来源` : undefined,
    },
    {
      state: analysisStep,
      label: "整理、分析并生成报告",
      detail: analysisStep === "active"
        ? "正在整理和分析，报告生成后直接展示…"
        : analysisStep === "failed"
          ? execution.analysis_error_message || "分析失败"
          : undefined,
    },
    {
      state: doneStep,
      label: "已完成",
      detail: doneStep === "done" ? formatDate(execution.completed_at || execution.created_at) : undefined,
    },
  ];
  const showStepper = phase !== "done";

  return (
    <section aria-label="即时搜索报告" className="rounded-lg border border-[#E4EAF2] bg-white">
      <header className="sticky top-0 z-20 rounded-t-lg border-b border-[#E4EAF2] bg-white px-4 py-3 sm:px-5">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
          <span className={`inline-flex shrink-0 items-center gap-1 rounded px-2 py-0.5 text-[10px] font-semibold ${chip.className}`}>
            {active && <Loader2 className="size-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
            {chip.label}
          </span>
          <h3 className="min-w-0 flex-1 truncate text-sm font-bold text-[#172033]" title={title}>{title}</h3>
          {!active && (
            <span className="shrink-0 text-[11px] tabular-nums text-[#98A2B3]">
              {formatDate(execution.completed_at || execution.created_at)} · {sources.length} 条来源
            </span>
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <ReportActions
            execution={execution}
            analysisAvailable={analysisAvailable}
            serviceAvailable={serviceAvailable}
            activeExecutionId={activeExecutionId}
            pdfExporting={pdfExporting}
            onExportPdf={onExportPdf}
            onSaveConfig={onSaveConfig}
            onReanalyze={onReanalyze}
            onRerun={onRerun}
          />
          {reportReady && (
            <Button variant="outline" size="sm" onClick={() => onExpand(execution)}>
              <BookOpen className="size-3.5" aria-hidden="true" />展开阅读
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onNewSearch}>
            <Search className="size-3.5" aria-hidden="true" />重新搜索
          </Button>
        </div>
      </header>
      <div className={`px-4 py-4 sm:px-5 ${active ? "min-h-[380px]" : ""}`}>
        {question && (
          <p className="mb-4 break-words text-xs leading-5 text-[#667085]">业务问题：{question}</p>
        )}
        {showStepper && (
          <ol className="space-y-2.5" aria-label="执行进度">
            {steps.map((step) => (
              <PhaseStep key={step.label} state={step.state} label={step.label} detail={step.detail} />
            ))}
          </ol>
        )}
        {(phase === "queued" || phase === "searching") && (
          <div className="mt-5 animate-pulse space-y-3 motion-reduce:animate-none" aria-hidden="true">
            <div className="h-3 w-2/3 rounded bg-[#EEF2F7]" />
            <div className="h-3 w-full rounded bg-[#EEF2F7]" />
            <div className="h-3 w-5/6 rounded bg-[#EEF2F7]" />
            <div className="h-28 w-full rounded-lg bg-[#F4F7FB]" />
          </div>
        )}
        {phase === "analyzing" && (
          <div className="mt-5">
            <p className="text-xs font-semibold text-[#475467]">已获得 {sources.length} 条有效来源，报告生成后将直接展示在这里：</p>
            <div className="mt-2.5 space-y-2.5">
              {sources.map((source, index) => (
                <SourceCard key={source.id} source={source} index={index + 1} anchorPrefix="panel-source" />
              ))}
            </div>
          </div>
        )}
        {phase === "search_failed" && (
          <div role="alert" className="mt-5 rounded-lg border border-red-100 bg-red-50/70 p-4">
            <h4 className="text-sm font-bold text-[#991B1B]">检索失败</h4>
            <p className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-6 text-[#991B1B]">{execution.error_message || "未提供错误信息。"}</p>
            <p className="mt-2 text-[11px] text-[#667085]">可稍后重新执行，或在左侧调整配置后重新搜索。</p>
          </div>
        )}
        {phase === "empty" && (
          <div role="status" className="mt-5 rounded-lg border border-[#E4EAF2] bg-[#F8FAFD] p-4 text-sm leading-6 text-[#667085]">
            未检索到有效来源。可尝试扩大时间范围、调整关键词后重新搜索。
          </div>
        )}
        {(phase === "done" || phase === "analysis_failed") && (
          <div className="mt-1">
            <ReportBody execution={execution} options={options} anchorPrefix="panel-source" />
          </div>
        )}
      </div>
    </section>
  );
}
