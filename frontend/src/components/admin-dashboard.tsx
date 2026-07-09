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
const ACTIVE_JOB_STORAGE_KEY = "broker-admin-active-job";

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
    return "无法连接后端 API，请确认 FastAPI 或 Nginx 网关已启动。";
  }
  return error.message;
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
  if (status === "failed" || status === "cancelled") return <AlertCircle className="size-3.5" />;
  return <TerminalSquare className="size-3.5" />;
}

function isActiveJobStatus(status: string) {
  return status === "pending" || status === "running";
}

function isTerminalJobStatus(status: string) {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

function jobSuccessSummary(jobType: JobType, label: string): string {
  if (jobType === "llm") {
    return "LLM 处理完成，候选数据已生成，请点击\u2018推送\u2019更新正式看板。";
  }
  return `${label}已完成。`;
}

function saveActiveJob(jobId: string, jobType: JobType) {
  sessionStorage.setItem(ACTIVE_JOB_STORAGE_KEY, JSON.stringify({ job_id: jobId, job_type: jobType }));
}

function readActiveJob(): { job_id: string; job_type: JobType } | null {
  try {
    const raw = sessionStorage.getItem(ACTIVE_JOB_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { job_id?: unknown; job_type?: unknown };
    if (
      typeof parsed.job_id === "string" &&
      (parsed.job_type === "scraper" || parsed.job_type === "llm")
    ) {
      return { job_id: parsed.job_id, job_type: parsed.job_type };
    }
  } catch {
    // ignore invalid stored state
  }
  return null;
}

function clearActiveJob(jobId?: string) {
  const stored = readActiveJob();
  if (!jobId || stored?.job_id === jobId) {
    sessionStorage.removeItem(ACTIVE_JOB_STORAGE_KEY);
  }
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
  const streamingJobIdRef = useRef<string>("");
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
    mountedRef.current = true;
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
        clearActiveJob(currentJobIdRef.current);
        currentJobIdRef.current = "";
        streamingJobIdRef.current = "";
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
      const cancelled = event.status === "cancelled";
      const summary = succeeded
        ? jobSuccessSummary(jobType, label)
        : cancelled
          ? `${label}已手动停止。`
        : `${label}执行失败${event.error ? `：${event.error}` : "。"} `;
      appendLog(
        cardId,
        "system",
        succeeded
          ? `${label}完成，exit_code=${event.exit_code ?? "unknown"}`
          : cancelled
            ? `${label}已手动停止`
          : `${label}失败，exit_code=${event.exit_code ?? "unknown"}${event.error ? `，${event.error}` : ""}`,
      );
      finalizeTask(jobType, succeeded ? "succeeded" : cancelled ? "cancelled" : "failed", summary.trim());
    },
    [appendLog, finalizeTask, setCardSummary],
  );

  const runJob = useCallback(
    async (jobType: JobType, options?: { mode?: "incremental" | "full_refresh"; overwrite?: boolean }) => {
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
      let hasReceivedChunk = false;
      let lastHandledSequence = 0;
      let connectionTimeout: NodeJS.Timeout | null = null;

      const stopPolling = () => {
        if (pollingTimerRef.current[jobType]) {
          clearInterval(pollingTimerRef.current[jobType]!);
          pollingTimerRef.current[jobType] = null;
        }
      };

      const startPolling = () => {
        if (pollingTimerRef.current[jobType]) return;
        pollingTimerRef.current[jobType] = setInterval(async () => {
          try {
            const job = await getJob(jobId, token);
            if (!mountedRef.current) {
              stopPolling();
              return;
            }
            for (const event of job.events || []) {
              const sequence = event.sequence ?? 0;
              if (sequence > 0 && sequence <= lastHandledSequence) continue;
              if (sequence > 0) lastHandledSequence = sequence;
              hasReceivedEvents = true;
              if (event.type === "done") {
                doneReceived = true;
              }
              handleJobEvent(jobType, event);
            }
            if (job.status === "running") {
              const waitingForLogs = !hasReceivedEvents;
              const message = waitingForLogs ? "任务已创建，等待日志" : "任务正在运行";
              setProgressState((prev) => {
                if (prev.message === message) return prev;
                return { ...prev, message };
              });
              setCardSummary(cardId, "running", message, label);
            } else if (isTerminalJobStatus(job.status)) {
              const succeeded = job.status === "succeeded";
              const cancelled = job.status === "cancelled";
              const summary = succeeded
                ? jobSuccessSummary(jobType, label)
                : cancelled
                  ? `${label}已手动停止。`
                : `${label}执行失败${job.error ? `：${job.error}` : "。"}`;
              appendLog(
                cardId,
                "system",
                `轮询检测到任务已结束，状态：${job.status}，日志事件数：${job.log_count ?? "unknown"}`,
              );
              finalizeTask(jobType, succeeded ? "succeeded" : cancelled ? "cancelled" : "failed", summary);
            }
          } catch (pollError) {
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
        const started = await startJob(jobType, token, options);
        jobId = started.job_id;
        currentJobIdRef.current = jobId;
        saveActiveJob(jobId, jobType);
        appendLog(cardId, "system", `${label}已启动，job_id=${jobId}`);

        // Job has been created; logs may still be waiting on the SSE stream.
        setCardSummary(cardId, "running", "任务已创建，等待日志", label);
        setProgressState({
          status: "running",
          taskName: label,
          message: "任务已创建，等待日志",
        });

        // Start connection timeout (10s)
        connectionTimeout = setTimeout(() => {
          if (!hasReceivedEvents && !doneReceived && !controller.signal.aborted) {
            const message = hasReceivedChunk
              ? "已收到 SSE 数据，等待任务日志..."
              : "SSE 首事件等待超时，正在确认任务状态...";
            appendLog(cardId, "system", `${message} 启动轮询兜底。`);
            setCardSummary(cardId, "running", "任务已创建，等待日志", label);
            setProgressState((prev) => ({ ...prev, message: "任务已创建，等待日志" }));
            startPolling();
          }
        }, 10000);

        streamingJobIdRef.current = jobId;
        await streamJobEvents(
          jobId,
          token,
          (event) => {
            if (!mountedRef.current) return;
            hasReceivedEvents = true;
            if (event.sequence && event.sequence > lastHandledSequence) {
              lastHandledSequence = event.sequence;
            }
            if (event.type === "done") {
              doneReceived = true;
            }
            handleJobEvent(jobType, event);
          },
          controller.signal,
          {
            onOpen: (response) => {
              appendLog(
                cardId,
                "system",
                `SSE 已连接，HTTP ${response.status}，Content-Type=${response.headers.get("content-type") || "unknown"}`,
              );
            },
            onChunk: () => {
              hasReceivedChunk = true;
            },
            onParseError: (error) => {
              appendLog(cardId, "system", `忽略一条无法解析的 SSE 事件：${error.message}`);
            },
          },
        );

        if (!doneReceived && jobId && !controller.signal.aborted) {
          const job = await getJob(jobId, token);
          if (!mountedRef.current) return;
          if (isTerminalJobStatus(job.status)) {
            const succeeded = job.status === "succeeded";
            const cancelled = job.status === "cancelled";
            const summary = succeeded
              ? jobSuccessSummary(jobType, label)
              : cancelled
                ? `${label}已手动停止。`
              : `${label}执行失败${job.error ? `：${job.error}` : "。"}`;
            appendLog(cardId, "system", `SSE 已断开，直接查询任务状态为终态：${job.status}`);
            finalizeTask(jobType, succeeded ? "succeeded" : cancelled ? "cancelled" : "failed", summary);
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
            const job = await getJob(jobId, token);
            if (isTerminalJobStatus(job.status)) {
              const succeeded = job.status === "succeeded";
              const cancelled = job.status === "cancelled";
              const summary = succeeded
                ? jobSuccessSummary(jobType, label)
                : cancelled
                  ? `${label}已手动停止。`
                : `${label}执行失败${job.error ? `：${job.error}` : "。"}`;
              finalizeTask(jobType, succeeded ? "succeeded" : cancelled ? "cancelled" : "failed", summary);
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
        if (streamingJobIdRef.current === jobId) {
          streamingJobIdRef.current = "";
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

  const runFullRefresh = useCallback(async () => {
    const confirmed = window.confirm(
      "确认执行 LLM 全量重建？该操作会重新请求全部 Markdown，并覆盖已有 raw_json 缓存。普通增量任务不受影响。",
    );
    if (!confirmed) return;
    await runJob("llm", { mode: "full_refresh", overwrite: true });
  }, [runJob]);

  useEffect(() => {
    if (!token || activeOperationRef.current) return;
    const storedJob = readActiveJob();
    if (!storedJob) return;
    if (streamingJobIdRef.current === storedJob.job_id) return;

    let stopped = false;
    const jobType = storedJob.job_type;
    const cardId = cardIdForJob(jobType);
    const label = labelForOperation(jobType);

    const restoreJob = async () => {
      try {
        const job = await getJob(storedJob.job_id, token);
        if (stopped || !mountedRef.current) return;

        if (!isActiveJobStatus(job.status) && !isTerminalJobStatus(job.status)) {
          clearActiveJob(storedJob.job_id);
          return;
        }

        clearProgressResetTimer();
        setActiveOperation({ id: jobType, cardId, label });
        currentJobIdRef.current = storedJob.job_id;
        setCardSummary(cardId, job.status === "pending" ? "running" : job.status, "正在恢复任务状态...", label);
        setProgressState({
          status: isActiveJobStatus(job.status) ? "running" : job.status,
          taskName: label,
          message: isActiveJobStatus(job.status) ? "正在恢复任务日志..." : "任务已结束",
        });

        let lastHandledSequence = 0;
        for (const event of job.events || []) {
          const sequence = event.sequence ?? 0;
          if (sequence > 0) lastHandledSequence = Math.max(lastHandledSequence, sequence);
          handleJobEvent(jobType, event);
        }

        if (isTerminalJobStatus(job.status)) {
          clearActiveJob(storedJob.job_id);
          if (!job.events?.some((event) => event.type === "done")) {
            const succeeded = job.status === "succeeded";
            const cancelled = job.status === "cancelled";
            const summary = succeeded
              ? jobSuccessSummary(jobType, label)
              : cancelled
                ? `${label}已手动停止。`
                : `${label}执行失败${job.error ? `：${job.error}` : "。"}`;
            finalizeTask(jobType, succeeded ? "succeeded" : cancelled ? "cancelled" : "failed", summary);
          }
          return;
        }

        appendLog(cardId, "system", `已恢复运行中的任务，job_id=${storedJob.job_id}`);
        saveActiveJob(storedJob.job_id, jobType);
        const controller = new AbortController();
        abortRefs.current[jobType]?.abort();
        abortRefs.current[jobType] = controller;
        streamingJobIdRef.current = storedJob.job_id;

        await streamJobEvents(
          storedJob.job_id,
          token,
          (event) => {
            if (!mountedRef.current || stopped) return;
            const sequence = event.sequence ?? 0;
            if (sequence > 0 && sequence <= lastHandledSequence) return;
            if (sequence > 0) lastHandledSequence = sequence;
            handleJobEvent(jobType, event);
          },
          controller.signal,
          {
            onOpen: (response) => {
              appendLog(
                cardId,
                "system",
                `SSE 已重新连接，HTTP ${response.status}，Content-Type=${response.headers.get("content-type") || "unknown"}`,
              );
            },
            onParseError: (error) => {
              appendLog(cardId, "system", `忽略一条无法解析的 SSE 事件：${error.message}`);
            },
          },
        );

        if (!controller.signal.aborted && !stopped) {
          const latest = await getJob(storedJob.job_id, token);
          if (isTerminalJobStatus(latest.status)) {
            const succeeded = latest.status === "succeeded";
            const cancelled = latest.status === "cancelled";
            const summary = succeeded
              ? jobSuccessSummary(jobType, label)
              : cancelled
                ? `${label}已手动停止。`
                : `${label}执行失败${latest.error ? `：${latest.error}` : "。"}`;
            finalizeTask(jobType, succeeded ? "succeeded" : cancelled ? "cancelled" : "failed", summary);
          }
        }
      } catch (error) {
        if (stopped || !mountedRef.current) return;
        if (error instanceof BackendApiError && error.status === 401) {
          handleUnauthorized();
          return;
        }
        clearActiveJob(storedJob.job_id);
        currentJobIdRef.current = "";
        streamingJobIdRef.current = "";
        setActiveOperation(null);
        if (error instanceof BackendApiError && error.status !== 404) {
          appendLog(cardId, "system", `恢复任务失败：${backendErrorMessage(error)}`);
        }
      } finally {
        if (abortRefs.current[jobType]?.signal.aborted) {
          abortRefs.current[jobType] = null;
        }
        if (streamingJobIdRef.current === storedJob.job_id && stopped) {
          streamingJobIdRef.current = "";
        }
      }
    };

    void restoreJob();

    return () => {
      stopped = true;
    };
  }, [
    appendLog,
    clearProgressResetTimer,
    finalizeTask,
    handleJobEvent,
    handleUnauthorized,
    setActiveOperation,
    setCardSummary,
    token,
  ]);

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
      {
        const backupText = result.meta.backup_file ? `，备份：${result.meta.backup_file}` : "";
        const summary = `推送成功，正式发布 ${result.meta.published_count ?? result.meta.count} 条；staging ${result.meta.staging_count ?? result.meta.source_count ?? "unknown"} 条，false ${result.meta.false_count ?? 0} 条，空值 ${result.meta.empty_count ?? 0} 条${backupText}。`;
        appendLog("llm", "system", summary);
        finalizeTask("publish", "succeeded", summary);
        onDataRefresh?.();
        return;
      }
      const summary = `推送成功，正式看板数据已更新（${result.meta.count} 条记录）。`;
      appendLog("llm", "system", summary);
      finalizeTask("publish", "succeeded", summary);
      onDataRefresh?.();
    } catch (error) {
      if (controller.signal.aborted || !mountedRef.current) return;
      if (error instanceof BackendApiError && error.status === 401) {
        handleUnauthorized();
        return;
      }
      let summary: string;
      if (error instanceof BackendApiError && error.status === 404) {
        summary = "候选数据文件不存在，请先运行 LLM 生成候选 CSV，再执行推送。";
      } else if (error instanceof BackendApiError) {
        summary = backendErrorMessage(error);
      } else if (error instanceof Error) {
        summary = error.message;
      } else {
        summary = "推送失败。";
      }
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
    if (op.id !== "scraper" && op.id !== "llm") return;
    if (!window.confirm(`确定停止当前${op.label}任务吗？`)) return;

    const jobId = currentJobIdRef.current;
    if (jobId) {
      try {
        await cancelJob(jobId, token);
        for (let attempt = 0; attempt < 10; attempt += 1) {
          const job = await getJob(jobId, token);
          if (isTerminalJobStatus(job.status)) break;
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      } catch (error) {
        const message =
          error instanceof BackendApiError
            ? backendErrorMessage(error)
            : error instanceof Error
              ? error.message
              : "停止任务失败。";
        appendLog(op.cardId, "system", message);
      }
    }

    abortRefs.current[op.id]?.abort();
    clearActiveJob(jobId);
    if (mountedRef.current) {
      const summary = `${op.label}已手动停止。`;
      appendLog(op.cardId, "system", summary);
      finalizeTask(op.id, "cancelled", summary);
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

        <div className="grid grid-cols-1 items-stretch gap-5 md:grid-cols-3">
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
                          onClick={() => void runJob("llm")}
                          disabled={isBusy}
                          className="h-10 text-xs font-semibold text-white bg-gradient-to-r from-[#162B49] to-[#2563EB] hover:from-[#1e3a5f] hover:to-[#3b82f6] shadow-sm flex-[7] flex items-center justify-center gap-1.5"
                        >
                          {activeOperation?.id === "llm" ? (
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
                    ) : (
                      <GlowButton
                        onClick={() => void (card.id === "crawler" ? runJob("scraper") : runAiAnalysis())}
                        disabled={isBusy}
                        className="h-10 w-full text-xs font-semibold text-white bg-gradient-to-r from-[#162B49] to-[#2563EB] hover:from-[#1e3a5f] hover:to-[#3b82f6] shadow-sm flex items-center justify-center gap-1.5"
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
            activeOperation?.id === "scraper" || activeOperation?.id === "llm"
              ? handleCancel
              : undefined
          }
        />

        <div className="mt-6 rounded-xl border border-blue-100 bg-blue-50/50 p-4">
          <div className="flex items-center gap-3">
            <AlertCircle className="size-4 shrink-0 text-blue-600" />
            <div className="text-xs text-blue-800 flex flex-wrap gap-x-6 gap-y-1 leading-relaxed">
              <p>
                <span className="font-semibold text-blue-900">操作说明：</span>
                爬虫与 LLM 任务执行中；LLM 成功后仅生成候选 CSV，不会直接刷新正式看板。
              </p>
              <p>
                <span className="font-semibold text-blue-900">注意事项：</span>
                推送成功后才会刷新看板数据；关闭日志弹窗不会中止后端任务。
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
