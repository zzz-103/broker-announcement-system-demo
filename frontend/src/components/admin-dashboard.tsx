"use client";

import { useState, useRef, useCallback } from "react";
import { useAuthStore } from "@/store/auth-store";
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
}

export function AdminDashboard({ onBack }: DashboardProps) {
  const { username, logout } = useAuthStore();

  // Crawler state
  const [crawlerStatus, setCrawlerStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [crawlerMsg, setCrawlerMsg] = useState("");

  // Data processing state
  const [processStatus, setProcessStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [processMsg, setProcessMsg] = useState("");

  // AI analysis state
  const [aiStatus, setAiStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [aiMsg, setAiMsg] = useState("");
  const aiAbortRef = useRef<AbortController | null>(null);

  const handleCrawler = useCallback(async () => {
    setCrawlerStatus("running");
    setCrawlerMsg("正在启动爬虫任务...");
    // Placeholder - simulate running
    await new Promise((r) => setTimeout(r, 2000));
    setCrawlerStatus("done");
    setCrawlerMsg("爬虫任务已完成（功能待接入）");
  }, []);

  const handleProcess = useCallback(async () => {
    setProcessStatus("running");
    setProcessMsg("正在调用 LLM 处理原始数据...");
    // Placeholder - simulate running
    await new Promise((r) => setTimeout(r, 2000));
    setProcessStatus("done");
    setProcessMsg("数据处理已完成（功能待接入）");
  }, []);

  const handleAiAnalysis = useCallback(async () => {
    setAiStatus("running");
    setAiMsg("正在调用 LLM 生成情报分析...");
    aiAbortRef.current = new AbortController();

    try {
      const token = btoa(`${username}:admin2026`);
      const res = await fetch("/api/ai-analysis", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${token}`,
        },
        signal: aiAbortRef.current.signal,
      });

      if (!res.ok) {
        throw new Error("分析失败");
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let fullContent = "";

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n");
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.content) {
                  fullContent += data.content;
                }
                if (data.error) {
                  throw new Error(data.error);
                }
              } catch {
                // skip parse errors
              }
            }
          }
        }
      }

      setAiStatus("done");
      setAiMsg(`AI 情报分析已完成，共生成 ${fullContent.length} 字分析报告`);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        setAiStatus("idle");
        setAiMsg("");
      } else {
        setAiStatus("error");
        setAiMsg("AI 分析失败，请重试");
      }
    }
  }, [username]);

  const handleLogout = useCallback(() => {
    logout();
  }, [logout]);

  const cards = [
    {
      id: "crawler",
      icon: Globe,
      iconBg: "from-emerald-500 to-teal-600",
      title: "一键更新爬虫",
      desc: "启动爬虫任务，自动抓取最新公开招采公告数据",
      status: crawlerStatus,
      message: crawlerMsg,
      action: handleCrawler,
      actionLabel: "启动爬虫",
      runningLabel: "爬虫运行中...",
      tag: "待接入",
    },
    {
      id: "process",
      icon: Database,
      iconBg: "from-blue-500 to-indigo-600",
      title: "LLM 数据处理",
      desc: "调用 LLM 对原始表数据进行清洗、标准化和分类处理",
      status: processStatus,
      message: processMsg,
      action: handleProcess,
      actionLabel: "开始处理",
      runningLabel: "数据处理中...",
      tag: "待接入",
    },
    {
      id: "ai",
      icon: Brain,
      iconBg: "from-purple-500 to-pink-600",
      title: "AI 情报分析",
      desc: "调用 LLM 对近30天招采数据进行深度分析，生成情报报告",
      status: aiStatus,
      message: aiMsg,
      action: handleAiAnalysis,
      actionLabel: "生成分析",
      runningLabel: "AI 分析中...",
      tag: "已上线",
    },
  ];

  return (
    <div className="min-h-screen bg-[#F5F7FA]">
      {/* Header */}
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
            <span className="text-xs text-white/60">
              {username}
            </span>
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

      {/* Content */}
      <main className="max-w-[1200px] mx-auto px-4 sm:px-8 py-8">
        {/* Title */}
        <div className="mb-8">
          <h1 className="text-xl font-bold text-[#172033]">管理控制台</h1>
          <p className="text-sm text-[#667085] mt-1">
            管理数据源、处理流程和 AI 分析任务
          </p>
        </div>

        {/* Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {cards.map((card) => (
            <div
              key={card.id}
              className="bg-white rounded-xl border border-[#E4E9F0] shadow-sm overflow-hidden hover:shadow-md transition-shadow"
            >
              {/* Card Header */}
              <div className="p-5 pb-4">
                <div className="flex items-start justify-between mb-3">
                  <div
                    className={`w-10 h-10 rounded-xl bg-gradient-to-br ${card.iconBg} flex items-center justify-center shadow-sm`}
                  >
                    <card.icon className="w-5 h-5 text-white" />
                  </div>
                  <span
                    className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                      card.tag === "已上线"
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

              {/* Status */}
              {card.status !== "idle" && (
                <div className="px-5 pb-3">
                  <div
                    className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg ${
                      card.status === "running"
                        ? "bg-blue-50 text-blue-600"
                        : card.status === "done"
                        ? "bg-emerald-50 text-emerald-600"
                        : "bg-red-50 text-red-600"
                    }`}
                  >
                    {card.status === "running" ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : card.status === "done" ? (
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    ) : (
                      <AlertCircle className="w-3.5 h-3.5" />
                    )}
                    {card.message}
                  </div>
                </div>
              )}

              {/* Action */}
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

        {/* Info */}
        <div className="mt-8 bg-white rounded-xl border border-[#E4E9F0] p-5">
          <div className="flex items-start gap-3">
            <FileText className="w-4 h-4 text-[#667085] mt-0.5 shrink-0" />
            <div className="text-xs text-[#667085] leading-relaxed space-y-1">
              <p>
                <span className="font-medium text-[#172033]">操作说明：</span>
                所有任务执行完成后，情报总览页面的数据将自动更新。AI
                情报分析报告将保存至服务端，所有用户均可查看。
              </p>
              <p>
                <span className="font-medium text-[#172033]">注意事项：</span>
                爬虫和数据处理的执行时间取决于数据量，请耐心等待任务完成。AI
                分析通常需要 15-30 秒。
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
