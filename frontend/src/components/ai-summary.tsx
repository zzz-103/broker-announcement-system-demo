"use client";

import { useEffect, useState } from "react";
import { AlertCircle, RefreshCw, Sparkles } from "lucide-react";
import {
  BackendApiError,
  generateAiAnalysis,
  getAiAnalysis,
} from "@/lib/api/backend-client";
import { useAuthStore } from "@/store/auth-store";

interface AiSummaryProps {
  className?: string;
}

export function AiSummary({ className = "" }: AiSummaryProps) {
  const [content, setContent] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [emptyMessage, setEmptyMessage] = useState("尚未生成 AI 情报分析");
  const [isLoading, setIsLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const { token, isAdmin, clearAuth } = useAuthStore();

  useEffect(() => {
    if (!token) return;
    setIsLoading(true);
    getAiAnalysis(token)
      .then((data) => {
        const nextContent = data.analysis?.content || data.content || null;
        if (nextContent) {
          setContent(nextContent);
          setUpdatedAt(data.updatedAt || data.meta?.generated_at || null);
          setError(null);
        } else {
          setEmptyMessage("尚未生成 AI 情报分析");
        }
      })
      .catch((err: unknown) => {
        if (err instanceof BackendApiError && err.status === 401) {
          clearAuth("登录已失效，请重新登录");
          return;
        }
        if (err instanceof BackendApiError && err.status === 404) {
          setEmptyMessage("尚未生成 AI 情报分析");
          setError(null);
          return;
        }
        setError(err instanceof Error ? err.message : "加载分析报告失败");
      })
      .finally(() => setIsLoading(false));
  }, [clearAuth, token]);

  const handleGenerate = async () => {
    if (!token || isGenerating) return;
    setIsGenerating(true);
    setError(null);
    try {
      const data = await generateAiAnalysis(token);
      const nextContent = data.analysis?.content || data.content || null;
      if (nextContent) {
        setContent(nextContent);
        setUpdatedAt(data.updatedAt || data.meta?.generated_at || null);
      }
    } catch (err) {
      if (err instanceof BackendApiError && err.status === 401) {
        clearAuth("登录已失效，请重新登录");
        return;
      }
      setError(
        err instanceof BackendApiError && err.status === 403
          ? "仅管理员可以重新生成 AI 情报分析"
          : err instanceof BackendApiError && err.status === 409
            ? "AI 情报分析任务正在运行"
            : err instanceof Error
              ? err.message
              : "AI 情报分析生成失败",
      );
    } finally {
      setIsGenerating(false);
    }
  };

  const formatUpdatedAt = (dateStr: string | null) => {
    if (!dateStr) return null;
    const date = new Date(dateStr);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  };

  return (
    <div className={`relative overflow-hidden rounded-[10px] border border-[#E4E9F0] bg-white ${className}`}>
      <div className="h-[3px] bg-gradient-to-r from-[#2563EB] via-[#7C3AED] to-[#0F9F8F]" />

      <div className="flex items-center justify-between px-5 py-3 border-b border-[#F0F2F5]">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#2563EB] to-[#7C3AED] flex items-center justify-center">
            <Sparkles className="w-3.5 h-3.5 text-white" />
          </div>
          <div>
            <h3 className="text-[15px] font-semibold text-[#172033]">AI 情报分析</h3>
            <p className="text-[11px] text-[#98A2B3]">基于近 30 天公开招采数据智能分析</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {updatedAt && (
            <span className="text-[11px] text-[#98A2B3]">
              更新于 {formatUpdatedAt(updatedAt)}
            </span>
          )}
          {isAdmin && (
            <button
              onClick={handleGenerate}
              disabled={isGenerating}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-[#162B49] text-white text-[12px] disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <RefreshCw className={`w-3 h-3 ${isGenerating ? "animate-spin" : ""}`} />
              {isGenerating ? "生成中" : content ? "重新生成" : "生成分析"}
            </button>
          )}
        </div>
      </div>

      <div className="px-5 py-4">
        {error && (
          <div className="flex items-start gap-2 p-3 mb-3 bg-[#FEF2F2] border border-[#FECACA] rounded-lg">
            <AlertCircle className="w-4 h-4 text-[#D64545] mt-0.5 shrink-0" />
            <p className="text-[13px] text-[#991B1B]">{error}</p>
          </div>
        )}
        {content ? (
          <div className="prose prose-sm max-w-none text-[13px] text-[#374151] leading-relaxed ai-summary-content">
            <MarkdownRenderer content={content} />
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="w-12 h-12 rounded-full bg-[#F5F7FA] flex items-center justify-center mb-3">
              <Sparkles className="w-5 h-5 text-[#98A2B3]" />
            </div>
            <p className="text-[13px] text-[#667085] mb-1">
              {isLoading ? "正在加载 AI 情报分析..." : emptyMessage}
            </p>
            <p className="text-[11px] text-[#98A2B3]">
              管理员可生成基于近 30 天数据的智能情报分析
            </p>
          </div>
        )}
      </div>

      {content && (
        <div className="px-5 py-2.5 bg-[#F8FAFC] border-t border-[#F0F2F5]">
          <p className="text-[11px] text-[#98A2B3]">
            AI 生成 · 仅供参考 · 分析结论基于公开招采数据，不代表行业整体趋势
          </p>
        </div>
      )}
    </div>
  );
}

function MarkdownRenderer({ content }: { content: string }) {
  const lines = content.split("\n");
  const elements: React.ReactNode[] = [];
  let listItems: string[] = [];

  const flushList = () => {
    if (listItems.length > 0) {
      elements.push(
        <ul key={`list-${elements.length}`} className="list-disc pl-5 space-y-1 my-2">
          {listItems.map((item, i) => (
            <li key={i} dangerouslySetInnerHTML={{ __html: formatInline(item) }} />
          ))}
        </ul>,
      );
      listItems = [];
    }
  };

  const formatInline = (text: string): string => {
    return text
      .replace(/\*\*(.+?)\*\*/g, '<strong class="text-[#172033] font-semibold">$1</strong>')
      .replace(/\*(.+?)\*/g, "<em>$1</em>");
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith("## ")) {
      flushList();
      elements.push(
        <h2 key={i} className="text-[15px] font-semibold text-[#172033] mt-4 mb-2 first:mt-0">
          {line.slice(3)}
        </h2>,
      );
    } else if (line.startsWith("### ")) {
      flushList();
      elements.push(
        <h3 key={i} className="text-[14px] font-semibold text-[#172033] mt-3 mb-1.5">
          {line.slice(4)}
        </h3>,
      );
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      listItems.push(line.slice(2));
    } else if (/^\d+\.\s/.test(line)) {
      flushList();
      const match = line.match(/^(\d+)\.\s(.+)/);
      if (match) {
        elements.push(
          <div key={i} className="flex gap-2 my-1">
            <span className="text-[#2563EB] font-medium shrink-0">{match[1]}.</span>
            <span dangerouslySetInnerHTML={{ __html: formatInline(match[2]) }} />
          </div>,
        );
      }
    } else if (line.trim() === "") {
      flushList();
    } else {
      flushList();
      elements.push(
        <p key={i} className="my-1.5" dangerouslySetInnerHTML={{ __html: formatInline(line) }} />,
      );
    }
  }

  flushList();
  return <>{elements}</>;
}
