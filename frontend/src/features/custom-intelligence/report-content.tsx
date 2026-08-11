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
    <article className="rounded-lg border border-[#E9EEF4] bg-white p-3.5 sm:p-4">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 items-start gap-2">
            <span className="shrink-0 rounded bg-[#F2F4F7] px-1.5 py-0.5 text-[10px] font-semibold text-[#667085]">{index}</span>
            <h4 className="min-w-0 break-words text-sm font-semibold leading-6 text-[#243B61]">{source.title || "未命名来源"}</h4>
          </div>
          <p className="mt-1 text-[11px] leading-5 text-[#667085]">{source.site_name || "公开来源"}{source.date ? ` · ${source.date}` : ""}</p>
        </div>
        {url ? (
          <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[#C8D7F0] px-2.5 py-1.5 text-[11px] font-semibold text-[#315EA8] hover:bg-[#EEF4FF]">
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
    <span className="ml-1.5 inline-flex flex-wrap gap-1 align-middle">
      {ids.map((id) => sourceIndexes.has(id) ? (
        <a key={id} href={`#assistant-source-${id}`} className="rounded bg-[#EEF4FF] px-1.5 py-0.5 text-[10px] font-semibold text-[#315EA8] hover:bg-[#DCE8FF]">来源 {sourceIndexes.get(id)}</a>
      ) : <span key={id} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">来源未匹配</span>)}
    </span>
  );
}

function ItemList({ items, sourceIndexes }: { items: IntelligenceReportItem[]; sourceIndexes: Map<string, number> }) {
  if (!items.length) return <p className="text-sm text-[#98A2B3]">暂无内容。</p>;
  return (
    <div className="space-y-2.5">
      {items.map((item, index) => (
        <div key={`${item.text}-${index}`} className={`rounded-md px-3.5 py-3 ${item.type === "recommendation" ? "border-l-2 border-[#4F7CFF] bg-[#F3F7FF]" : "bg-[#F8FAFC]"}`}>
          <p className="whitespace-pre-wrap break-words text-sm leading-6 text-[#344054]">
            <span className={`mr-1.5 rounded px-1.5 py-0.5 text-[10px] font-semibold ${item.type === "recommendation" ? "bg-[#EAF2FF] text-[#315EA8]" : item.type === "fact" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
              {item.type === "recommendation" ? "分析建议" : item.type === "fact" ? "事实" : "分析判断"}
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
    ["核心判断", report.core_judgment],
    ["关键动态与案例", report.key_developments],
    ["影响分析", report.impact_analysis],
    ["对公司的启示", report.company_implications],
    ["风险与关注事项", report.risks_and_watch_items],
  ];
  return (
    <div className="space-y-8">
      <section className="grid gap-3 rounded-lg border border-[#E9EEF4] bg-[#F8FAFD] p-3.5 sm:grid-cols-4">
        <div><p className="text-[10px] font-semibold text-[#98A2B3]">面向</p><p className="mt-1 text-xs text-[#344054]">{AUDIENCE_LABEL[report.audience] || report.audience || "—"}</p></div>
        <div><p className="text-[10px] font-semibold text-[#98A2B3]">时间范围</p><p className="mt-1 text-xs text-[#344054]">{TIME_RANGE_LABEL[report.time_range] || report.time_range || "—"}</p></div>
        <div><p className="text-[10px] font-semibold text-[#98A2B3]">报告篇幅</p><p className="mt-1 text-xs text-[#344054]">{REPORT_LENGTH_LABEL[report.report_length] || report.report_length || "—"}</p></div>
        <div><p className="text-[10px] font-semibold text-[#98A2B3]">来源</p><p className="mt-1 text-xs text-[#344054]">{sources.length} 条</p></div>
      </section>
      {sections.map(([title, value]) => <Section key={title} title={title}><ItemList items={itemList(value)} sourceIndexes={sourceIndexes} /></Section>)}
      {report.reference_warnings?.length ? <div className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2.5 text-xs leading-5 text-amber-800">{report.reference_warnings.join("；")}</div> : null}
      {sources.length > 0 && (
        <Section title={`信息来源（${sources.length}）`}>
          <div className="space-y-2.5">{sources.map((source, index) => <div key={source.id} id={`assistant-source-${source.id}`} className="scroll-mt-24"><SourceCard source={source} index={index + 1} /></div>)}</div>
        </Section>
      )}
    </div>
  );
}
