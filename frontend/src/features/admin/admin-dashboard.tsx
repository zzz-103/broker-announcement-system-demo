"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  Brain,
  Database,
  Download,
  FileText,
  Globe,
  Info,
  Lock,
  LogOut,
  MoreHorizontal,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { BackendApiError, buildApiUrl, exportDashboardData, readError, verifyAdminPassword, type JobStatus, type JobType } from "@/lib/api/backend-client";
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

export function AdminDashboard({ onBack, onDataRefresh }: DashboardProps) {
  const { username, token, logout, clearAuth } = useAuthStore();
  const [logDialogCard, setLogDialogCard] = useState<CardId | null>(null);
  const [crawlerModeDialogOpen, setCrawlerModeDialogOpen] = useState(false);
  const [llmModeDialogOpen, setLlmModeDialogOpen] = useState(false);
  const [fullRefreshDialogOpen, setFullRefreshDialogOpen] = useState(false);
  const [fullRefreshPassword, setFullRefreshPassword] = useState("");
  const [fullRefreshVerifying, setFullRefreshVerifying] = useState(false);
  const [fullRefreshError, setFullRefreshError] = useState<string | null>(null);
  const [dashboardExporting, setDashboardExporting] = useState(false);
  const [dashboardExportMessage, setDashboardExportMessage] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<"tasks" | "users" | "records">("tasks");
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

  const handleDashboardExport = useCallback(async () => {
    if (!token || dashboardExporting) return;
    setDashboardExporting(true);
    setDashboardExportMessage(null);
    try {
      const result = await exportDashboardData(token);
      const response = await fetch(buildApiUrl(result.download_url), { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new BackendApiError(await readError(response), response.status);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "dashboard-data.zip";
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setDashboardExportMessage(`导出成功：${result.manifest.package_version}，可直接解压后复制整个 dashboard-data 目录。`);
    } catch (error) {
      if (error instanceof BackendApiError && error.status === 401) clearAuth("登录已失效，请重新登录");
      else if (error instanceof BackendApiError && error.status === 409) setDashboardExportMessage(error.message);
      else setDashboardExportMessage(error instanceof Error ? error.message : "导出失败，请稍后重试");
    } finally {
      setDashboardExporting(false);
    }
  }, [clearAuth, dashboardExporting, token]);

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
    <div className="min-h-screen bg-[#F5F7FA]">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-[#162B49] text-white">
        <div className="mx-auto flex h-16 max-w-[1600px] items-center justify-between px-4 sm:px-8">
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
          <div className="flex items-center gap-3">
            <span className="text-xs text-white/60">{username}</span>
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
            ["records", "审计与反馈"],
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

        <section className="mt-5 rounded-lg border border-[#D9E2EC] bg-white shadow-[var(--workspace-shadow)]">
          <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-bold text-[#172033]">前端数据包</h2>
              <p className="mt-1 text-xs leading-relaxed text-[#667085]">导出当前招采、App 更新与分析结果，供前端看板使用。</p>
              {dashboardExportMessage && <p className="mt-2 text-xs text-[#2563EB]">{dashboardExportMessage}</p>}
            </div>
            <Button type="button" onClick={() => void handleDashboardExport()} disabled={Boolean(activeOperation) || dashboardExporting} className="shrink-0 bg-[#162B49] text-xs font-semibold text-white hover:bg-[#1e3a5f]">
              {dashboardExporting ? <><RefreshCw className="size-3.5 animate-spin" />导出中...</> : <><Download className="size-3.5" />导出前端数据</>}
            </Button>
          </div>
        </section>

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
              任务按当前选择范围运行。更新看板后，前端数据才会同步刷新。
            </p>
          </div>
        </div>

        </>}

        {activeSection === "users" && <UserApprovalManager />}
        {activeSection === "records" && <><AuditRecordsManager /><FeedbackManager /></>}
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
              两种方式都会依次采集采购公告和结果公告；完整流程不会自动更新看板。
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
                <span className="mt-0.5 block text-xs font-normal text-white/70">继续运行数据处理、匹配与汇总，完成后由人工更新看板。</span>
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
