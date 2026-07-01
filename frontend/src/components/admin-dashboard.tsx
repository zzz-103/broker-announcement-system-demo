"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuthStore } from "@/store/auth-store";
import {
  BackendApiError,
  getJob,
  JobStatus,
  JobType,
  startJob,
  streamJobEvents,
} from "@/lib/api/backend-client";
import {
  Bot,
  Database,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  LogOut,
  ArrowLeft,
  Sparkles,
  Globe,
  FileText,
  Brain,
} from "lucide-react";

interface DashboardProps {
  onBack: () => void;
  onDataRefresh?: () => void;
}

type TaskId = "crawler" | "llm" | "ai";

const MAX_LOG_LINES = 300;

function trimLog(lines: string[]) {
  return lines.slice(-MAX_LOG_LINES).join("\n");
}

function backendErrorMessage(error: BackendApiError) {
  if (error.status === 0) return "无法连接 FastAPI 后端，请确认 http://localhost:8000 已启动";
  if (error.status === 409) return error.message || "已有任务正在运行，请等待当前任务结束";
  return error.message;
}

export function AdminDashboard({ onBack, onDataRefresh }: DashboardProps) {
  const { username, token, logout, clearAuth } = useAuthStore();

  const [crawlerStatus, setCrawlerStatus] = useState<JobStatus>("idle");
  const [crawlerMsg, setCrawlerMsg] = useState("");
  const [llmStatus, setLlmStatus] = useState<JobStatus>("idle");
  const [llmMsg, setLlmMsg] = useState("");
  const [aiStatus, setAiStatus] = useState<JobStatus>("idle");
  const [aiMsg, setAiMsg] = useState("");

  const abortRefs = useRef<Record<"scraper" | "llm", AbortController | null>>({
    scraper: null,
    llm: null,
  });
  const logRefs = useRef<Record<TaskId, HTMLDivElement | null>>({
    crawler: null,
    llm: null,
    ai: null,
  });
  const mountedRef = useRef(true);

  const appendLog = useCallback((task: "scraper" | "llm", line: string) => {
    const setter = task === "scraper" ? setCrawlerMsg : setLlmMsg;
    setter((prev) => trimLog([...prev.split("\n").filter(Boolean), line]));
  }, []);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      abortRefs.current.scraper?.abort();
      abortRefs.current.llm?.abort();
    };
  }, []);

  useEffect(() => {
    logRefs.current.crawler?.scrollTo(0, logRefs.current.crawler.scrollHeight);
  }, [crawlerMsg]);

  useEffect(() => {
    logRefs.current.llm?.scrollTo(0, logRefs.current.llm.scrollHeight);
  }, [llmMsg]);

  const runJob = useCallback(
    async (jobType: JobType) => {
      const isScraper = jobType === "scraper";
      const status = isScraper ? crawlerStatus : llmStatus;
      const setStatus = isScraper ? setCrawlerStatus : setLlmStatus;
      const setMessage = isScraper ? setCrawlerMsg : setLlmMsg;
      const taskLabel = isScraper ? "爬虫" : "LLM";

      if (status === "running") return;
      if (!token) {
        setStatus("failed");
        setMessage("请先以管理员身份登录");
        return;
      }

      const controller = new AbortController();
      abortRefs.current[jobType]?.abort();
      abortRefs.current[jobType] = controller;
      setStatus("running");
      setMessage(`正在连接 FastAPI 后端并启动${taskLabel}任务...`);

      let jobId = "";
      let doneReceived = false;

      try {
        const started = await startJob(jobType, token);
        jobId = started.job_id;
        appendLog(jobType, `${taskLabel}任务已启动，job_id=${jobId}`);

        await streamJobEvents(
          jobId,
          token,
          (event) => {
            if (!mountedRef.current) return;
            if (event.type === "start") {
              appendLog(jobType, event.message || "任务开始");
              return;
            }
            if (event.type === "log") {
              appendLog(jobType, `[${event.stream}] ${event.message}`);
              return;
            }
            if (event.type === "done") {
              doneReceived = true;
              const succeeded = event.status === "succeeded";
              setStatus(succeeded ? "succeeded" : "failed");
              appendLog(
                jobType,
                succeeded
                  ? `${taskLabel}任务成功结束，exit_code=${event.exit_code}`
                  : `${taskLabel}任务失败，exit_code=${event.exit_code}${event.error ? `，${event.error}` : ""}`,
              );
              if (succeeded && jobType === "llm") onDataRefresh?.();
            }
          },
          controller.signal,
        );

        if (!doneReceived && jobId && !controller.signal.aborted) {
          const job = await getJob(jobId, token);
          if (!mountedRef.current) return;
          const succeeded = job.status === "succeeded";
          setStatus(succeeded ? "succeeded" : "failed");
          appendLog(jobType, `SSE 已断开，最终任务状态：${job.status}`);
          if (succeeded && jobType === "llm") onDataRefresh?.();
        }
      } catch (error) {
        if (controller.signal.aborted || !mountedRef.current) return;

        if (error instanceof BackendApiError && error.status === 401) {
          clearAuth("登录已失效，请重新登录");
          return;
        }

        setStatus("failed");
        setMessage(
          error instanceof BackendApiError
            ? backendErrorMessage(error)
            : error instanceof Error
              ? error.message
              : `${taskLabel}任务运行失败`,
        );
      } finally {
        if (abortRefs.current[jobType] === controller) abortRefs.current[jobType] = null;
      }
    },
    [appendLog, clearAuth, crawlerStatus, llmStatus, onDataRefresh, token],
  );

  const handleLogout = useCallback(() => {
    abortRefs.current.scraper?.abort();
    abortRefs.current.llm?.abort();
    logout();
  }, [logout]);

  const cards = [
    {
      id: "crawler" as const,
      icon: Globe,
      iconBg: "from-emerald-500 to-teal-600",
      title: "一键更新爬虫",
      desc: "启动 FastAPI 后端爬虫任务，实时查看 stdout/stderr 日志",
      status: crawlerStatus,
      message: crawlerMsg,
      action: () => runJob("scraper"),
      actionLabel: "启动爬虫",
      runningLabel: "爬虫运行中...",
      tag: "已接入",
    },
    {
      id: "llm" as const,
      icon: Database,
      iconBg: "from-blue-500 to-indigo-600",
      title: "LLM 数据处理",
      desc: "调用 LLM 结构化处理 Markdown 公告并生成 backend/data 数据",
      status: llmStatus,
      message: llmMsg,
      action: () => runJob("llm"),
      actionLabel: "运行 LLM",
      runningLabel: "LLM 运行中...",
      tag: "已接入",
    },
    {
      id: "ai" as const,
      icon: Brain,
      iconBg: "from-purple-500 to-pink-600",
      title: "AI 情报分析",
      desc: "对近 30 天招采数据进行深度分析，生成情报报告",
      status: aiStatus,
      message: aiMsg,
      action: () => {
        setAiStatus("failed");
        setAiMsg("AI 情报分析不在本阶段接入范围内");
      },
      actionLabel: "生成分析",
      runningLabel: "AI 分析中...",
      tag: "非本阶段",
    },
  ];

  return (
    <div className="min-h-screen bg-[#F5F7FA]">
      <header className="sticky top-0 z-40 bg-[#162B49] text-white">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={onBack}
              className="flex items-center gap-1.5 text-sm text-white/70 hover:text-white transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              返回平台
            </button>
            <div className="w-px h-5 bg-white/20" />
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-400" />
              <span className="text-sm font-medium">管理控制台</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-white/60">{username}</span>
            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 text-xs text-white/60 hover:text-white transition-colors px-2 py-1 rounded hover:bg-white/10"
            >
              <LogOut className="w-3.5 h-3.5" />
              退出
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-[1200px] mx-auto px-4 sm:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-xl font-bold text-[#172033]">管理控制台</h1>
          <p className="text-sm text-[#667085] mt-1">
            管理数据源、处理流程和 AI 分析任务
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {cards.map((card) => (
            <div
              key={card.id}
              className="bg-white rounded-xl border border-[#E4E9F0] shadow-sm overflow-hidden hover:shadow-md transition-shadow"
            >
              <div className="p-5 pb-4">
                <div className="flex items-start justify-between mb-3">
                  <div
                    className={`w-10 h-10 rounded-xl bg-gradient-to-br ${card.iconBg} flex items-center justify-center shadow-sm`}
                  >
                    <card.icon className="w-5 h-5 text-white" />
                  </div>
                  <span
                    className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                      card.tag === "已接入"
                        ? "bg-emerald-50 text-emerald-600"
                        : "bg-amber-50 text-amber-600"
                    }`}
                  >
                    {card.tag}
                  </span>
                </div>
                <h3 className="text-[15px] font-semibold text-[#172033] mb-1">
                  {card.title}
                </h3>
                <p className="text-xs text-[#667085] leading-relaxed">
                  {card.desc}
                </p>
              </div>

              {card.status !== "idle" && (
                <div className="px-5 pb-3">
                  <div
                    ref={(node) => {
                      logRefs.current[card.id] = node;
                    }}
                    className={`flex items-start gap-2 text-xs px-3 py-2 rounded-lg whitespace-pre-wrap break-words ${
                      card.id === "crawler" || card.id === "llm" ? "max-h-56 overflow-y-auto" : ""
                    } ${
                      card.status === "running"
                        ? "bg-blue-50 text-blue-600"
                        : card.status === "succeeded"
                          ? "bg-emerald-50 text-emerald-600"
                          : "bg-red-50 text-red-600"
                    }`}
                  >
                    {card.status === "running" ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin shrink-0 mt-0.5" />
                    ) : card.status === "succeeded" ? (
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    ) : (
                      <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    )}
                    <span>{card.message}</span>
                  </div>
                </div>
              )}

              <div className="px-5 pb-5 pt-1">
                <button
                  onClick={card.action}
                  disabled={card.status === "running"}
                  className={`w-full h-9 rounded-lg text-sm font-medium flex items-center justify-center gap-1.5 transition-all active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed ${
                    card.status === "running"
                      ? "bg-gray-100 text-gray-400"
                      : "bg-[#162B49] text-white hover:bg-[#1e3a5f]"
                  }`}
                >
                  {card.status === "running" ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      {card.runningLabel}
                    </>
                  ) : (
                    <>
                      <Bot className="w-3.5 h-3.5" />
                      {card.actionLabel}
                    </>
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-8 bg-white rounded-xl border border-[#E4E9F0] p-5">
          <div className="flex items-start gap-3">
            <FileText className="w-4 h-4 text-[#667085] mt-0.5 shrink-0" />
            <div className="text-xs text-[#667085] leading-relaxed space-y-1">
              <p>
                <span className="font-medium text-[#172033]">操作说明：</span>
                当前阶段已接入 FastAPI 管理员登录、爬虫启动、LLM 结构化处理和 SSE 实时日志。
              </p>
              <p>
                <span className="font-medium text-[#172033]">注意事项：</span>
                离开页面只会停止前端日志读取，不会取消后端任务；LLM 成功后会刷新看板数据。
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
