"use client";

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";

export function AiSummary() {
  const [content, setContent] = useState("");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    fetch("/data/ai-analysis.json", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("AI 摘要文件不存在");
        return response.json() as Promise<{ content?: string; updatedAt?: string; analysis?: { content?: string } }>;
      })
      .then((data) => { setContent(data.analysis?.content || data.content || ""); setUpdatedAt(data.updatedAt || null); })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "AI 摘要加载失败"));
  }, []);
  return <section className="overflow-hidden rounded-2xl border border-[#E4EAF2] bg-white"><div className="h-[3px] bg-gradient-to-r from-[#2563EB] via-[#7C3AED] to-[#14B8A6]" /><div className="flex items-center justify-between border-b border-[#F0F2F5] px-5 py-4"><div className="flex items-center gap-2.5"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-[#2563EB] to-[#7C3AED]"><Sparkles className="h-4 w-4 text-white" /></span><div><h3 className="font-bold text-[#172033]">AI 情报分析</h3><p className="text-[11px] text-[#98A2B3]">静态展示本地生成的分析报告</p></div></div>{updatedAt && <span className="text-[11px] text-[#98A2B3]">更新于 {new Date(updatedAt).toLocaleString("zh-CN")}</span>}</div><div className="px-5 py-5">{error ? <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p> : content ? <div className="space-y-2 text-[13px] leading-relaxed text-[#374151]">{content.split("\n").map((line, index) => <p key={String(index) + line} className={line.startsWith("#") ? "font-bold text-[#102847]" : ""}>{line || "\u00a0"}</p>)}</div> : <p className="text-sm text-[#667085]">尚未提供 AI 情报分析。</p>}</div></section>;
}
