"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  Brain,
  CheckCircle2,
  Database,
  Download,
  Globe,
  LogOut,
  RefreshCw,
  Smartphone,
  TerminalSquare,
  Upload,
  Workflow,
  LayoutGrid,
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
import { BackendApiError, buildApiUrl, exportDashboardData, readError, type JobStatus, type JobType } from "@/lib/api/backend-client";
import { APP_VERSION } from "@/lib/app-version";
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
  if (status === "running") return "运行中";
  if (status === "succeeded") return "已完成";
  if (status === "failed") return "失败";
  if (status === "cancelled") return "已停止";
  return "待执行";
}

function iconForStatus(status: JobStatus) {
  if (status === "running") return <RefreshCw className="size-3.5 animate-spin" />;
  if (status === "succeeded") return <CheckCircle2 className="size-3.5" />;
  if (status === "failed" || status === "cancelled") return <AlertCircle className="size-3.5" />;
  return <TerminalSquare className="size-3.5" />;
}

function GlowButton({
  children,
  onClick,
  disabled,
  className,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={className}
    >
      {children}
    </Button>
  );
}

export function AdminDashboard({ onBack, onDataRefresh }: DashboardProps) {
  const router = useRouter();
  const { username, token, logout, clearAuth } = useAuthStore();
  const [logDialogCard, setLogDialogCard] = useState<CardId | null>(null);
  const [crawlerModeDialogOpen, setCrawlerModeDialogOpen] = useState(false);
  const [llmModeDialogOpen, setLlmModeDialogOpen] = useState(false);
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

  const runFullRefresh = useCallback(async () => {
    setLlmModeDialogOpen(false);
    const confirmed = window.confirm(
      "确认执行 LLM 全量重建？该操作会重新请求全部 Markdown，并覆盖已有 raw_json 缓存。普通增量任务不受影响。",
    );
    if (!confirmed) return;
    await runJob("llm", { mode: "full_refresh", overwrite: true });
  }, [runJob]);

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
    stopLocalMonitoring();
    logout();
  }, [logout, stopLocalMonitoring]);

  const cards = useMemo(
    () => [
      {
        id: "crawler" as const,
        icon: Globe,
        title: "公告采集",
        description: "采集采购公告与结果公告，可继续执行完整处理流程。",
      },
      {
        id: "llm" as const,
        icon: Database,
        title: "公告数据处理",
        description: "结构化处理公告，完成项目匹配与结果汇总。",
      },
      {
        id: "ai" as const,
        icon: Brain,
        title: "招采分析",
        description: "基于正式看板数据更新近 30 天分析报告。",
      },
      {
        id: "app-watch" as const,
        icon: Smartphone,
        title: "券商 App 更新",
        description: "采集并处理券商 App 更新公告，更新明细看板。",
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
            <p className="mt-1 text-xs text-[#667085]">运行数据任务，管理用户与查看业务记录</p>
          </div>
          <div className="flex items-center gap-3 text-xs text-[#667085]">
            <span className="border border-[#D9E2EC] bg-white px-2.5 py-1 rounded-md">
              当前管理员: <span className="font-semibold text-[#172033]">{username}</span>
            </span>
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
            const isBusy = Boolean(activeOperation);

            return (
              <section
                key={card.id}
                className="flex h-full flex-col rounded-lg border border-[#D9E2EC] bg-white shadow-[var(--workspace-shadow)]"
              >
                <div className="flex h-full flex-col p-6">
                  <div className="flex items-start justify-between">
                    <div
                      className="flex size-9 items-center justify-center rounded-md bg-[#EAF2FF]"
                    >
                      <card.icon className="size-4.5 text-[#1F5BB5]" />
                    </div>
                    <span className={cn("rounded-full px-2.5 py-0.5 text-[10px] font-semibold", statusTone(state.status))}>{statusText(state.status)}</span>
                  </div>

                  <div className="mt-4 flex-grow flex flex-col justify-start">
                    <h3 className="text-base font-bold text-[#172033]">{card.title}</h3>
                    <p className="mt-1.5 text-xs leading-relaxed text-[#667085] min-h-[36px]">{card.description}</p>
                  </div>

                  <div className="mt-4 min-h-[104px] border-t border-[#E4E9F0] pt-4 flex flex-col justify-between">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-[#98A2B3] font-medium">{state.lastOperationLabel}</span>
                      </div>

                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={state.logs.length === 0}
                        onClick={() => setLogDialogCard(card.id)}
                        title="查看详细日志"
                        className="size-7 hover:bg-slate-200/50 text-[#667085] disabled:opacity-30 rounded-lg flex items-center justify-center"
                      >
                        <TerminalSquare className="size-4" />
                      </Button>
                    </div>
                    
                    <div className="mt-3 flex items-start gap-2 flex-grow">
                      <span className="mt-0.5 shrink-0 text-[#98A2B3]">{iconForStatus(state.status)}</span>
                      <span className="min-h-[40px] whitespace-pre-wrap break-words text-xs text-[#35537A] leading-relaxed line-clamp-3">
                        {state.summary}
                      </span>
                    </div>
                  </div>

                  <div className="mt-6 pt-4 border-t border-[#F0F2F5] mt-auto">
                    {card.id === "llm" ? (
                      <div className="flex items-center gap-2 w-full">
                        <GlowButton
                          onClick={() => setLlmModeDialogOpen(true)}
                          disabled={isBusy}
                          className="h-10 flex-[7] bg-[#1F5BB5] text-xs font-semibold text-white hover:bg-[#174B98]"
                        >
                          {activeOperation?.id === "llm" || activeOperation?.id === "llm-external" ? (
                            <>
                              <RefreshCw className="size-3.5 animate-spin" />
                              运行中...
                            </>
                          ) : (
                            "运行 LLM"
                          )}
                        </GlowButton>
                        <Button
                          type="button"
                          onClick={() => void runFullRefresh()}
                          disabled={isBusy}
                          variant="outline"
                          className="h-10 text-xs font-semibold border-amber-200 text-amber-700 hover:bg-amber-50 flex-[3] flex items-center justify-center gap-1"
                        >
                          全量重建
                        </Button>
                        <Button
                          type="button"
                          onClick={() => void runPublish()}
                          disabled={isBusy}
                          variant="outline"
                          className="h-10 text-xs font-semibold border-[#E4E9F0] text-[#162B49] hover:bg-slate-50 flex-[3] flex items-center justify-center gap-1"
                        >
                          {activeOperation?.id === "publish" ? (
                            <>
                              <RefreshCw className="size-3.5 animate-spin" />
                              推送中
                            </>
                          ) : (
                            <>
                              <Upload className="size-3.5" />
                              推送
                            </>
                          )}
                        </Button>
                      </div>
                    ) : card.id === "crawler" ? (
                      <GlowButton
                        onClick={() => setCrawlerModeDialogOpen(true)}
                        disabled={isBusy}
                        className="h-10 w-full bg-[#1F5BB5] text-xs font-semibold text-white hover:bg-[#174B98]"
                      >
                        {activeOperation?.id === "scraper" || activeOperation?.id === "pipeline" ? (
                          <><RefreshCw className="size-3.5 animate-spin" />运行中...</>
                        ) : "选择采集方式"}
                      </GlowButton>
                    ) : card.id === "app-watch" ? (
                      <div className="flex flex-col gap-2 w-full">
                        <GlowButton
                          onClick={() => void runJob("app-watch")}
                          disabled={isBusy}
                          className="h-10 bg-[#1F5BB5] text-xs font-semibold text-white hover:bg-[#174B98]"
                        >
                          {activeOperation?.id === "app-watch" ? (
                            <><RefreshCw className="size-3.5 animate-spin" />运行中...</>
                          ) : "运行更新采集"}
                        </GlowButton>
                        <Button
                          onClick={() => router.push("/app-updates")}
                          disabled={isBusy}
                          variant="outline"
                          className="h-10 text-xs font-semibold border-[#E4E9F0] text-[#162B49] hover:bg-slate-50 flex items-center justify-center gap-1 transition-colors"
                        >
                          <LayoutGrid className="size-3.5" />
                          前往 App 更新看板
                        </Button>
                      </div>
                    ) : (
                      <GlowButton
                        onClick={() => void runAiAnalysis()}
                        disabled={isBusy}
                        className="h-10 w-full bg-[#1F5BB5] text-xs font-semibold text-white hover:bg-[#174B98]"
                      >
                        {activeOperation?.cardId === card.id ? (
                          <>
                            <RefreshCw className="size-3.5 animate-spin" />
                            运行中...
                          </>
                        ) : "生成分析"}
                      </GlowButton>
                    )}
                  </div>
                </div>
              </section>
            );
          })}
        </div>

        <section className="mt-5 rounded-lg border border-[#D9E2EC] bg-white shadow-[var(--workspace-shadow)]">
          <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-bold text-[#172033]">纯前端数据包</h2>
              <p className="mt-1 text-xs leading-relaxed text-[#667085]">导出当前招采、App 更新、筛选项与分析结果，供纯前端看板使用。</p>
              {dashboardExportMessage && <p className="mt-2 text-xs text-[#2563EB]">{dashboardExportMessage}</p>}
            </div>
            <Button type="button" onClick={() => void handleDashboardExport()} disabled={Boolean(activeOperation) || dashboardExporting} className="shrink-0 bg-[#162B49] text-xs font-semibold text-white hover:bg-[#1e3a5f]">
              {dashboardExporting ? <><RefreshCw className="size-3.5 animate-spin" />导出中...</> : <><Download className="size-3.5" />导出纯前端数据</>}
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
            <div className="text-xs text-blue-800 flex flex-wrap gap-x-6 gap-y-1 leading-relaxed">
              <p>
                <span className="font-semibold text-blue-900">操作说明：</span>
                仅采集会顺序抓取采购公告和结果公告；之后运行 LLM 会自动完成匹配与汇总，且不会自动推送正式看板。
              </p>
              <p>
                <span className="font-semibold text-blue-900">注意事项：</span>
                推送成功后才会刷新看板数据；关闭日志弹窗不会中止后端任务。
              </p>
            </div>
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
            <DialogTitle className="text-base text-[#172033]">选择采集方式</DialogTitle>
            <DialogDescription className="text-[#667085]">
              两种方式都会依次抓取采购公告和结果公告；完整 Pipeline 不会自动推送正式看板。
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
                <span className="block text-sm font-semibold">仅爬取双公告</span>
                <span className="mt-0.5 block text-xs font-normal text-[#667085]">只下载 Markdown，不运行 LLM、匹配或汇总。</span>
              </span>
            </Button>
            <Button
              type="button"
              onClick={() => void chooseCrawlerJob("pipeline")}
              className="h-auto min-h-16 justify-start bg-[#162B49] px-4 py-3 text-left text-white hover:bg-[#1e3a5f]"
            >
              <Workflow className="size-4 shrink-0" />
              <span>
                <span className="block text-sm font-semibold">运行完整 Pipeline</span>
                <span className="mt-0.5 block text-xs font-normal text-white/70">继续运行双 LLM、匹配与 merger，完成后人工推送。</span>
              </span>
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={llmModeDialogOpen} onOpenChange={setLlmModeDialogOpen}>
        <DialogContent className="max-w-md border-[#D9E2EC]">
          <DialogHeader>
            <DialogTitle className="text-base text-[#172033]">选择 LLM 处理来源</DialogTitle>
            <DialogDescription className="text-[#667085]">
              正常公告会处理双公告并自动匹配、汇总；外来 Markdown 仅生成候选 CSV。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 pt-2">
            <Button
              type="button"
              onClick={() => void chooseLlmJob("llm")}
              className="h-11 justify-start bg-[#162B49] text-sm font-semibold text-white hover:bg-[#1e3a5f]"
            >
              <Database className="size-4" />
              处理双公告并匹配
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
    </div>
  );
}
