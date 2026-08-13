"use client";

import { Download, Loader2, Mail, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { IntelligenceAssistantExecution } from "@/lib/api/contracts";

export interface ReportActionsProps {
  execution: IntelligenceAssistantExecution;
  pdfExporting: boolean;
  onExportPdf: (execution: IntelligenceAssistantExecution) => void;
  onEmail: (execution: IntelligenceAssistantExecution) => void;
  onRerun?: (execution: IntelligenceAssistantExecution) => void;
  onReanalyze?: (execution: IntelligenceAssistantExecution) => void;
}

export function ReportActions({ execution, pdfExporting, onExportPdf, onEmail, onRerun, onReanalyze }: ReportActionsProps) {
  const active = execution.status === "pending" || execution.status === "running";
  const searchSucceeded = execution.search_status === "succeeded" || (!execution.search_status && execution.status === "succeeded");
  const analysisFailed = execution.analysis_status === "failed";
  const reportV2 = Boolean(execution.report && "version" in execution.report && execution.report.version === 2);
  const ready = !active && searchSucceeded && execution.status === "succeeded" && reportV2;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {ready && <Button variant="outline" size="sm" className="min-h-11 sm:min-h-8" onClick={() => onExportPdf(execution)} disabled={pdfExporting}>{pdfExporting ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Download className="size-3.5" aria-hidden="true" />}下载 PDF</Button>}
      {ready && <Button variant="outline" size="sm" className="min-h-11 sm:min-h-8" onClick={() => onEmail(execution)}><Mail className="size-3.5" aria-hidden="true" />发送邮件</Button>}
      {analysisFailed && onReanalyze && <Button variant="outline" size="sm" className="min-h-11 sm:min-h-8" onClick={() => onReanalyze(execution)}><RefreshCw className="size-3.5" aria-hidden="true" />重新分析</Button>}
      {!active && onRerun && <Button variant="outline" size="sm" className="min-h-11 sm:min-h-8" onClick={() => onRerun(execution)}><RefreshCw className="size-3.5" aria-hidden="true" />再次生成</Button>}
    </div>
  );
}
