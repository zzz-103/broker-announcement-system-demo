"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { AdminTaskLogLine } from "@/components/admin-task-log-dialog";
import type { AdminTaskProgressState } from "@/components/admin-task-progress";
import {
  BackendApiError,
  cancelJob,
  generateAiAnalysis,
  getJob,
  publishAnnouncements,
  startJob,
  streamJobEvents,
  type JobEvent,
  type JobResponse,
  type JobStatus,
  type JobType,
} from "@/lib/api/backend-client";
import {
  IDLE_PROGRESS,
  INITIAL_CARD_STATE,
  PROGRESS_RESET_DELAY_MS,
  backendErrorMessage,
  cardIdForJob,
  clearActiveJob,
  isActiveJobStatus,
  isTerminalJobStatus,
  jobSuccessSummary,
  labelForOperation,
  readActiveJob,
  saveActiveJob,
  trimLogs,
  type ActiveOperation,
  type CardId,
  type OperationId,
  type TaskCardState,
} from "./job-runner-model";


interface UseJobRunnerOptions {
  token: string | null;
  clearAuth: (message?: string) => void;
  onDataRefresh?: () => void;
}

interface RunJobOptions {
  mode?: "incremental" | "full_refresh";
  overwrite?: boolean;
}

const POLL_INTERVAL_MS = 2000;
const SSE_FALLBACK_MS = 10_000;

function terminalSummary(jobType: JobType, job: JobResponse, label: string) {
  if (job.status === "succeeded") return jobSuccessSummary(jobType, label);
  if (job.status === "cancelled") return `${label}已手动停止。`;
  return `${label}执行失败${job.error ? `：${job.error}` : "。"}`;
}

function terminalUiStatus(status: JobResponse["status"]): Exclude<JobStatus, "idle" | "running"> {
  if (status === "succeeded") return "succeeded";
  if (status === "cancelled") return "cancelled";
  return "failed";
}

function waitForPoll(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(resolve, POLL_INTERVAL_MS);
    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

export function useJobRunner({
  token,
  clearAuth,
  onDataRefresh,
}: UseJobRunnerOptions) {
  const [cardStates, setCardStates] =
    useState<Record<CardId, TaskCardState>>(INITIAL_CARD_STATE);
  const [progressState, setProgressState] =
    useState<AdminTaskProgressState>(IDLE_PROGRESS);
  const [activeOperation, setActiveOperationState] =
    useState<ActiveOperation | null>(null);

  const mountedRef = useRef(true);
  const activeOperationRef = useRef<ActiveOperation | null>(null);
  const activeControllerRef = useRef<AbortController | null>(null);
  const activeJobIdRef = useRef("");
  const resetTimerRef = useRef<number | null>(null);

  const setActiveOperation = useCallback((operation: ActiveOperation | null) => {
    activeOperationRef.current = operation;
    setActiveOperationState(operation);
  }, []);

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
      activeControllerRef.current?.abort();
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
    [appendLog, clearProgressResetTimer, setActiveOperation, setCardSummary],
  );

  const finalizeTask = useCallback(
    (
      operationId: OperationId,
      resultStatus: Exclude<JobStatus, "idle" | "running">,
      summary: string,
    ) => {
      const active = activeOperationRef.current;
      if (!active || active.id !== operationId) return;
      setCardSummary(active.cardId, resultStatus, summary, active.label);
      setProgressState({
        status: resultStatus,
        taskName: active.label,
        message: summary,
      });
      setActiveOperation(null);
      activeControllerRef.current?.abort();
      activeControllerRef.current = null;
      clearActiveJob(activeJobIdRef.current);
      activeJobIdRef.current = "";
      clearProgressResetTimer();
      resetTimerRef.current = window.setTimeout(() => {
        if (mountedRef.current) setProgressState(IDLE_PROGRESS);
      }, PROGRESS_RESET_DELAY_MS);
    },
    [clearProgressResetTimer, setActiveOperation, setCardSummary],
  );

  const handleUnauthorized = useCallback(() => {
    activeControllerRef.current?.abort();
    clearAuth("登录已失效，请重新登录。");
  }, [clearAuth]);

  const handleJobEvent = useCallback(
    (jobType: JobType, event: JobEvent) => {
      const cardId = cardIdForJob(jobType);
      const label = labelForOperation(jobType);
      if (event.type === "start") {
        const message = event.message || `${label}已开始。`;
        setCardSummary(cardId, "running", message, label);
        setProgressState({ status: "running", taskName: label, message });
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
        const message =
          event.stream === "stdout" &&
          event.message.trim().length > 0 &&
          event.message.length < 60
            ? event.message.trim()
            : "任务正在运行";
        setProgressState((previous) =>
          previous.stage ? previous : { ...previous, message },
        );
        setCardSummary(cardId, "running", message, label);
        return;
      }
      const job = {
        status: event.status,
        error: event.error ?? null,
      } as JobResponse;
      const summary = terminalSummary(jobType, job, label);
      appendLog(
        cardId,
        "system",
        `${label}${event.status === "succeeded" ? "完成" : event.status === "cancelled" ? "已手动停止" : "失败"}，exit_code=${event.exit_code ?? "unknown"}${event.error ? `，${event.error}` : ""}`,
      );
      finalizeTask(jobType, terminalUiStatus(event.status), summary);
    },
    [appendLog, finalizeTask, setCardSummary],
  );

  const monitorJob = useCallback(
    async (
      jobType: JobType,
      jobId: string,
      controller: AbortController,
      initialEvents: JobEvent[] = [],
    ) => {
      const cardId = cardIdForJob(jobType);
      const label = labelForOperation(jobType);
      let lastSequence = 0;
      let receivedBusinessEvent = false;
      let terminalReceived = false;
      let pollingPromise: Promise<void> | null = null;

      const consumeEvent = (event: JobEvent) => {
        const sequence = event.sequence ?? 0;
        if (sequence > 0 && sequence <= lastSequence) return;
        if (sequence > 0) lastSequence = sequence;
        receivedBusinessEvent = true;
        if (event.type === "done") terminalReceived = true;
        handleJobEvent(jobType, event);
      };

      for (const event of initialEvents) consumeEvent(event);
      if (terminalReceived || controller.signal.aborted) return;

      const pollUntilTerminal = async () => {
        while (!controller.signal.aborted && mountedRef.current) {
          try {
            const job = await getJob(jobId, token!);
            for (const event of job.events || []) consumeEvent(event);
            if (isTerminalJobStatus(job.status)) {
              if (!terminalReceived) {
                const summary = terminalSummary(jobType, job, label);
                appendLog(
                  cardId,
                  "system",
                  `轮询检测到任务已结束，状态：${job.status}，日志事件数：${job.log_count ?? "unknown"}`,
                );
                finalizeTask(jobType, terminalUiStatus(job.status), summary);
              }
              return;
            }
            const message = receivedBusinessEvent ? "任务正在运行" : "任务已创建，等待日志";
            setCardSummary(cardId, "running", message, label);
            setProgressState((previous) =>
              previous.message === message ? previous : { ...previous, message },
            );
          } catch (error) {
            if (controller.signal.aborted || !mountedRef.current) return;
            if (error instanceof BackendApiError && error.status === 401) {
              handleUnauthorized();
              return;
            }
            const message =
              error instanceof Error ? error.message : "查询任务状态失败。";
            appendLog(cardId, "system", `轮询查询失败：${message}`);
            finalizeTask(jobType, "failed", `${label}执行失败（状态查询异常）。`);
            return;
          }
          await waitForPoll(controller.signal);
        }
      };

      const ensurePolling = () => {
        if (!pollingPromise && !terminalReceived && !controller.signal.aborted) {
          pollingPromise = pollUntilTerminal();
        }
        return pollingPromise;
      };

      const fallbackTimer = window.setTimeout(() => {
        if (!receivedBusinessEvent && !terminalReceived && !controller.signal.aborted) {
          appendLog(cardId, "system", "SSE 首事件等待超时，启动状态轮询兜底。");
          void ensurePolling();
        }
      }, SSE_FALLBACK_MS);

      try {
        await streamJobEvents(
          jobId,
          token!,
          consumeEvent,
          controller.signal,
          {
            onOpen: (response) => {
              appendLog(
                cardId,
                "system",
                `SSE 已连接，HTTP ${response.status}，Content-Type=${response.headers.get("content-type") || "unknown"}`,
              );
            },
            onParseError: (error) => {
              appendLog(cardId, "system", `忽略一条无法解析的 SSE 事件：${error.message}`);
            },
          },
        );
      } catch (error) {
        if (!controller.signal.aborted && mountedRef.current) {
          appendLog(
            cardId,
            "system",
            `SSE 连接中断：${error instanceof Error ? error.message : "unknown"}；切换状态轮询。`,
          );
        }
      } finally {
        window.clearTimeout(fallbackTimer);
      }

      if (!terminalReceived && !controller.signal.aborted) {
        appendLog(cardId, "system", "SSE 已断开，正在通过状态轮询继续跟踪任务。");
        await ensurePolling();
      } else if (pollingPromise) {
        await pollingPromise;
      }
    },
    [
      appendLog,
      finalizeTask,
      handleJobEvent,
      handleUnauthorized,
      setCardSummary,
      token,
    ],
  );

  const runJob = useCallback(
    async (jobType: JobType, options?: RunJobOptions) => {
      if (activeOperationRef.current) return;
      if (!token) {
        handleUnauthorized();
        return;
      }
      const cardId = cardIdForJob(jobType);
      const initialMessage =
        jobType === "scraper"
          ? "正在连接后端并启动爬虫任务..."
          : jobType === "pipeline"
            ? "正在启动双公告爬取、LLM 结构化与匹配 Pipeline..."
            : jobType === "llm-external"
              ? "正在导入外来公告，输出候选 CSV..."
              : jobType === "app-watch"
                ? "正在启动券商 App 更新采集与 LLM 结构化..."
                : "正在启动双公告 LLM、匹配与汇总...";
      const label = beginOperation(jobType, cardId, initialMessage);
      const controller = new AbortController();
      activeControllerRef.current?.abort();
      activeControllerRef.current = controller;
      try {
        const started = await startJob(jobType, token, options);
        activeJobIdRef.current = started.job_id;
        saveActiveJob(started.job_id, jobType);
        appendLog(cardId, "system", `${label}已启动，job_id=${started.job_id}`);
        setCardSummary(cardId, "running", "任务已创建，等待日志", label);
        setProgressState({
          status: "running",
          taskName: label,
          message: "任务已创建，等待日志",
        });
        await monitorJob(jobType, started.job_id, controller);
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
              : `${label}执行失败。`;
        appendLog(cardId, "system", summary);
        finalizeTask(jobType, "failed", summary);
      }
    },
    [
      appendLog,
      beginOperation,
      finalizeTask,
      handleUnauthorized,
      monitorJob,
      setCardSummary,
      token,
    ],
  );

  useEffect(() => {
    if (!token || activeOperationRef.current) return;
    const stored = readActiveJob();
    if (!stored) return;
    let stopped = false;
    const restore = async () => {
      const jobType = stored.job_type;
      const cardId = cardIdForJob(jobType);
      const label = labelForOperation(jobType);
      try {
        const job = await getJob(stored.job_id, token);
        if (stopped || !mountedRef.current) return;
        if (!isActiveJobStatus(job.status) && !isTerminalJobStatus(job.status)) {
          clearActiveJob(stored.job_id);
          return;
        }
        beginOperation(jobType, cardId, "正在恢复任务状态...");
        activeJobIdRef.current = stored.job_id;
        if (isTerminalJobStatus(job.status)) {
          for (const event of job.events || []) handleJobEvent(jobType, event);
          if (!job.events?.some((event) => event.type === "done")) {
            finalizeTask(
              jobType,
              terminalUiStatus(job.status),
              terminalSummary(jobType, job, label),
            );
          }
          return;
        }
        appendLog(cardId, "system", `已恢复运行中的任务，job_id=${stored.job_id}`);
        const controller = new AbortController();
        activeControllerRef.current = controller;
        await monitorJob(jobType, stored.job_id, controller, job.events || []);
      } catch (error) {
        if (stopped || !mountedRef.current) return;
        if (error instanceof BackendApiError && error.status === 401) {
          handleUnauthorized();
          return;
        }
        clearActiveJob(stored.job_id);
        activeJobIdRef.current = "";
        setActiveOperation(null);
        if (error instanceof BackendApiError && error.status !== 404) {
          appendLog(cardId, "system", `恢复任务失败：${backendErrorMessage(error)}`);
        }
      }
    };
    void restore();
    return () => {
      stopped = true;
    };
  }, [
    appendLog,
    beginOperation,
    finalizeTask,
    handleJobEvent,
    handleUnauthorized,
    monitorJob,
    setActiveOperation,
    token,
  ]);

  const runPublish = useCallback(async () => {
    if (activeOperationRef.current) return;
    if (!token) {
      handleUnauthorized();
      return;
    }
    beginOperation("publish", "llm", "正在校验最终合并表并推送到正式看板...");
    const controller = new AbortController();
    activeControllerRef.current = controller;
    try {
      const result = await publishAnnouncements(token, controller.signal);
      if (controller.signal.aborted || !mountedRef.current) return;
      const backupText = result.meta.backup_file ? `，备份：${result.meta.backup_file}` : "";
      const summary = `推送成功，正式发布 ${result.meta.published_count ?? result.meta.count} 条；staging ${result.meta.staging_count ?? result.meta.source_count ?? "unknown"} 条，false ${result.meta.false_count ?? 0} 条，空值 ${result.meta.empty_count ?? 0} 条${backupText}。`;
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
        error instanceof BackendApiError && error.status === 404
          ? "最终合并表不存在，请先运行完整 Pipeline，再执行推送。"
          : error instanceof BackendApiError
            ? backendErrorMessage(error)
            : error instanceof Error
              ? error.message
              : "推送失败。";
      appendLog("llm", "system", summary);
      finalizeTask("publish", "failed", summary);
    }
  }, [
    appendLog,
    beginOperation,
    finalizeTask,
    handleUnauthorized,
    onDataRefresh,
    token,
  ]);

  const runAiAnalysis = useCallback(async () => {
    if (activeOperationRef.current) return;
    if (!token) {
      handleUnauthorized();
      return;
    }
    beginOperation("ai_analysis", "ai", "正在生成招采分析...");
    const controller = new AbortController();
    activeControllerRef.current = controller;
    try {
      const result = await generateAiAnalysis(token, controller.signal);
      if (controller.signal.aborted || !mountedRef.current) return;
      const summary = `招采分析已生成，样本数 ${result.meta?.source_count ?? 0}。`;
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
            : "招采分析生成失败。";
      appendLog("ai", "system", summary);
      finalizeTask("ai_analysis", "failed", summary);
    }
  }, [appendLog, beginOperation, finalizeTask, handleUnauthorized, token]);

  const cancelActiveJob = useCallback(async () => {
    const active = activeOperationRef.current;
    if (!active || !token || !activeJobIdRef.current) return;
    if (
      !["scraper", "llm", "llm-external", "pipeline", "app-watch"].includes(active.id)
    ) {
      return;
    }
    if (!window.confirm(`确定停止当前${active.label}任务吗？`)) return;
    const jobId = activeJobIdRef.current;
    try {
      await cancelJob(jobId, token);
    } catch (error) {
      appendLog(
        active.cardId,
        "system",
        error instanceof BackendApiError
          ? backendErrorMessage(error)
          : error instanceof Error
            ? error.message
            : "停止任务失败。",
      );
    }
    const summary = `${active.label}已手动停止。`;
    appendLog(active.cardId, "system", summary);
    finalizeTask(active.id, "cancelled", summary);
  }, [appendLog, finalizeTask, token]);

  const stopLocalMonitoring = useCallback(() => {
    activeControllerRef.current?.abort();
    activeControllerRef.current = null;
  }, []);

  return {
    activeOperation,
    cardStates,
    progressState,
    runJob,
    runPublish,
    runAiAnalysis,
    cancelActiveJob,
    stopLocalMonitoring,
  };
}
