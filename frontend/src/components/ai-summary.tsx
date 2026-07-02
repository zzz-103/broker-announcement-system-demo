"use client";

import { useEffect, useState } from "react";
import { AlertCircle, RefreshCw, Sparkles, ChevronDown } from "lucide-react";
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

  const [btnCoords, setBtnCoords] = useState({ x: 0, y: 0 });
  const [btnHovered, setBtnHovered] = useState(false);

  const handleBtnMouseMove = (e: React.MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setBtnCoords({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  };

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

  const getCoreConclusion = (fullContent: string) => {
    const lines = fullContent.split("\n");
    const introLines: string[] = [];
    for (const line of lines) {
      if (line.startsWith("## ")) {
        break;
      }
      if (line.trim() !== "") {
        introLines.push(line);
      }
    }
    if (introLines.length > 0) {
      return introLines.join("\n");
    }
    return lines.slice(0, 3).join("\n");
  };

  return (
    <div className={`relative overflow-hidden rounded-2xl border border-[#E4EAF2] bg-white ${className}`}>
      {/* Very thin top blue-purple-teal gradient line */}
      <div className="h-[3px] bg-gradient-to-r from-[#2563EB] via-[#7C3AED] to-[#14B8A6]" />

      <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#F0F2F5]">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#2563EB] to-[#7C3AED] flex items-center justify-center">
            <Sparkles className="w-3.5 h-3.5 text-white" />
          </div>
          <div>
            <h3 className="text-[15px] font-bold text-[#172033]">AI 情报分析</h3>
            <p className="text-[11px] text-[#98A2B3]">基于近 30 天公开招采数据生成的管理决策摘要</p>
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
              onMouseMove={handleBtnMouseMove}
              onMouseEnter={() => setBtnHovered(true)}
              onMouseLeave={() => setBtnHovered(false)}
              className="relative overflow-hidden inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#102847] text-white text-[12px] font-semibold hover:bg-slate-800 shadow-sm active:scale-[0.98] transition-all disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {btnHovered && !isGenerating && (
                <span
                  className="absolute pointer-events-none rounded-full bg-white/10 blur-md transition-opacity duration-300 pointer-events-none"
                  style={{
                    width: "60px",
                    height: "60px",
                    left: `${btnCoords.x - 30}px`,
                    top: `${btnCoords.y - 30}px`,
                    transform: "translate3d(0, 0, 0)",
                  }}
                />
              )}
              <span className="relative z-10 flex items-center gap-1.5">
                <RefreshCw className={`w-3.5 h-3.5 ${isGenerating ? "animate-spin" : ""}`} />
                {isGenerating ? "生成中" : content ? "重新生成" : "生成分析"}
              </span>
            </button>
          )}
        </div>
      </div>

      <div className="px-5 py-5">
        {error && (
          <div className="flex items-start gap-2 p-3 mb-4 bg-[#FEF2F2] border border-[#FECACA] rounded-xl">
            <AlertCircle className="w-4 h-4 text-[#D64545] mt-0.5 shrink-0" />
            <p className="text-[13px] text-[#991B1B]">{error}</p>
          </div>
        )}
        {content ? (
          <div className="max-w-none text-[13px] text-[#374151] leading-relaxed">
            {/* 1. Core Summary Panel */}
            <div className="bg-gradient-to-br from-blue-50/60 via-indigo-50/40 to-purple-50/20 rounded-2xl border border-blue-100/30 p-4.5 mb-6">
              <h4 className="text-[11px] font-bold text-blue-600 tracking-wider uppercase mb-2 flex items-center gap-1">
                <span>📢</span> 核心结论摘要
              </h4>
              <div className="text-[13px] text-[#102847] leading-relaxed font-semibold ai-summary-conclusion">
                <SectionContent lines={getCoreConclusion(content).split("\n")} />
              </div>
            </div>

            {/* 2. Detailed Chapters */}
            <MarkdownRenderer content={content} />
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="w-12 h-12 rounded-full bg-[#F5F7FA] flex items-center justify-center mb-3">
              <Sparkles className="w-5 h-5 text-[#98A2B3]" />
            </div>
            <p className="text-[13px] text-[#667085] mb-1 font-semibold">
              {isLoading ? "正在加载 AI 情报分析..." : emptyMessage}
            </p>
            <p className="text-[11px] text-[#98A2B3] max-w-xs">
              管理员可生成基于近 30 天数据的智能情报分析
            </p>
          </div>
        )}
      </div>

      {content && (
        <div className="px-5 py-3 bg-[#F8FAFC] border-t border-[#F0F2F5]">
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
  const sections: { title: string; lines: string[] }[] = [];
  let currentSection: { title: string; lines: string[] } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("## ")) {
      if (currentSection) {
        sections.push(currentSection);
      }
      currentSection = { title: line.slice(3).trim(), lines: [] };
    } else if (currentSection) {
      currentSection.lines.push(line);
    }
  }
  if (currentSection) {
    sections.push(currentSection);
  }

  return (
    <div className="space-y-4 md:space-y-6">
      {sections.map((sec, idx) => (
        <ChapterSection key={idx} title={sec.title}>
          <SectionContent lines={sec.lines} />
        </ChapterSection>
      ))}
    </div>
  );
}

interface ChapterSectionProps {
  title: string;
  children: React.ReactNode;
}

function ChapterSection({ title, children }: ChapterSectionProps) {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <div className="border border-[#E4EAF2] md:border-0 rounded-2xl bg-white md:bg-transparent p-4 md:p-0 shadow-[0_1px_3px_rgba(0,0,0,0.02)] md:shadow-none transition-all">
      <button
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        className="w-full text-left font-bold text-[14.5px] sm:text-[15px] text-[#102847] flex items-center justify-between outline-none select-none cursor-pointer md:cursor-default md:pointer-events-none group"
      >
        <span className="flex items-center gap-2">
          <span className="w-[3px] h-3.5 rounded bg-gradient-to-b from-[#2563EB] to-[#7C3AED] hidden md:inline-block" />
          {title}
        </span>
        <span className={`w-5 h-5 flex items-center justify-center rounded-full bg-slate-100 text-[#475467] transition-transform duration-200 md:hidden ${isOpen ? "rotate-180" : ""}`}>
          <ChevronDown className="w-3.5 h-3.5" />
        </span>
      </button>
      <div className={`mt-3 md:mt-2.5 transition-all duration-200 ${isOpen ? "block" : "hidden md:block"}`}>
        {children}
      </div>
    </div>
  );
}

function SectionContent({ lines }: { lines: string[] }) {
  const elements: React.ReactNode[] = [];
  let listItems: string[] = [];

  const flushList = () => {
    if (listItems.length > 0) {
      elements.push(
        <ul key={`list-${elements.length}`} className="list-disc pl-5 space-y-2.5 my-2.5 text-[#475467]">
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
      .replace(/\*\*(.+?)\*\*/g, '<strong class="text-[#102847] font-bold">$1</strong>')
      .replace(/\*(.+?)\*/g, "<em>$1</em>");
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith("### ")) {
      flushList();
      elements.push(
        <h3 key={i} className="text-[13px] sm:text-[13.5px] font-bold text-[#102847] mt-3.5 mb-1.5 flex items-center gap-1.5 first:mt-0">
          <span className="w-1 h-1 rounded-full bg-[#2563EB]" />
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
          <div key={i} className="flex gap-2 my-2 text-[13px] text-[#475467] leading-relaxed">
            <span className="text-[#2563EB] font-bold shrink-0">{match[1]}.</span>
            <span dangerouslySetInnerHTML={{ __html: formatInline(match[2]) }} />
          </div>,
        );
      }
    } else if (line.trim() === "") {
      flushList();
    } else {
      flushList();
      elements.push(
        <p key={i} className="my-2 text-[13px] text-[#475467] leading-relaxed" dangerouslySetInnerHTML={{ __html: formatInline(line) }} />,
      );
    }
  }

  flushList();
  return <>{elements}</>;
}
