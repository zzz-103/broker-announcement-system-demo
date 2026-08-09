"use client";

import { Bookmark, Download, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CustomIntelligenceExecution } from "@/lib/api/contracts";
import { canSaveExecutionAsConfig, isActiveExecution } from "./custom-intelligence-utils";

export interface ReportActionsProps {
  execution: CustomIntelligenceExecution;
  analysisAvailable: boolean;
  serviceAvailable: boolean;
  activeExecutionId: number | null;
  pdfExporting: boolean;
  onExportPdf: (execution: CustomIntelligenceExecution) => void;
  onSaveConfig?: (execution: CustomIntelligenceExecution) => void;
  onReanalyze?: (execution: CustomIntelligenceExecution) => void;
  onRerun?: (execution: CustomIntelligenceExecution) => void;
}

export function ReportActions({
  execution,
  analysisAvailable,
  serviceAvailable,
  activeExecutionId,
  pdfExporting,
  onExportPdf,
  onSaveConfig,
  onReanalyze,
  onRerun,
}: ReportActionsProps) {
  const searchSucceeded = execution.search_status === "succeeded";
  const analysisFailed = searchSucceeded && execution.analysis_status === "failed";
  const terminal = !isActiveExecution(execution.status);
  const hasCompleteReport = terminal
    && searchSucceeded
    && execution.sources.length > 0
    && (execution.analysis_status === "succeeded" || execution.analysis_status === "failed");
  const canSaveConfig = canSaveExecutionAsConfig(execution);
  return (
    <>
      {hasCompleteReport && (
        <Button variant="outline" size="sm" onClick={() => onExportPdf(execution)} disabled={pdfExporting}>
          {pdfExporting ? <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Download className="size-3.5" aria-hidden="true" />}导出 PDF
        </Button>
      )}
      {canSaveConfig && onSaveConfig && (
        <Button variant="outline" size="sm" onClick={() => onSaveConfig(execution)}>
          <Bookmark className="size-3.5" aria-hidden="true" />保存为配置
        </Button>
      )}
      {analysisFailed && onReanalyze && (
        <Button variant="outline" size="sm" onClick={() => onReanalyze(execution)} disabled={!analysisAvailable || activeExecutionId !== null}>
          <RefreshCw className="size-3.5" aria-hidden="true" />重新分析
        </Button>
      )}
      {terminal && onRerun && (
        <Button variant="outline" size="sm" onClick={() => onRerun(execution)} disabled={activeExecutionId !== null || !serviceAvailable}>
          <RefreshCw className="size-3.5" aria-hidden="true" />重新执行
        </Button>
      )}
    </>
  );
}
