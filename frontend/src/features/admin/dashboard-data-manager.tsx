"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Download, FileUp, PackageOpen, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  BackendApiError,
  downloadDashboardData,
  exportDashboardData,
  fetchDashboardSource,
  importDashboardData,
  previewDashboardImport,
  setDashboardSource,
  type DashboardDataSource,
  type DashboardDataSourceResponse,
  type DashboardImportPreviewResponse,
  type DashboardManifest,
} from "@/lib/api/backend-client";
import { formatDateTime } from "@/lib/display";

interface DashboardDataManagerProps {
  token: string | null;
  busy: boolean;
  clearAuth: (message?: string) => void;
  onDataRefresh?: () => void;
}

function packagePeriod(manifest: DashboardManifest | null, dataset: "tender_projects" | "app_updates") {
  const period = manifest?.datasets[dataset]?.period;
  if (!period || (!period.from && !period.to)) return "暂无期间信息";
  return `${period.from || "—"} 至 ${period.to || "—"}`;
}

function packageCount(manifest: DashboardManifest | null, dataset: string) {
  const value = manifest?.datasets[dataset]?.record_count;
  return typeof value === "number" ? value.toLocaleString("zh-CN") : "—";
}

function PackageSummary({ manifest, compact = false }: { manifest: DashboardManifest | null; compact?: boolean }) {
  if (!manifest) {
    return <p className="text-xs text-[#98A2B3]">暂无可用数据包摘要。</p>;
  }
  const ai = manifest.datasets.ai_analysis;
  return (
    <div className={`grid gap-2 text-[11px] text-[#667085] ${compact ? "sm:grid-cols-2" : "sm:grid-cols-3"}`}>
      <div className="rounded-md bg-[#F8FAFD] px-3 py-2"><span className="block text-[10px] text-[#98A2B3]">版本</span><span className="mt-0.5 block truncate font-semibold text-[#344054]" title={manifest.package_version}>{manifest.package_version}</span></div>
      <div className="rounded-md bg-[#F8FAFD] px-3 py-2"><span className="block text-[10px] text-[#98A2B3]">生成时间</span><span className="mt-0.5 block font-semibold text-[#344054]">{formatDateTime(manifest.generated_at) || "—"}</span></div>
      <div className="rounded-md bg-[#F8FAFD] px-3 py-2"><span className="block text-[10px] text-[#98A2B3]">招采期间</span><span className="mt-0.5 block font-semibold text-[#344054]">{packagePeriod(manifest, "tender_projects")}</span></div>
      <div className="rounded-md bg-[#F8FAFD] px-3 py-2"><span className="block text-[10px] text-[#98A2B3]">招采数量</span><span className="mt-0.5 block font-semibold text-[#344054]">{packageCount(manifest, "tender_projects")} 条</span></div>
      <div className="rounded-md bg-[#F8FAFD] px-3 py-2"><span className="block text-[10px] text-[#98A2B3]">App 更新期间 / 数量</span><span className="mt-0.5 block font-semibold text-[#344054]">{packagePeriod(manifest, "app_updates")} · {packageCount(manifest, "app_updates")} 条</span></div>
      <div className="rounded-md bg-[#F8FAFD] px-3 py-2"><span className="block text-[10px] text-[#98A2B3]">AI 分析</span><span className={`mt-0.5 block font-semibold ${ai?.available ? "text-emerald-700" : "text-amber-700"}`}>{ai?.available ? "可用" : ai?.reason || "不可用"}</span></div>
    </div>
  );
}

export function DashboardDataManager({ token, busy, clearAuth, onDataRefresh }: DashboardDataManagerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [sourceState, setSourceState] = useState<DashboardDataSourceResponse | null>(null);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [sourceBusy, setSourceBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<DashboardImportPreviewResponse | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const localBusy = sourceLoading || sourceBusy || exporting || previewing || importing;
  const disabled = busy || localBusy;

  const handleError = useCallback((reason: unknown, fallback: string) => {
    if (reason instanceof BackendApiError && reason.status === 401) {
      clearAuth("登录已失效，请重新登录");
      return;
    }
    if (reason instanceof BackendApiError && reason.status === 409) {
      setError(reason.message);
      return;
    }
    setError(reason instanceof Error ? reason.message : fallback);
  }, [clearAuth]);

  const refreshSource = useCallback(async () => {
    if (!token) return;
    setSourceLoading(true);
    try {
      const response = await fetchDashboardSource(token);
      setSourceState(response);
      setError(null);
    } catch (reason) {
      handleError(reason, "无法加载数据来源状态，请稍后重试。");
    } finally {
      setSourceLoading(false);
    }
  }, [handleError, token]);

  useEffect(() => {
    void refreshSource();
  }, [refreshSource]);

  const handleSourceChange = useCallback(async (source: DashboardDataSource) => {
    if (!token || disabled || sourceState?.preferred_source === source) return;
    setSourceBusy(true);
    setMessage(null);
    setError(null);
    try {
      const response = await setDashboardSource(token, source);
      setSourceState(response);
      setMessage(`已切换至${source === "live" ? "实时源" : "导入包"}，看板将在下次加载时使用该来源。`);
      onDataRefresh?.();
    } catch (reason) {
      handleError(reason, "切换数据来源失败，请稍后重试。");
    } finally {
      setSourceBusy(false);
    }
  }, [disabled, handleError, onDataRefresh, sourceState?.preferred_source, token]);

  const handleExport = useCallback(async () => {
    if (!token || disabled) return;
    setExporting(true);
    setMessage(null);
    setError(null);
    try {
      const result = await exportDashboardData(token);
      const blob = await downloadDashboardData(token, result.download_url);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "dashboard-data.zip";
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage(`导出成功：${result.manifest.package_version}。`);
      await refreshSource();
    } catch (reason) {
      handleError(reason, "导出失败，请稍后重试。");
    } finally {
      setExporting(false);
    }
  }, [disabled, handleError, refreshSource, token]);

  const handlePreview = useCallback(async (file: File) => {
    if (!token || disabled) return;
    setPreviewing(true);
    setMessage(null);
    setError(null);
    try {
      const response = await previewDashboardImport(token, file);
      setSelectedFile(file);
      setPreview(response);
      setPreviewOpen(true);
    } catch (reason) {
      handleError(reason, "数据包预览失败，请确认文件是有效的 ZIP 数据包。");
    } finally {
      setPreviewing(false);
    }
  }, [disabled, handleError, token]);

  const handleFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    event.currentTarget.value = "";
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".zip")) {
      setError("请选择 .zip 格式的数据包。");
      return;
    }
    void handlePreview(file);
  }, [handlePreview]);

  const handleImport = useCallback(async () => {
    if (!token || !selectedFile || !preview?.valid || disabled) return;
    setImporting(true);
    setError(null);
    setMessage(null);
    try {
      const response = await importDashboardData(token, selectedFile);
      setSourceState(response.source);
      setPreviewOpen(false);
      setSelectedFile(null);
      setPreview(null);
      setMessage(`导入成功：${response.manifest.package_version}，已切换为导入包并刷新来源状态。`);
      onDataRefresh?.();
    } catch (reason) {
      handleError(reason, "导入失败，请稍后重试。");
    } finally {
      setImporting(false);
    }
  }, [disabled, handleError, onDataRefresh, preview?.valid, selectedFile, token]);

  const activeSource = sourceState?.active_source;
  const sourceLabel = (source: DashboardDataSource) => source === "live" ? "实时源" : "导入包";

  return (
    <section className="mt-5 rounded-lg border border-[#D9E2EC] bg-white shadow-[var(--workspace-shadow)]">
      <div className="flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <PackageOpen className="size-4 text-[#315EA8]" />
              <h2 className="text-base font-bold text-[#172033]">数据管理</h2>
              {activeSource && <span className="rounded-full bg-[#EAF2FF] px-2 py-0.5 text-[10px] font-semibold text-[#315EA8]">当前：{sourceLabel(activeSource)}</span>}
            </div>
            <p className="mt-1 text-xs leading-relaxed text-[#667085]">查看当前来源，切换实时源或导入包；导出的是当前活动数据包。</p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <input ref={fileInputRef} type="file" accept=".zip,application/zip" className="hidden" onChange={handleFileChange} />
            <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()} disabled={disabled} className="text-xs font-semibold">
              {previewing ? <><RefreshCw className="size-3.5 animate-spin" />预览中...</> : <><FileUp className="size-3.5" />选择 ZIP 预览</>}
            </Button>
            <Button type="button" onClick={() => void handleExport()} disabled={disabled} className="bg-[#162B49] text-xs font-semibold text-white hover:bg-[#1e3a5f]">
              {exporting ? <><RefreshCw className="size-3.5 animate-spin" />导出中...</> : <><Download className="size-3.5" />导出当前包</>}
            </Button>
          </div>
        </div>

        {sourceLoading ? (
          <div className="rounded-md border border-[#E4EAF2] bg-[#F8FAFD] px-3 py-3 text-xs text-[#667085]">正在加载来源状态...</div>
        ) : sourceState ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {(["live", "imported"] as const).map((source) => {
              const entry = sourceState.sources[source];
              const selected = sourceState.preferred_source === source;
              return (
                <div key={source} className={`rounded-lg border p-3 ${selected ? "border-[#9FB9E8] bg-[#F8FAFD]" : "border-[#E4EAF2] bg-white"}`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2"><span className={`size-2 rounded-full ${entry.available ? "bg-emerald-500" : "bg-slate-300"}`} /><span className="text-sm font-semibold text-[#344054]">{sourceLabel(source)}</span>{activeSource === source && <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">使用中</span>}</div>
                    <Button type="button" variant={selected ? "secondary" : "outline"} size="sm" disabled={disabled || !entry.available || selected} onClick={() => void handleSourceChange(source)} className="h-7 text-[11px]">{selected ? "已选择" : "切换"}</Button>
                  </div>
                  <p className="mt-1 text-[11px] text-[#98A2B3]">{entry.available ? "来源可用" : entry.reason || "暂无可用数据"}</p>
                  <div className="mt-3"><PackageSummary manifest={entry.manifest} compact /></div>
                </div>
              );
            })}
          </div>
        ) : null}

        {sourceState?.fallback_reason && <p className="rounded-md border border-amber-100 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800">降级提示：{sourceState.fallback_reason}</p>}
        {error && <p role="alert" className="rounded-md border border-rose-100 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}
        {message && <p role="status" className="flex items-center gap-1.5 rounded-md border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs text-emerald-700"><CheckCircle2 className="size-3.5" />{message}</p>}
      </div>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-2xl overflow-y-auto border-[#D9E2EC]">
          <DialogHeader>
            <DialogTitle className="text-base text-[#172033]">确认导入数据包</DialogTitle>
            <DialogDescription className="text-[#667085]">请确认以下数据包信息。导入成功后将自动切换为导入包。</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {selectedFile && <p className="text-xs text-[#667085]">文件：<span className="font-semibold text-[#344054]">{selectedFile.name}</span>（{Math.ceil(selectedFile.size / 1024)} KB）</p>}
            <PackageSummary manifest={preview?.manifest ?? null} />
            {preview?.warnings && preview.warnings.length > 0 && <div className="rounded-md border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-800"><p className="font-semibold">降级警告</p><ul className="mt-1 list-disc space-y-0.5 pl-4">{preview.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div>}
            {preview && !preview.valid && <p className="rounded-md border border-rose-100 bg-rose-50 px-3 py-2 text-xs text-rose-700">该数据包未通过校验，暂不能导入。</p>}
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" onClick={() => setPreviewOpen(false)} disabled={importing}>取消</Button>
              <Button type="button" onClick={() => void handleImport()} disabled={disabled || !preview?.valid || !selectedFile} className="bg-[#162B49] text-xs font-semibold text-white hover:bg-[#1e3a5f]">{importing ? <><RefreshCw className="size-3.5 animate-spin" />导入中...</> : "确认导入"}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
