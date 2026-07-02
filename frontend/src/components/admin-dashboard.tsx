"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  Brain,
  CheckCircle2,
  Database,
  Globe,
  LogOut,
  RefreshCw,
  Sparkles,
  Square,
  TerminalSquare,
  Upload,
} from "lucide-react";

import { AdminTaskLogDialog, type AdminTaskLogLine } from "@/components/admin-task-log-dialog";
import {
  AdminTaskProgress,
  type AdminTaskProgressState,
} from "@/components/admin-task-progress";
import { UserApprovalManager } from "@/components/user-approval-manager";
import { Button } from "@/components/ui/button";
import {
  BackendApiError,
  cancelJob,
  generateAiAnalysis,
  getJob,
  type JobEvent,
  type JobStatus,
  type JobType,
  publishAnnouncements,
  startJob,
  streamJobEvents,
} from "@/lib/api/backend-client";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/store/auth-store";

interface DashboardProps {
  onBack: () => void;
  onDataRefresh?: () => void;
}

type CardId = "crawler" | "llm" | "ai";
type OperationId = "scraper" | "llm" | "publish" | "ai_analysis";

interface TaskCardState {
  status: JobStatus;
  summary: string;
  logs: AdminTaskLogLine[];
  lastOperationLabel: string;
}

interface ActiveOperation {
  id: OperationId;
  cardId: CardId;
  label: string;
}

const MAX_LOG_LINES = 300;
const PROGRESS_RESET_DELAY_MS = 4000;

const INITIAL_CARD_STATE: Record<CardId, TaskCardState> = {
  crawler: {
    status: "idle",
    summary: "用于抓取最新公告原始 Markdown 数据。",
    logs: [],
    lastOperationLabel: "一键更新爬虫",
  },
  llm: {
    status: "idle",
    summary: "先生成候选 CSV，再由管理员手动推送到正式看板。",
    logs: [],
    lastOperationLabel: "LLM 数据处理",
  },
  ai: {
    status: "idle",
    summary: "基于当前正式看板数据生成 AI 情报分析。",
    logs: [],
    lastOperationLabel: "AI 情报分析",
  },
};

const IDLE_PROGRESS: AdminTaskProgressState = {
  status: "idle",
  taskName: "统一任务进度",
  message: "当前没有运行中的任务",
};

function backendErrorMessage(error: BackendApiError) {
  if (error.status === 0) {
    return "无法连接 FastAPI 后端，请确认 http://localhost:8000 已启动。";
  }
  return error.message;
}

function statusTone(status: JobStatus) {
  if (status === "running") return "bg-blue-50 text-blue-700";
  if (status === "succeeded") return "bg-emerald-50 text-emerald-700";
  if (status === "failed") return "bg-rose-50 text-rose-700";
  return "bg-slate-50 text-slate-600";
}

function statusText(status: JobStatus) {
  if (status === "running") return "运行中";
  if (status === "succeeded") return "已完成";
  if (status === "failed") return "失败";
  return "待执行";
}

function trimLogs(logs: AdminTaskLogLine[]) {
  return logs.slice(-MAX_LOG_LINES);
}

function cardIdForJob(jobType: JobType): CardId {
  return jobType === "scraper" ? "crawler" : "llm";
}

function labelForOperation(operationId: OperationId): string {
  if (operationId === "scraper") return "一键更新爬虫";
  if (operationId === "llm") return "LLM 数据处理";
  if (operationId === "publish") return "推送";
  return "AI 情报分析";
}

function iconForStatus(status: JobStatus) {
  if (status === "running") return <RefreshCw className="size-3.5 animate-spin" />;
  if (status === "succeeded") return <CheckCircle2 className="size-3.5" />;
  if (status === "failed") return <AlertCircle className="size-3.5" />;
  return <TerminalSquare className="size-3.5" />;
}

export function AdminDashboard({ onBack, onDataRefresh }: DashboardProps) {
  const { username, token, logout, clearAuth } = useAuthStore();
  const [cardStates, setCardStates] = useState<Record<CardId, TaskCardState>>(INITIAL_CARD_STATE);
  const [progressState, setProgressState] = useState<AdminTaskProgressState>(IDLE_PROGRESS);
  const [activeOperation, setActiveOperationState] = useState<ActiveOperation | null>(null);
  const activeOperationRef = useRef<ActiveOperation | null>(null);
  const setActiveOperation = useCallback((op: ActiveOperation | null) => {
    activeOperationRef.current = op;
    setActiveOperationState(op);
  }, []);

  const [logDialogCard, setLogDialogCard] = useState<CardId | null>(null);

  const mountedRef = useRef(true);
  const resetTimerRef = useRef<number | null>(null);
  // AbortControllers for SSE-based jobs (scraper, llm)
  const abortRefs = useRef<Record<JobType, AbortController | null>>({
    scraper: null,
    llm: null,
  });
  // Ref tracking the current job_id for SSE jobs so cancel can call the API
  const currentJobIdRef = useRef<string>("");
  // AbortController for non-SSE direct fetch operations (ai_analysis, publish)
  const directAbortRef = useRef<AbortController | null>(null);
  // Polling timers
  const pollingTimerRef = useRef<Record<OperationId, NodeJS.Timeout | null>>({
    scraper: null,
    llm: null,
    publish: null,
    ai_analysis: null,
  });

  const clearProgressResetTimer = useCallback(() => {
    if (resetTimerRef.current !== null) {
      window.clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      clearProgressResetTimer();
      abortRefs.current.scraper?.abort();
      abortRefs.current.llm?.abort();
      directAbortRef.current?.abort();

      // Clear any active polling timers
      if (pollingTimerRef.current.scraper) clearInterval(pollingTimerRef.current.scraper);
      if (pollingTimerRef.current.llm) clearInterval(pollingTimerRef.current.llm);
      if (pollingTimerRef.current.publish) clearInterval(pollingTimerRef.current.publish);
      if (pollingTimerRef.current.ai_analysis) clearInterval(pollingTimerRef.current.ai_analysis);
    };
  }, [clearProgressResetTimer]);

  const updateCardState = useCallback(
    (cardId: CardId, updater: (previous: TaskCardState) => TaskCardState) => {
      setCardStates((previous) => ({
        ...previous,
        [cardId]: updater(previous[cardId]),
      }));
    },
    [],
  );

  const appendLog = useCallback(
    (cardId: CardId, stream: AdminTaskLogLine["stream"], message: string) => {
      updateCardState(cardId, (previous) => ({
        ...previous,
        logs: trimLogs([...previous.logs, { stream, message }]),
      }));
    },
    [updateCardState],
  );

  const setCardSummary = useCallback(
    (cardId: CardId, status: JobStatus, summary: string, operationLabel?: string) => {
      updateCardState(cardId, (previous) => ({
        ...previous,
        status,
        summary,
        lastOperationLabel: operationLabel || previous.lastOperationLabel,
      }));
    },
    [updateCardState],
  );

  const beginOperation = useCallback(
    (operationId: OperationId, cardId: CardId, initialMessage: string) => {
      clearProgressResetTimer();
      const label = labelForOperation(operationId);
      setActiveOperation({ id: operationId, cardId, label });
      setCardSummary(cardId, "running", initialMessage, label);
      setProgressState({
        status: "running",
        taskName: label,
        message: initialMessage,
      });
      appendLog(cardId, "system", initialMessage);
      return label;
    },
    [appendLog, clearProgressResetTimer, setCardSummary, setActiveOperation],
  );

  const finalizeTask = useCallback(
    (
      operationId: OperationId,
      status: Exclude<JobStatus, "idle" | "running">,
      summary: string
    ) => {
      // Prevent duplicate finalization
      if (!activeOperationRef.current || activeOperationRef.current.id !== operationId) {
        console.log(`[Diagnostic] finalizeTask ignored for ${operationId} (current active: ${activeOperationRef.current?.id})`);
        return;
      }

      const label = labelForOperation(operationId);
      const cardId =
        operationId === "ai_analysis"
          ? "ai"
          : operationId === "scraper"
            ? "crawler"
            : "llm";

      setCardSummary(cardId, status, summary, label);
      setProgressState({
        status,
        taskName: label,
        message: summary,
      });

      // Clear active operation
      setActiveOperation(null);

      // Clean up AbortControllers
      if (operationId === "scraper" || operationId === "llm") {
        if (abortRefs.current[operationId]) {
          abortRefs.current[operationId]?.abort();
          abortRefs.current[operationId] = null;
        }
      } else {
        if (directAbortRef.current) {
          directAbortRef.current.abort();
          directAbortRef.current = null;
        }
      }

      // Clean up polling timer
      if (pollingTimerRef.current[operationId]) {
        clearInterval(pollingTimerRef.current[operationId]!);
        pollingTimerRef.current[operationId] = null;
      }

      clearProgressResetTimer();
      resetTimerRef.current = window.setTimeout(() => {
        if (!mountedRef.current) return;
        setProgressState(IDLE_PROGRESS);
      }, PROGRESS_RESET_DELAY_MS);
    },
    [clearProgressResetTimer, setCardSummary, setActiveOperation],
  );

  const handleUnauthorized = useCallback(() => {
    clearAuth("登录已失效，请重新登录。");
  }, [clearAuth]);

  const handleJobEvent = useCallback(
    (jobType: JobType, event: JobEvent) => {
      const cardId = cardIdForJob(jobType);
      const label = labelForOperation(jobType);

      if (event.type === "start") {
        const message = event.message || `${label}已开始。`;
        setCardSummary(cardId, "running", message, label);
        setProgressState({
          status: "running",
          taskName: label,
          message,
        });
        appendLog(cardId, "system", message);
        return;
      }

      if (event.type === "progress") {
        setCardSummary(cardId, "running", event.message, label);
        setProgressState({
          status: "running",
          taskName: label,
          message: event.message,
          stage: event.stage,
          current: event.current,
          total: event.total,
        });
        return;
      }

      if (event.type === "log") {
        appendLog(cardId, event.stream, event.message);
        const cleanMsg =
          event.stream === "stdout" && event.message.trim().length > 0 && event.message.length < 60
            ? event.message.trim()
            : "任务正在运行";
        setProgressState((prev) => {
          if (prev.stage) return prev;
          return { ...prev, message: cleanMsg };
        });
        setCardSummary(cardId, "running", cleanMsg, label);
        return;
      }

      const succeeded = event.status === "succeeded";
      const summary = succeeded
        ? `${label}已完成。`
        : `${label}执行失败${event.error ? `：${event.error}` : "。"} `;
      appendLog(
        cardId,
        "system",
        succeeded
          ? `${label}完成，exit_code=${event.exit_code ?? "unknown"}`
          : `${label}失败，exit_code=${event.exit_code ?? "unknown"}${event.error ? `，${event.error}` : ""}`,
      );
      finalizeTask(jobType, succeeded ? "succeeded" : "failed", summary.trim());
    },
    [appendLog, finalizeTask, setCardSummary],
  );

  const runJob = useCallback(
    async (jobType: JobType) => {
      if (activeOperationRef.current) return;
      if (!token) {
        handleUnauthorized();
        return;
      }

      const cardId = cardIdForJob(jobType);
      const initialMessage =
        jobType === "scraper"
          ? "正在连接后端并启动爬虫任务..."
          : "正在启动 LLM 数据处理，输出候选 CSV...";
      const label = beginOperation(jobType, cardId, initialMessage);
      const controller = new AbortController();
      abortRefs.current[jobType]?.abort();
      abortRefs.current[jobType] = controller;
      currentJobIdRef.current = "";

      let jobId = "";
      let doneReceived = false;
      let hasReceivedEvents = false;
      let connectionTimeout: NodeJS.Timeout | null = null;

      const stopPolling = () => {
        if (pollingTimerRef.current[jobType]) {
          clearInterval(pollingTimerRef.current[jobType]!);
          pollingTimerRef.current[jobType] = null;
        }
      };

      const startPolling = () => {
        if (pollingTimerRef.current[jobType]) return;
        console.log(`[Diagnostic] Polling started for ${jobType}, job_id=${jobId}`);
        pollingTimerRef.current[jobType] = setInterval(async () => {
          try {
            const job = await getJob(jobId, token);
            console.log(`[Diagnostic] Polling status for ${jobId}: ${job.status}`);
            if (!mountedRef.current) {
              stopPolling();
              return;
            }
            if (job.status === "running") {
              setProgressState((prev) => {
                if (prev.message === "任务已启动，正在运行") return prev;
                return { ...prev, message: "任务已启动，正在运行" };
              });
              setCardSummary(cardId, "running", "任务已启动，正在运行", label);
            } else if (job.status === "succeeded" || job.status === "failed") {
              const succeeded = job.status === "succeeded";
              const summary = succeeded ? `${label}已完成。` : `${label}执行失败。`;
              appendLog(cardId, "system", `轮询检测到任务已结束，状态：${job.status}`);
              finalizeTask(jobType, succeeded ? "succeeded" : "failed", summary);
            }
          } catch (pollError) {
            console.error(`[Diagnostic] Error polling job ${jobId}:`, pollError);
            if (!mountedRef.current) {
              stopPolling();
              return;
            }
            if (pollError instanceof BackendApiError && pollError.status === 401) {
              stopPolling();
              handleUnauthorized();
              return;
            }
            const errMsg = pollError instanceof Error ? pollError.message : "查询任务状态失败。";
            appendLog(cardId, "system", `轮询查询失败：${errMsg}`);
            finalizeTask(jobType, "failed", `${label}执行失败（状态查询异常）。`);
          }
        }, 2000);
      };

      try {
        const started = await startJob(jobType, token);
        jobId = started.job_id;
        currentJobIdRef.current = jobId;
        appendLog(cardId, "system", `${label}已启动，job_id=${jobId}`);

        // Update state to running and set message to "任务已启动，正在运行" immediately after getting job_id
        setCardSummary(cardId, "running", "任务已启动，正在运行", label);
        setProgressState({
          status: "running",
          taskName: label,
          message: "任务已启动，正在运行",
        });

        // Start connection timeout (10s)
        connectionTimeout = setTimeout(() => {
          if (!hasReceivedEvents && !doneReceived && !controller.signal.aborted) {
            console.log(`[Diagnostic] SSE connection timeout (10s) for ${jobType}. Starting fallback polling.`);
            appendLog(cardId, "system", "连接超时，启动轮询兜底机制获取状态...");
            startPolling();
          }
        }, 10000);

        await streamJobEvents(
          jobId,
          token,
          (event) => {
            if (!mountedRef.current) return;
            hasReceivedEvents = true;
            if (event.type === "done") {
              doneReceived = true;
            }
            handleJobEvent(jobType, event);
          },
          controller.signal,
        );

        console.log(`[Diagnostic] streamJobEvents resolved. doneReceived=${doneReceived}`);
        if (!doneReceived && jobId && !controller.signal.aborted) {
          console.log(`[Diagnostic] SSE closed without done. Fetching job status immediately.`);
          const job = await getJob(jobId, token);
          if (!mountedRef.current) return;
          if (job.status === "succeeded" || job.status === "failed") {
            const succeeded = job.status === "succeeded";
            const summary = succeeded ? `${label}已完成。` : `${label}执行失败。`;
            appendLog(cardId, "system", `SSE 已断开，直接查询任务状态为终态：${job.status}`);
            finalizeTask(jobType, succeeded ? "succeeded" : "failed", summary);
          } else {
            appendLog(cardId, "system", `SSE 已断开，任务仍在运行，启动轮询兜底。`);
            startPolling();
          }
        }
      } catch (error) {
        if (controller.signal.aborted || !mountedRef.current) return;
        if (error instanceof BackendApiError && error.status === 401) {
          handleUnauthorized();
          return;
        }

        if (jobId) {
          try {
            console.log(`[Diagnostic] SSE stream failed, querying job status fallback.`);
            const job = await getJob(jobId, token);
            if (job.status === "succeeded" || job.status === "failed") {
              const succeeded = job.status === "succeeded";
              const summary = succeeded ? `${label}已完成。` : `${label}执行失败。`;
              finalizeTask(jobType, succeeded ? "succeeded" : "failed", summary);
              return;
            } else {
              startPolling();
              return;
            }
          } catch (e) {
            // ignore and fallback
          }
        }

        const summary =
          error instanceof BackendApiError
            ? backendErrorMessage(error)
            : error instanceof Error
              ? error.message
              : `${label}执行失败。`;
        appendLog(cardId, "system", summary);
        finalizeTask(jobType, "failed", summary);
      } finally {
        if (abortRefs.current[jobType] === controller) {
          abortRefs.current[jobType] = null;
        }
        if (connectionTimeout) {
          clearTimeout(connectionTimeout);
        }
      }
    },
    [
      appendLog,
      beginOperation,
      finalizeTask,
      handleJobEvent,
      handleUnauthorized,
      setCardSummary,
      token,
    ],
  );

  const runPublish = useCallback(async () => {
    if (activeOperationRef.current) return;
    if (!token) {
      handleUnauthorized();
      return;
    }

    const label = beginOperation("publish", "llm", "正在校验候选 CSV 并推送到正式看板...");
    const controller = new AbortController();
    directAbortRef.current?.abort();
    directAbortRef.current = controller;

    try {
      const result = await publishAnnouncements(token, controller.signal);
      if (controller.signal.aborted || !mountedRef.current) return;
      const summary = `推送成功，正式看板已更新 ${result.meta.count} 条记录。`;
      appendLog("llm", "system", summary);
      finalizeTask("publish", "succeeded", summary);
      onDataRefresh?.();
    } catch (error) {
      if (controller.signal.aborted || !mountedRef.current) return;
      if (error instanceof BackendApiError && error.status === 401) {
        handleUnauthorized();
        return;
      }
      const summary =
        error instanceof BackendApiError
          ? backendErrorMessage(error)
          : error instanceof Error
            ? error.message
            : "推送失败。";
      appendLog("llm", "system", summary);
      finalizeTask("publish", "failed", summary);
    } finally {
      if (directAbortRef.current === controller) {
        directAbortRef.current = null;
      }
    }
  }, [appendLog, beginOperation, finalizeTask, handleUnauthorized, onDataRefresh, token]);

  const handleCancel = useCallback(async () => {
    if (!activeOperationRef.current || !token) return;
    const op = activeOperationRef.current;

    if (op.id === "scraper" || op.id === "llm") {
      const jobId = currentJobIdRef.current;
      if (jobId) {
        try {
          await cancelJob(jobId, token);
        } catch {
          // ignore
        }
      }
      abortRefs.current[op.id as JobType]?.abort();
      if (mountedRef.current) {
        const summary = `${op.label}已手动终止。`;
        appendLog(op.cardId, "system", summary);
        finalizeTask(op.id, "failed", summary);
      }
      return;
    }

    directAbortRef.current?.abort();
    if (mountedRef.current) {
      const summary = `${op.label}已手动终止。`;
      appendLog(op.cardId, "system", summary);
      finalizeTask(op.id, "failed", summary);
    }
  }, [appendLog, finalizeTask, token]);

  const runAiAnalysis = useCallback(async () => {
    if (activeOperationRef.current) return;
    if (!token) {
      handleUnauthorized();
      return;
    }

    const label = beginOperation("ai_analysis", "ai", "正在生成 AI 情报分析...");
    const controller = new AbortController();
    directAbortRef.current?.abort();
    directAbortRef.current = controller;

    try {
      const result = await generateAiAnalysis(token, controller.signal);
      if (controller.signal.aborted || !mountedRef.current) return;
      const summary = `AI 情报分析已生成，样本数 ${result.meta?.source_count ?? 0}。`;
      appendLog("ai", "system", summary);
      finalizeTask("ai_analysis", "succeeded", summary);
    } catch (error) {
      if (controller.signal.aborted || !mountedRef.current) return;
      if (error instanceof BackendApiError && error.status === 401) {
        handleUnauthorized();
        return;
      }
      const summary =
        error instanceof BackendApiError
          ? backendErrorMessage(error)
          : error instanceof Error
            ? error.message
            : "AI 情报分析生成失败。";
      appendLog("ai", "system", summary);
      finalizeTask("ai_analysis", "failed", summary);
    } finally {
      if (directAbortRef.current === controller) {
        directAbortRef.current = null;
      }
    }
  }, [appendLog, beginOperation, finalizeTask, handleUnauthorized, token]);

  const handleLogout = useCallback(() => {
    abortRefs.current.scraper?.abort();
    abortRefs.current.llm?.abort();
    logout();
  }, [logout]);

  const cards = useMemo(
    () => [
      {
        id: "crawler" as const,
        icon: Globe,
        iconBg: "from-emerald-500 to-teal-600",
        title: "一键更新爬虫",
        description: "启动后端爬虫任务，抓取最新公告原始 Markdown 数据。",
      },
      {
        id: "llm" as const,
        icon: Database,
        iconBg: "from-blue-500 to-indigo-600",
        title: "LLM 数据处理",
        description: "生成候选 CSV；确认成功后再执行推送，正式发布到看板。",
      },
      {
        id: "ai" as const,
        icon: Brain,
        iconBg: "from-fuchsia-500 to-pink-600",
        title: "AI 情报分析",
        description: "基于当前正式看板数据生成近 30 天的 AI 情报分析。",
      },
    ],
    [],
  );

  const selectedLogCardState = logDialogCard ? cardStates[logDialogCard] : null;

  return (
    <div className="min-h-screen bg-[#F5F7FA]">
      <header className="sticky top-0 z-40 bg-[#162B49] text-white">
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

      <main className="mx-auto max-w-[1200px] px-4 py-8 sm:px-8">
        <div className="mb-8">
          <h1 className="text-xl font-bold text-[#172033]">管理控制台</h1>
          <p className="mt-1 text-sm text-[#667085]">管理抓取、候选数据生成、推送发布与 AI 情报分析。</p>
        </div>

        <div className="grid grid-cols-1 items-stretch gap-5 md:grid-cols-3">
          {cards.map((card) => {
            const state = cardStates[card.id];
            const isBusy = Boolean(activeOperation);

            return (
              <section
                key={card.id}
                className="flex h-full flex-col rounded-xl border border-[#E4E9F0] bg-white shadow-sm transition-shadow hover:shadow-md"
              >
                <div className="flex h-full flex-col p-5">
                  <div className="flex items-start justify-between">
                    <div
                      className={cn(
                        "flex size-10 items-center justify-center rounded-xl bg-gradient-to-br shadow-sm",
                        card.iconBg,
                      )}
                    >
                      <card.icon className="size-5 text-white" />
                    </div>
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-600">
                      已接通
                    </span>
                  </div>

                  <div className="mt-4 min-h-[84px]">
                    <h3 className="text-[15px] font-semibold text-[#172033]">{card.title}</h3>
                    <p className="mt-1 text-xs leading-relaxed text-[#667085]">{card.description}</p>
                  </div>

                  <div className="mt-4 min-h-[110px] rounded-xl border border-[#E8EDF4] bg-[#F8FAFC] px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", statusTone(state.status))}>
                            {statusText(state.status)}
                          </span>
                          <span className="text-[11px] text-[#8A94A6]">{state.lastOperationLabel}</span>
                        </div>
                        <div className="mt-2 flex items-start gap-2 text-sm text-[#35537A]">
                          <span className="mt-0.5 shrink-0">{iconForStatus(state.status)}</span>
                          <span className="min-h-[40px] whitespace-pre-wrap break-words text-[#35537A]">
                            {state.summary}
                          </span>
                        </div>
                      </div>

                      <Button
                        type="button"
                        variant="outline"
                        size="icon-sm"
                        disabled={state.logs.length === 0}
                        onClick={() => setLogDialogCard(card.id)}
                        className="border-[#D0D8E2] bg-white text-[#35537A] disabled:opacity-40"
                      >
                        <TerminalSquare className="size-4" />
                      </Button>
                    </div>
                  </div>

                  <div className="mt-auto pt-5">
                    {card.id === "llm" ? (
                      <div className="grid grid-cols-[2fr_1fr] gap-3">
                        <Button
                          type="button"
                          onClick={() => void runJob("llm")}
                          disabled={isBusy}
                          className="h-9 bg-[#162B49] text-sm text-white hover:bg-[#1E3A5F]"
                        >
                          {activeOperation?.id === "llm" ? (
                            <>
                              <RefreshCw className="size-3.5 animate-spin" />
                              运行中...
                            </>
                          ) : (
                            "运行 LLM"
                          )}
                        </Button>
                        <Button
                          type="button"
                          onClick={() => void runPublish()}
                          disabled={isBusy}
                          variant="outline"
                          className="h-9 border-[#162B49]/15 text-sm text-[#162B49] hover:bg-[#162B49]/5"
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
                    ) : (
                      <Button
                        type="button"
                        onClick={() => void (card.id === "crawler" ? runJob("scraper") : runAiAnalysis())}
                        disabled={isBusy}
                        className="h-9 w-full bg-[#162B49] text-sm text-white hover:bg-[#1E3A5F]"
                      >
                        {activeOperation?.cardId === card.id ? (
                          <>
                            <RefreshCw className="size-3.5 animate-spin" />
                            运行中...
                          </>
                        ) : card.id === "crawler" ? (
                          "启动爬虫"
                        ) : (
                          "生成分析"
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              </section>
            );
          })}
        </div>

        <AdminTaskProgress progress={progressState} onCancel={activeOperation ? handleCancel : undefined} />

        <div className="mt-6 rounded-xl border border-[#E4E9F0] bg-white p-5">
          <div className="flex items-start gap-3">
            <TerminalSquare className="mt-0.5 size-4 shrink-0 text-[#667085]" />
            <div className="space-y-1 text-xs leading-relaxed text-[#667085]">
              <p>
                <span className="font-medium text-[#172033]">操作说明：</span>
                爬虫与 LLM 继续复用 FastAPI 任务与 SSE；LLM 成功后仅生成候选 CSV，不会直接刷新正式看板。
              </p>
              <p>
                <span className="font-medium text-[#172033]">注意事项：</span>
                推送成功后才会刷新看板数据；关闭日志弹窗或离开页面只会停止前端读取，不会中止后端任务。
              </p>
            </div>
          </div>
        </div>

        <UserApprovalManager />
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
    </div>
  );
}
