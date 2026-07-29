"use client";

import { useCallback, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  Brain,
  CheckCircle2,
  Database,
  Globe,
  LogOut,
  RefreshCw,
  Smartphone,
  Sparkles,
  Square,
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
import { type JobStatus, type JobType } from "@/lib/api/backend-client";
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
  const [coords, setCoords] = useState({ x: 0, y: 0 });
  const [isHovered, setIsHovered] = useState(false);

  const handleMouseMove = (e: React.MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setCoords({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  };

  return (
    <Button
      type="button"
      onClick={onClick}
      disabled={disabled}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={cn(
        "relative overflow-hidden transition-all duration-200",
        className
      )}
    >
      {isHovered && !disabled && (
        <span
          className="absolute pointer-events-none rounded-full bg-white/20 blur-md transition-opacity duration-300 pointer-events-none"
          style={{
            width: "60px",
            height: "60px",
            left: `${coords.x - 30}px`,
            top: `${coords.y - 30}px`,
            transform: "translate3d(0, 0, 0)",
          }}
        />
      )}
      <span className="relative z-10 flex items-center justify-center gap-1.5 w-full h-full">
        {children}
      </span>
    </Button>
  );
}

export function AdminDashboard({ onBack, onDataRefresh }: DashboardProps) {
  const { username, token, logout, clearAuth } = useAuthStore();
  const [logDialogCard, setLogDialogCard] = useState<CardId | null>(null);
  const [crawlerModeDialogOpen, setCrawlerModeDialogOpen] = useState(false);
  const [llmModeDialogOpen, setLlmModeDialogOpen] = useState(false);
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
        iconBg: "from-emerald-500 to-teal-600",
        title: "公告采集",
        description: "抓取采购公告与结果公告；可选择仅采集，或继续运行完整 Pipeline。",
      },
      {
        id: "llm" as const,
        icon: Database,
        iconBg: "from-blue-500 to-indigo-600",
        title: "LLM 数据处理",
        description: "默认完成双公告 LLM、匹配与汇总；外来公告仅生成候选 CSV。",
      },
      {
        id: "ai" as const,
        icon: Brain,
        iconBg: "from-fuchsia-500 to-pink-600",
        title: "AI 情报分析",
        description: "基于当前正式看板数据生成近 30 天的 AI 情报分析。",
      },
      {
        id: "app-watch" as const,
        icon: Smartphone,
        iconBg: "from-sky-500 to-cyan-600",
        title: "券商 App 更新",
        description: "抓取各券商 App 更新公告并做 LLM 结构化，写入 App 更新看板。",
      },
    ],
    [],
  );

  const selectedLogCardState = logDialogCard ? cardStates[logDialogCard] : null;

  return (
    <div className="min-h-screen bg-[#F5F7FA]">
      <header className="sticky top-0 z-40 bg-[#162B49]/90 backdrop-blur-md border-b border-white/5 text-white">
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
              <Sparkles className="size-4 text-amber-400" />
              <span className="text-sm font-medium">管理控制台</span>
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
            <p className="mt-1 text-xs text-[#667085]">管理抓取、数据处理、推送发布与 AI 情报分析</p>
          </div>
          <div className="flex items-center gap-3 text-xs text-[#667085]">
            <span className="flex items-center gap-1 bg-white/70 backdrop-blur-md border border-white/40 px-2.5 py-1 rounded-full shadow-sm">
              <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
              服务已连接
            </span>
            <span className="bg-white/70 backdrop-blur-md border border-white/40 px-2.5 py-1 rounded-full shadow-sm">
              当前管理员: <span className="font-semibold text-[#172033]">{username}</span>
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 items-stretch gap-5 md:grid-cols-2 xl:grid-cols-3">
          {cards.map((card) => {
            const state = cardStates[card.id];
            const isBusy = Boolean(activeOperation);

            return (
              <section
                key={card.id}
                className="flex h-full flex-col rounded-2xl border border-[#E4E9F0] bg-white shadow-sm hover:shadow-md hover:-translate-y-[2px] transition-all duration-200"
              >
                <div className="flex h-full flex-col p-6">
                  <div className="flex items-start justify-between">
                    <div
                      className={cn(
                        "flex size-10 items-center justify-center rounded-xl bg-gradient-to-br shadow-sm",
                        card.iconBg,
                      )}
                    >
                      <card.icon className="size-5 text-white" />
                    </div>
                    <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-[10px] font-semibold text-blue-600 border border-blue-100">
                      已接通
                    </span>
                  </div>

                  <div className="mt-4 flex-grow flex flex-col justify-start">
                    <h3 className="text-base font-bold text-[#172033]">{card.title}</h3>
                    <p className="mt-1.5 text-xs leading-relaxed text-[#667085] min-h-[36px]">{card.description}</p>
                  </div>

                  <div className="mt-4 min-h-[110px] rounded-xl bg-[#F8FAFC]/85 backdrop-blur-sm border border-[#E4E9F0] p-4 flex flex-col justify-between">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold border", statusTone(state.status))}>
                          {statusText(state.status)}
                        </span>
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
                          className="h-10 text-xs font-semibold text-white bg-gradient-to-r from-[#162B49] to-[#2563EB] hover:from-[#1e3a5f] hover:to-[#3b82f6] shadow-sm flex-[7] flex items-center justify-center gap-1.5"
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
                        className="h-10 w-full text-xs font-semibold text-white bg-gradient-to-r from-[#162B49] to-[#2563EB] hover:from-[#1e3a5f] hover:to-[#3b82f6] shadow-sm flex items-center justify-center gap-1.5"
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
                          className="h-10 text-xs font-semibold text-white bg-gradient-to-r from-[#162B49] to-[#2563EB] hover:from-[#1e3a5f] hover:to-[#3b82f6] shadow-sm flex items-center justify-center gap-1.5"
                        >
                          {activeOperation?.id === "app-watch" ? (
                            <><RefreshCw className="size-3.5 animate-spin" />运行中...</>
                          ) : "运行更新采集"}
                        </GlowButton>
                        <Button
                          onClick={() => window.open('/app-updates', '_blank')}
                          disabled={isBusy}
                          variant="outline"
                          className="h-10 text-xs font-semibold border-[#E4E9F0] text-[#162B49] hover:bg-slate-50 flex items-center justify-center gap-1 transition-all"
                        >
                          <LayoutGrid className="size-3.5" />
                          前往 App 更新看板
                        </Button>
                      </div>
                    ) : (
                      <GlowButton
                        onClick={() => void runAiAnalysis()}
                        disabled={isBusy}
                        className="h-10 w-full text-xs font-semibold text-white bg-gradient-to-r from-[#162B49] to-[#2563EB] hover:from-[#1e3a5f] hover:to-[#3b82f6] shadow-sm flex items-center justify-center gap-1.5"
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

        <div className="mt-6 rounded-xl border border-blue-100 bg-blue-50/50 p-4">
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

        <UserApprovalManager />
        <AuditRecordsManager />
        <FeedbackManager />
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
