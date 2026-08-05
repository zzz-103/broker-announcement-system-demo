"use client";

import { Fragment, useEffect, useState } from "react";
import { AlertCircle, ChevronDown, FileText, RefreshCw } from "lucide-react";
import {
  BackendApiError,
  fetchDashboardAiAnalysis,
  generateAiAnalysis,
} from "@/lib/api/backend-client";
import { useAuthStore } from "@/store/auth-store";

interface AiSummaryProps {
  className?: string;
}

export function AiSummary({ className = "" }: AiSummaryProps) {
  const [content, setContent] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [emptyMessage, setEmptyMessage] = useState("尚未生成招采分析");
  const [isLoading, setIsLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const { token, isAdmin, clearAuth } = useAuthStore();

  useEffect(() => {
    if (!token) return;
    setIsLoading(true);
    fetchDashboardAiAnalysis(token)
      .then((data) => {
        const nextContent = data.content || null;
        if (nextContent) {
          setContent(nextContent);
          setUpdatedAt(data.updated_at || data.meta?.generated_at || null);
          setError(null);
        } else {
          setEmptyMessage("尚未生成招采分析");
        }
      })
      .catch((err: unknown) => {
        if (err instanceof BackendApiError && err.status === 401) {
          clearAuth("登录已失效，请重新登录");
          return;
        }
        if (err instanceof BackendApiError && err.status === 404) {
          setEmptyMessage("尚未生成招采分析");
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
          ? "仅管理员可以重新生成招采分析"
          : err instanceof BackendApiError && err.status === 409
            ? "招采分析任务正在运行"
            : err instanceof Error
              ? err.message
              : "招采分析生成失败",
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
    <section className={`surface-panel relative overflow-hidden ${className}`}>
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#F0F2F5]">
        <div className="flex items-center gap-2.5">
          <div className="flex size-7 items-center justify-center rounded-md bg-[#EEF4FF] text-[#315EA8]">
            <FileText className="size-3.5" />
          </div>
          <div>
            <h3 className="text-[15px] font-bold text-[#172033]">招采分析</h3>
            <p className="text-[11px] text-[#7A8699]">基于近 30 天公开招采数据的分析摘要</p>
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
              className="inline-flex items-center gap-1.5 rounded-md bg-[#102847] px-3 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isGenerating ? "animate-spin" : ""}`} />
              {isGenerating ? "生成中" : content ? "重新生成" : "生成分析"}
            </button>
          )}
        </div>
      </div>

      <div className="px-5 py-5">
        {error && (
          <div className="flex items-start gap-2 p-3 mb-4 bg-[#FEF2F2] border border-[#FECACA] rounded-lg">
            <AlertCircle className="w-4 h-4 text-[#D64545] mt-0.5 shrink-0" />
            <p className="text-[13px] text-[#991B1B]">{error}</p>
          </div>
        )}
        {content ? (
          <div className="max-w-none text-[13px] text-[#374151] leading-relaxed">
            {/* 1. Core Summary Panel */}
            <div className="mb-5 rounded-lg border border-[#E4EAF2] bg-[#F8FAFD] p-4">
              <h4 className="mb-2 flex items-center gap-1 text-[11px] font-bold tracking-wide text-[#315EA8]">
                核心结论
              </h4>
              <div className="text-[13px] text-[#102847] leading-relaxed font-semibold ai-summary-conclusion">
                <SectionContent lines={getCoreConclusion(content).split("\n")} />
              </div>
            </div>

            {/* 2. Detailed Chapters */}
            <MarkdownRenderer content={content} />
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-12 text-center" aria-live="polite">
            <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-[#F5F7FA] text-[#7A8699]">
              <FileText className="size-5" />
            </div>
            <p className="text-[13px] text-[#667085] mb-1 font-semibold">
              {isLoading ? "正在加载招采分析..." : emptyMessage}
            </p>
            <p className="text-[11px] text-[#98A2B3] max-w-xs">
              管理员可生成最新分析，普通用户可查看已发布结果
            </p>
          </div>
        )}
      </div>

      {content && (
        <div className="border-t border-[#F0F2F5] bg-[#F8FAFC] px-5 py-3">
          <p className="text-[11px] text-[#7A8699]">
            自动生成，仅供参考；结论基于公开招采数据，不代表行业整体趋势
          </p>
        </div>
      )}
    </section>
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
    <div className="border-b border-[#EEF2F6] py-3 md:border-0 md:py-0">
      <button
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        className="w-full text-left font-bold text-[14.5px] sm:text-[15px] text-[#102847] flex items-center justify-between outline-none select-none cursor-pointer md:cursor-default md:pointer-events-none group"
      >
        <span className="flex items-center gap-2">
          <span className="hidden h-3.5 w-0.5 rounded bg-[#315EA8] md:inline-block" />
          {title}
        </span>
        <span className={`flex size-5 items-center justify-center rounded-full bg-slate-100 text-[#475467] transition-transform duration-200 motion-reduce:transition-none md:hidden ${isOpen ? "rotate-180" : ""}`}>
          <ChevronDown className="w-3.5 h-3.5" />
        </span>
      </button>
      <div className={`mt-3 md:mt-2.5 ${isOpen ? "block" : "hidden md:block"}`}>
        {children}
      </div>
    </div>
  );
}

function SectionContent({ lines }: { lines: string[] }) {
  const elements: React.ReactNode[] = [];
  let listItems: string[] = [];

  const renderInline = (text: string): React.ReactNode => {
    const parts = text.split(/(\*\*[^*\n]+\*\*|\*[^*\n]+\*)/g);
    return parts.map((part, index) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        return <strong key={index} className="font-bold text-[#102847]">{part.slice(2, -2)}</strong>;
      }
      if (part.startsWith("*") && part.endsWith("*")) {
        return <em key={index}>{part.slice(1, -1)}</em>;
      }
      return <Fragment key={index}>{part}</Fragment>;
    });
  };

  const flushList = () => {
    if (listItems.length > 0) {
      elements.push(
        <ul key={`list-${elements.length}`} className="list-disc pl-5 space-y-2.5 my-2.5 text-[#475467]">
          {listItems.map((item, i) => (
            <li key={i}>{renderInline(item)}</li>
          ))}
        </ul>,
      );
      listItems = [];
    }
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
            <span>{renderInline(match[2])}</span>
          </div>,
        );
      }
    } else if (line.trim() === "") {
      flushList();
    } else {
      flushList();
      elements.push(
        <p key={i} className="my-2 text-[13px] text-[#475467] leading-relaxed">{renderInline(line)}</p>,
      );
    }
  }

  flushList();
  return <>{elements}</>;
}
