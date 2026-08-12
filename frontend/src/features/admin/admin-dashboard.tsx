"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  Brain,
  CheckCircle2,
  Database,
  Download,
  FileText,
  FileUp,
  Globe,
  Info,
  Lock,
  LogOut,
  MoreHorizontal,
  PackageOpen,
  RefreshCw,
  Smartphone,
  Upload,
  Workflow,
} from "lucide-react";

import { AdminTaskLogDialog } from "@/components/admin-task-log-dialog";
import { AdminTaskProgress } from "@/components/admin-task-progress";
import { UserApprovalManager } from "@/components/user-approval-manager";
import { FeedbackManager } from "@/components/feedback-manager";
import { AuditRecordsManager } from "@/components/audit-records-manager";
import { Button } from "@/components/ui/button";
import { SearchServiceSettings } from "./search-service-settings";
import { IntelligenceReportManager } from "./intelligence-report-manager";
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
  verifyAdminPassword,
  type DashboardDataSource,
  type DashboardDataSourceResponse,
  type DashboardImportPreviewResponse,
  type DashboardManifest,
  type JobStatus,
  type JobType,
} from "@/lib/api/backend-client";
import { APP_VERSION } from "@/lib/app-version";
import { formatDateTime } from "@/lib/display";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/store/auth-store";
import { type CardId } from "./job-runner-model";
import { useJobRunner } from "./use-job-runner";

interface DashboardProps {
  onBack: () => void;
  onDataRefresh?: () => void;
}

function statusTone(status: JobStatus) {
  if (status === "running") return "bg-blue-50 text-blue-700";
  if (status === "succeeded") return "bg-emerald-50 text-emerald-700";
  if (status === "failed" || status === "cancelled") return "bg-rose-50 text-rose-700";
  return "bg-slate-50 text-slate-600";
}

function statusText(status: JobStatus) {
  if (status === "running") return "执行中";
  if (status === "succeeded") return "已完成";
  if (status === "failed") return "失败";
  if (status === "cancelled") return "已停止";
  return "待执行";
}

function PrimaryActionButton({
  children,
  onClick,
  running,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  running: boolean;
  disabled: boolean;
}) {
  return (
    <Button
      type="button"
      onClick={onClick}
      disabled={disabled || running}
      className="h-10 w-full bg-[#1F5BB5] text-xs font-semibold text-white hover:bg-[#174B98]"
    >
      {running ? (
        <>
          <RefreshCw className="size-3.5 animate-spin" />
          执行中...
        </>
      ) : (
        children
      )}
    </Button>
  );
}

function TaskMoreMenu({
  disabled,
  publishRunning,
  onPublish,
  onFullRefresh,
}: {
  disabled: boolean;
  publishRunning: boolean;
  onPublish: () => void;
  onFullRefresh: () => void;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <div className="relative">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="更多操作"
        aria-expanded={open}
        onClick={() => setOpen((previous) => !previous)}
        className="size-7 rounded-md text-[#667085] hover:bg-slate-200/60 hover:text-[#344054]"
      >
        <MoreHorizontal className="size-4" />
      </Button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            role="menu"
            aria-label="更多操作"
            className="absolute right-0 top-full z-50 mt-1 w-44 rounded-lg border border-[#D9E2EC] bg-white p-1.5 shadow-[var(--workspace-shadow)]"
          >
            <p className="px-2.5 pb-1 pt-0.5 text-[10px] font-semibold text-[#98A2B3]">更多操作</p>
            <button
              type="button"
              role="menuitem"
              disabled={disabled}
              onClick={() => {
                setOpen(false);
                onPublish();
              }}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs font-semibold text-[#344054] hover:bg-[#F2F6FC] disabled:cursor-not-allowed disabled:opacity-45"
            >
              {publishRunning ? (
                <>
                  <RefreshCw className="size-3.5 animate-spin" />
                  更新中...
                </>
              ) : (
                <>
                  <Upload className="size-3.5" />
                  更新看板
                </>
              )}
            </button>
            <div className="my-1 border-t border-[#EEF2F6]" />
            <button
              type="button"
              role="menuitem"
              disabled={disabled}
              onClick={() => {
                setOpen(false);
                onFullRefresh();
              }}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs font-semibold text-amber-700 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-45"
            >
              <RefreshCw className="size-3.5" />
              全量重建
            </button>
          </div>
        </>
      )}
    </div>
  );
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

function DashboardDataManager({
  token,
  busy,
  clearAuth,
  onDataRefresh,
}: {
  token: string | null;
  busy: boolean;
  clearAuth: (message?: string) => void;
  onDataRefresh?: () => void;
}) {
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

export function AdminDashboard({ onBack, onDataRefresh }: DashboardProps) {
  const { username, token, logout, clearAuth } = useAuthStore();
  const [logDialogCard, setLogDialogCard] = useState<CardId | null>(null);
  const [crawlerModeDialogOpen, setCrawlerModeDialogOpen] = useState(false);
  const [llmModeDialogOpen, setLlmModeDialogOpen] = useState(false);
  const [fullRefreshDialogOpen, setFullRefreshDialogOpen] = useState(false);
  const [fullRefreshPassword, setFullRefreshPassword] = useState("");
  const [fullRefreshVerifying, setFullRefreshVerifying] = useState(false);
  const [fullRefreshError, setFullRefreshError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<"tasks" | "users" | "reports" | "records" | "search">("tasks");
  const {
    activeOperation,
    cardStates,
    progressState,
    runJob,
    runPublish,
    runAiAnalysis,
    cancelActiveJob,
    stopLocalMonitoring,
  } = useJobRunner({ token, clearAuth, onDataRefresh });

  const isBusy = Boolean(activeOperation);

  const openFullRefreshDialog = useCallback(() => {
    setFullRefreshPassword("");
    setFullRefreshError(null);
    setFullRefreshDialogOpen(true);
  }, []);

  const closeFullRefreshDialog = useCallback((open: boolean) => {
    setFullRefreshDialogOpen(open);
    if (!open) {
      setFullRefreshPassword("");
      setFullRefreshError(null);
    }
  }, []);

  const confirmFullRefresh = useCallback(async () => {
    if (!token || fullRefreshVerifying || !fullRefreshPassword) return;
    setFullRefreshVerifying(true);
    setFullRefreshError(null);
    try {
      await verifyAdminPassword(fullRefreshPassword, token);
    } catch (error) {
      setFullRefreshPassword("");
      setFullRefreshVerifying(false);
      if (error instanceof BackendApiError && error.status === 0) {
        setFullRefreshError("无法连接后端 API，请稍后重试。");
      } else if (error instanceof BackendApiError && error.status === 401 && error.message === "管理员密码不正确") {
        setFullRefreshError("管理员密码不正确，请重新输入。");
      } else if (error instanceof BackendApiError && error.status === 401) {
        clearAuth("登录已失效，请重新登录。");
      } else {
        setFullRefreshError("密码验证失败，请稍后重试。");
      }
      return;
    }
    setFullRefreshPassword("");
    setFullRefreshError(null);
    setFullRefreshVerifying(false);
    setFullRefreshDialogOpen(false);
    await runJob("llm", { mode: "full_refresh", overwrite: true });
  }, [fullRefreshPassword, fullRefreshVerifying, clearAuth, runJob, token]);

  const chooseLlmJob = useCallback(
    async (jobType: Extract<JobType, "llm" | "llm-external">) => {
      setLlmModeDialogOpen(false);
      await runJob(jobType);
    },
    [runJob],
  );

  const chooseCrawlerJob = useCallback(
    async (jobType: Extract<JobType, "scraper" | "pipeline">) => {
      setCrawlerModeDialogOpen(false);
      await runJob(jobType);
    },
    [runJob],
  );

  const handleLogout = useCallback(() => {
    setCrawlerModeDialogOpen(false);
    setLlmModeDialogOpen(false);
    closeFullRefreshDialog(false);
    stopLocalMonitoring();
    logout();
  }, [closeFullRefreshDialog, logout, stopLocalMonitoring]);

  const cards = useMemo(
    () => [
      {
        id: "crawler" as const,
        icon: Globe,
        title: "公告采集",
        description: "采集采购公告与结果公告。",
      },
      {
        id: "llm" as const,
        icon: Database,
        title: "公告数据处理",
        description: "整理公告数据，完成项目匹配与结果汇总。",
      },
      {
        id: "ai" as const,
        icon: Brain,
        title: "招采分析",
        description: "基于当前数据更新招采分析。",
      },
      {
        id: "app-watch" as const,
        icon: Smartphone,
        title: "App 更新采集",
        description: "采集并整理券商 App 更新。",
      },
    ],
    [],
  );

  const selectedLogCardState = logDialogCard ? cardStates[logDialogCard] : null;

  return (
    <div className="min-h-screen overflow-x-clip bg-[#F5F7FA]">
      <header className="sticky top-0 z-40 h-[68px] border-b border-white/10 bg-[#162B49]/95 text-white shadow-[0_8px_24px_rgba(16,40,71,0.16)] backdrop-blur-md">
        <div className="mx-auto flex h-[68px] max-w-[1600px] items-center justify-between px-3 sm:px-8">
          <div className="flex items-center gap-3">
            <button
              onClick={onBack}
              className="flex items-center gap-1.5 text-sm text-white/70 transition-colors hover:text-white"
            >
              <ArrowLeft className="size-4" />
              返回看板
            </button>
            <div className="h-5 w-px bg-white/20" />
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">管理控制台</span>
              <span className="rounded border border-white/15 bg-white/10 px-1.5 py-0.5 text-[9px] text-blue-100">v{APP_VERSION}</span>
            </div>
          </div>
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <span className="hidden max-w-[180px] truncate text-xs text-white/60 sm:block">{username}</span>
            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-white/60 transition-colors hover:bg-white/10 hover:text-white"
            >
              <LogOut className="size-3.5" />
              退出
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1280px] px-4 py-8 sm:px-8">
        <div className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[#E4E9F0] pb-5">
          <div>
            <h1 className="text-2xl font-bold text-[#172033]">管理控制台</h1>
            <p className="mt-1 text-xs text-[#667085]">运行数据任务，管理用户并查看业务记录。</p>
          </div>
        </div>

        <div role="tablist" aria-label="管理内容" className="mb-6 flex gap-1 border-b border-[#D9E2EC]">
          {[
            ["tasks", "任务运行"],
            ["users", "用户与审批"],
            ["reports", "情报报告"],
            ["records", "审计与反馈"],
            ["search", "情报技术配置"],
          ].map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={activeSection === id} onClick={() => setActiveSection(id as typeof activeSection)} className={cn("border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors", activeSection === id ? "border-[#2563EB] text-[#1F5BB5]" : "border-transparent text-[#667085] hover:text-[#344054]")}>{label}</button>
          ))}
        </div>

        {activeSection === "tasks" && <>
        <div className="grid grid-cols-1 items-stretch gap-4 md:grid-cols-2 xl:grid-cols-4">
          {cards.map((card) => {
            const state = cardStates[card.id];
            const running = (() => {
              switch (card.id) {
                case "crawler":
                  return activeOperation?.id === "scraper" || activeOperation?.id === "pipeline";
                case "llm":
                  return activeOperation?.id === "llm" || activeOperation?.id === "llm-external";
                case "app-watch":
                  return activeOperation?.id === "app-watch";
                default:
                  return activeOperation?.id === "ai_analysis";
              }
            })();

            return (
              <section
                key={card.id}
                className="flex h-full min-w-0 flex-col rounded-lg border border-[#D9E2EC] bg-white shadow-[var(--workspace-shadow)]"
              >
                <div className="flex h-full flex-col p-5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-[#EAF2FF]">
                      <card.icon className="size-4.5 text-[#1F5BB5]" />
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <span className={cn("rounded-full px-2.5 py-0.5 text-[10px] font-semibold", statusTone(state.status))}>{statusText(state.status)}</span>
                      {card.id === "llm" && (
                        <TaskMoreMenu
                          disabled={isBusy}
                          publishRunning={activeOperation?.id === "publish"}
                          onPublish={() => void runPublish()}
                          onFullRefresh={openFullRefreshDialog}
                        />
                      )}
                    </div>
                  </div>

                  <h3 className="mt-4 text-base font-bold leading-6 text-[#172033]">{card.title}</h3>
                  <p className="mt-1 text-xs leading-relaxed text-[#667085]">{card.description}</p>
                  {card.id === "llm" &&
                    state.status === "succeeded" &&
                    (state.lastOperationLabel === "数据处理" || state.lastOperationLabel === "外来公告处理") && (
                      <p className="mt-2 flex items-start gap-1.5 rounded-md bg-amber-50 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-700">
                        <Info className="mt-0.5 size-3.5 shrink-0" />
                        处理已完成：请点右上角「更多操作」→「更新看板」发布结果。
                      </p>
                    )}

                  <div className="mt-auto pt-5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-[11px] text-[#98A2B3]">
                        最近执行：{formatDateTime(state.lastExecutedAt) || "暂无"}
                      </span>
                      <button
                        type="button"
                        onClick={() => setLogDialogCard(card.id)}
                        disabled={state.logs.length === 0}
                        title="查看详细日志"
                        aria-label="查看详细日志"
                        className="flex size-6 shrink-0 items-center justify-center rounded-md text-[#98A2B3] transition-colors hover:bg-slate-100 hover:text-[#667085] disabled:cursor-not-allowed disabled:opacity-30"
                      >
                        <FileText className="size-3.5" />
                      </button>
                    </div>
                    <div className="mt-3 border-t border-[#E4E9F0] pt-3">
                      {card.id === "llm" ? (
                        <PrimaryActionButton onClick={() => setLlmModeDialogOpen(true)} running={running} disabled={isBusy}>
                          运行处理
                        </PrimaryActionButton>
                      ) : card.id === "crawler" ? (
                        <PrimaryActionButton onClick={() => setCrawlerModeDialogOpen(true)} running={running} disabled={isBusy}>
                          选择采集范围
                        </PrimaryActionButton>
                      ) : card.id === "app-watch" ? (
                        <PrimaryActionButton onClick={() => void runJob("app-watch")} running={running} disabled={isBusy}>
                          采集 App 更新
                        </PrimaryActionButton>
                      ) : (
                        <PrimaryActionButton onClick={() => void runAiAnalysis()} running={running} disabled={isBusy}>
                          更新分析
                        </PrimaryActionButton>
                      )}
                    </div>
                  </div>
                </div>
              </section>
            );
          })}
        </div>

        <DashboardDataManager token={token} busy={isBusy} clearAuth={clearAuth} onDataRefresh={onDataRefresh} />

        <AdminTaskProgress
          progress={progressState}
          onCancel={
            activeOperation?.id === "scraper" ||
            activeOperation?.id === "llm" ||
            activeOperation?.id === "llm-external" ||
            activeOperation?.id === "pipeline" ||
            activeOperation?.id === "app-watch"
              ? cancelActiveJob
              : undefined
          }
        />

        <div className="mt-6 rounded-lg border border-blue-100 bg-blue-50/50 p-4">
          <div className="flex items-center gap-3">
            <AlertCircle className="size-4 shrink-0 text-blue-600" />
            <p className="text-xs leading-relaxed text-blue-800">
              <span className="font-semibold text-blue-900">操作说明：</span>
              完整流程通过校验后会自动发布并刷新看板；单独数据处理仍需在「更多操作」中手动发布。
            </p>
          </div>
        </div>

        </>}

        {activeSection === "users" && <UserApprovalManager />}
        {activeSection === "reports" && <IntelligenceReportManager />}
        {activeSection === "records" && <><AuditRecordsManager /><FeedbackManager /></>}
        {activeSection === "search" && (
          <SearchServiceSettings
            token={token}
            onAuthError={() => clearAuth("登录已失效，请重新登录")}
          />
        )}
      </main>

      <AdminTaskLogDialog
        open={Boolean(logDialogCard)}
        onOpenChange={(open) => {
          if (!open) setLogDialogCard(null);
        }}
        title={selectedLogCardState ? selectedLogCardState.lastOperationLabel : "任务日志"}
        status={selectedLogCardState?.status ?? "idle"}
        logs={selectedLogCardState?.logs ?? []}
      />

      <Dialog open={crawlerModeDialogOpen} onOpenChange={setCrawlerModeDialogOpen}>
        <DialogContent className="max-w-md border-[#D9E2EC]">
          <DialogHeader>
            <DialogTitle className="text-base text-[#172033]">选择采集范围</DialogTitle>
            <DialogDescription className="text-[#667085]">
              两种方式都会依次采集采购公告和结果公告；完整流程会在校验、备份后自动更新看板。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 pt-2">
            <Button
              type="button"
              onClick={() => void chooseCrawlerJob("scraper")}
              variant="outline"
              className="h-auto min-h-16 justify-start border-emerald-200 px-4 py-3 text-left text-emerald-700 hover:bg-emerald-50"
            >
              <Globe className="size-4 shrink-0" />
              <span>
                <span className="block text-sm font-semibold">仅采集公告</span>
                <span className="mt-0.5 block text-xs font-normal text-[#667085]">只下载公告原文，不执行后续处理。</span>
              </span>
            </Button>
            <Button
              type="button"
              onClick={() => void chooseCrawlerJob("pipeline")}
              className="h-auto min-h-16 justify-start bg-[#162B49] px-4 py-3 text-left text-white hover:bg-[#1e3a5f]"
            >
              <Workflow className="size-4 shrink-0" />
              <span>
                <span className="block text-sm font-semibold">运行完整流程</span>
                <span className="mt-0.5 block text-xs font-normal text-white/70">继续运行数据处理、匹配与汇总，通过安全校验后自动发布。</span>
              </span>
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={llmModeDialogOpen} onOpenChange={setLlmModeDialogOpen}>
        <DialogContent className="max-w-md border-[#D9E2EC]">
          <DialogHeader>
            <DialogTitle className="text-base text-[#172033]">选择处理范围</DialogTitle>
            <DialogDescription className="text-[#667085]">
              常规公告会完成结构化处理、匹配与汇总；外来公告仅生成候选数据。
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-700">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            <span>处理完成后，请点击本卡片右上角「更多操作」菜单，选择「更新看板」发布结果。</span>
          </div>
          <div className="grid gap-3 pt-2">
            <Button
              type="button"
              onClick={() => void chooseLlmJob("llm")}
              className="h-11 justify-start bg-[#162B49] text-sm font-semibold text-white hover:bg-[#1e3a5f]"
            >
              <Database className="size-4" />
              处理常规公告
            </Button>
            <Button
              type="button"
              onClick={() => void chooseLlmJob("llm-external")}
              variant="outline"
              className="h-11 justify-start border-sky-200 text-sm font-semibold text-sky-700 hover:bg-sky-50"
            >
              <Upload className="size-4" />
              处理外来公告
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={fullRefreshDialogOpen} onOpenChange={closeFullRefreshDialog}>
        <DialogContent className="max-w-md border-[#D9E2EC]">
          <DialogHeader>
            <DialogTitle className="text-base text-[#172033]">确认全量重建</DialogTitle>
            <DialogDescription className="text-[#667085]">
              该操作会重新处理全部公告，并覆盖已有处理结果；增量处理不受影响。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-md bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-700">
              影响范围较大，请输入管理员密码确认身份后执行。
            </div>
            <div className="relative">
              <Lock className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[#98A2B3]" />
              <input
                type="password"
                value={fullRefreshPassword}
                onChange={(event) => setFullRefreshPassword(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void confirmFullRefresh();
                }}
                placeholder="请输入管理员密码"
                autoComplete="current-password"
                disabled={fullRefreshVerifying}
                className={cn(
                  "h-11 w-full rounded-lg border bg-white pl-10 pr-3 text-sm text-[#172033] outline-none transition-colors placeholder:text-[#98A2B3]",
                  fullRefreshError ? "border-rose-300 focus:border-rose-400" : "border-[#D9E2EC] focus:border-[#2563EB]",
                )}
              />
            </div>
            {fullRefreshError && <p className="text-xs text-rose-600">{fullRefreshError}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                onClick={() => closeFullRefreshDialog(false)}
                disabled={fullRefreshVerifying}
              >
                取消
              </Button>
              <Button
                type="button"
                onClick={() => void confirmFullRefresh()}
                disabled={isBusy || fullRefreshVerifying || !fullRefreshPassword}
                className="bg-amber-600 text-xs font-semibold text-white hover:bg-amber-700"
              >
                {fullRefreshVerifying ? (
                  <>
                    <RefreshCw className="size-3.5 animate-spin" />
                    验证中...
                  </>
                ) : (
                  "确认全量重建"
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
