"use client";

import { ExternalLink } from "lucide-react";
import type { ReactNode } from "react";
import type {
  IntelligenceAssistantExecution,
  IntelligenceReportItem,
  IntelligenceReportV2,
  IntelligenceSource,
} from "@/lib/api/contracts";
import {
  AUDIENCE_LABEL,
  REPORT_HEADING_CLASS,
  REPORT_LENGTH_LABEL,
  REPORT_PROSE_CLASS,
  TIME_RANGE_LABEL,
} from "./custom-intelligence-constants";

function safeUrl(value: string): string | null {
  return /^https?:\/\/[^\s]+$/i.test(value.trim()) ? value.trim() : null;
}

export function SourceCard({ source, index }: { source: IntelligenceSource; index: number }) {
  const url = safeUrl(source.url);
  return (
    <article className="border-b border-[#E4E7EC] py-3 last:border-b-0">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-0.5 shrink-0 font-mono text-[11px] font-semibold text-[#315EA8]">[{index}]</span>
          <div className="min-w-0">
            <h4 className="min-w-0 break-words text-sm font-semibold leading-6 text-[#243B61]">{source.title || "未命名来源"}</h4>
            <p className="mt-0.5 text-[11px] leading-5 text-[#667085]">{source.site_name || "公开来源"}{source.date ? ` · ${source.date}` : ""}</p>
          </div>
        </div>
        {url ? (
          <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-[#315EA8] underline-offset-2 hover:underline">
            <ExternalLink className="size-3.5" aria-hidden="true" />打开原文
          </a>
        ) : <span className="shrink-0 text-[10px] text-[#98A2B3]">链接不可用</span>}
      </div>
      {source.snippet && (
        <details className="mt-2 text-[11px] text-[#667085]">
          <summary className="cursor-pointer select-none font-medium text-[#667085]">查看来源摘要</summary>
          <p className="mt-1.5 whitespace-pre-wrap break-words text-[12px] leading-5">{source.snippet}</p>
        </details>
      )}
    </article>
  );
}

function isReportV2(report: IntelligenceAssistantExecution["report"]): report is IntelligenceReportV2 {
  return Boolean(report && typeof report === "object" && (report as { version?: unknown }).version === 2);
}

function itemList(value: unknown): IntelligenceReportItem[] {
  if (typeof value === "string" && value.trim()) return [{ type: "analysis", text: value.trim() }];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is IntelligenceReportItem => {
    if (!item || typeof item !== "object") return false;
    const candidate = item as Partial<IntelligenceReportItem>;
    return (candidate.type === "fact" || candidate.type === "analysis" || candidate.type === "recommendation") && typeof candidate.text === "string" && Boolean(candidate.text.trim());
  });
}

function SourceRefs({ ids, sourceIndexes }: { ids?: string[]; sourceIndexes: Map<string, number> }) {
  if (!ids?.length) return null;
  return (
    <span className="ml-1 inline-flex flex-wrap gap-1 align-middle">
      {ids.map((id) => sourceIndexes.has(id) ? (
        <a key={id} href={`#assistant-source-${id}`} className="font-mono text-[10px] font-semibold text-[#315EA8] hover:underline">[{sourceIndexes.get(id)}]</a>
      ) : <span key={id} className="text-[10px] text-slate-500">[来源未匹配]</span>)}
    </span>
  );
}

function ItemList({ items, sourceIndexes }: { items: IntelligenceReportItem[]; sourceIndexes: Map<string, number> }) {
  if (!items.length) return <p className="text-sm text-[#98A2B3]">暂无内容。</p>;
  return (
    <div className="divide-y divide-[#EAECF0]">
      {items.map((item, index) => (
        <div key={`${item.text}-${index}`} className={`flex gap-3 py-3 first:pt-1 ${item.type === "recommendation" ? "border-l-2 border-l-[#7FA3DF] pl-3" : ""}`}>
          <span className="mt-0.5 shrink-0 font-mono text-[11px] text-[#98A2B3]">{String(index + 1).padStart(2, "0")}</span>
          <p className="min-w-0 whitespace-pre-wrap break-words text-sm leading-6 text-[#344054]">
            <span className={`mr-1.5 text-[10px] font-semibold ${item.type === "recommendation" ? "text-[#315EA8]" : item.type === "fact" ? "text-emerald-700" : "text-[#667085]"}`}>
              {item.type === "recommendation" ? "建议" : item.type === "fact" ? "事实" : "分析"}
            </span>
            {item.text}
            <SourceRefs ids={item.source_ids} sourceIndexes={sourceIndexes} />
          </p>
        </div>
      ))}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section><h3 className={REPORT_HEADING_CLASS}>{title}</h3>{children}</section>;
}

export function ReportBody({ execution }: { execution: IntelligenceAssistantExecution }) {
  const report = execution.report;
  const sources = execution.sources ?? [];
  const sourceIndexes = new Map(sources.map((source, index) => [source.id, index + 1]));
  if (!report) return <p className="text-sm text-[#667085]">暂无报告内容。</p>;
  if (!isReportV2(report)) {
    const legacy = report as { core_conclusion?: string; title?: string };
    return (
      <div className="space-y-5">
        <div role="status" className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2.5 text-xs leading-5 text-amber-800">这是一份旧版报告，建议再次生成以使用新版结构。</div>
        <Section title={legacy.title || "核心结论"}><p className={REPORT_PROSE_CLASS}>{legacy.core_conclusion || "暂无核心结论。"}</p></Section>
        {sources.length > 0 && <Section title={`参考来源（${sources.length}）`}><div className="space-y-2.5">{sources.map((source, index) => <SourceCard key={source.id} source={source} index={index + 1} />)}</div></Section>}
      </div>
    );
  }
  const sections: Array<[string, unknown]> = [
    ["核心结论", report.core_judgment],
    ["重点动态", report.key_developments],
    ["影响分析", report.impact_analysis],
    ["研判与建议", report.company_implications],
    ["风险与后续关注", report.risks_and_watch_items],
  ];
  return (
    <div className="space-y-8">
      <section className="grid gap-x-5 gap-y-2 border-y border-[#D0D5DD] py-3 sm:grid-cols-4">
        <div><p className="text-[10px] font-semibold uppercase tracking-wide text-[#98A2B3]">面向</p><p className="mt-1 text-xs text-[#344054]">{AUDIENCE_LABEL[report.audience] || report.audience || "—"}</p></div>
        <div><p className="text-[10px] font-semibold uppercase tracking-wide text-[#98A2B3]">时间范围</p><p className="mt-1 text-xs text-[#344054]">{TIME_RANGE_LABEL[report.time_range] || report.time_range || "—"}</p></div>
        <div><p className="text-[10px] font-semibold uppercase tracking-wide text-[#98A2B3]">报告篇幅</p><p className="mt-1 text-xs text-[#344054]">{REPORT_LENGTH_LABEL[report.report_length] || report.report_length || "—"}</p></div>
        <div><p className="text-[10px] font-semibold uppercase tracking-wide text-[#98A2B3]">来源</p><p className="mt-1 text-xs text-[#344054]">{sources.length} 条</p></div>
      </section>
      {sections.map(([title, value]) => <Section key={title} title={title}><ItemList items={itemList(value)} sourceIndexes={sourceIndexes} /></Section>)}
      {report.reference_warnings?.length ? <div className="border-l-2 border-amber-400 pl-3 text-xs leading-5 text-amber-800">{report.reference_warnings.join("；")}</div> : null}
      {sources.length > 0 && (
        <Section title={`信息来源（${sources.length}）`}>
          <div className="border-t border-[#D0D5DD]">{sources.map((source, index) => <div key={source.id} id={`assistant-source-${source.id}`} className="scroll-mt-24"><SourceCard source={source} index={index + 1} /></div>)}</div>
        </Section>
      )}
    </div>
  );
}
