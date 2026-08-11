"use client";

import { ExternalLink } from "lucide-react";
import type { ReactNode } from "react";
import type {
  IntelligenceAssistantExecution,
  IntelligenceReportItem,
  IntelligenceReportV2,
  IntelligenceSource,
  IntelligenceReportTemplateStyle,
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

export function ReportTemplateSwitcher({
  value,
  onChange,
}: {
  value: IntelligenceReportTemplateStyle;
  onChange: (value: IntelligenceReportTemplateStyle) => void;
}) {
  return (
    <div className="inline-flex items-center rounded-md border border-[#D0D5DD] bg-white p-0.5" role="group" aria-label="报告模板">
      {([
        ["research", "研究简报"],
        ["newsletter", "情报日报"],
      ] as const).map(([style, label]) => (
        <button
          key={style}
          type="button"
          aria-pressed={value === style}
          onClick={() => onChange(style)}
          className={`rounded px-2.5 py-1 text-[11px] font-semibold transition ${value === style ? "bg-[#172033] text-white" : "text-[#667085] hover:bg-[#F2F4F7]"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function formatNewsletterDate(value: string | undefined | null): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value.slice(0, 10);
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${year}.${month}.${day}`;
}

function NewsletterItems({ items, sourceIndexes }: { items: IntelligenceReportItem[]; sourceIndexes: Map<string, number> }) {
  if (!items.length) return <p className="text-sm text-[#98A2B3]">暂无内容。</p>;
  return (
    <div className="space-y-4">
      {items.map((item, index) => (
        <div key={`${item.text}-${index}`} className={`relative pl-4 ${item.type === "recommendation" ? "border-l-[3px] border-[#C62828]" : "border-l border-[#D0D5DD]"}`}>
          <p className={`mb-1 text-[10px] font-bold uppercase tracking-[0.14em] ${item.type === "fact" ? "text-[#667085]" : item.type === "recommendation" ? "text-[#C62828]" : "text-[#AA1D1D]"}`}>
            {item.type === "fact" ? "事实" : item.type === "recommendation" ? "建议" : "分析"} · {String(index + 1).padStart(2, "0")}
          </p>
          <p className="whitespace-pre-wrap break-words text-[13px] leading-6 text-[#272727]">
            {item.text}
            <SourceRefs ids={item.source_ids} sourceIndexes={sourceIndexes} />
          </p>
        </div>
      ))}
    </div>
  );
}

function NewsletterSection({
  title,
  items,
  sourceIndexes,
}: {
  title: string;
  items: IntelligenceReportItem[];
  sourceIndexes: Map<string, number>;
}) {
  return (
    <section>
      <div className="mb-4 flex items-center gap-2 border-b border-[#1F1F1F] pb-2">
        <span className="h-4 w-1 bg-[#C62828]" aria-hidden="true" />
        <h3 className="text-sm font-black tracking-[0.12em] text-[#1F1F1F]">{title}</h3>
      </div>
      <NewsletterItems items={items} sourceIndexes={sourceIndexes} />
    </section>
  );
}

function NewsletterReportBody({ execution, report, sources, sourceIndexes }: { execution: IntelligenceAssistantExecution; report: IntelligenceReportV2; sources: IntelligenceSource[]; sourceIndexes: Map<string, number> }) {
  const executedAt = report.executed_at || execution.completed_at || execution.created_at;
  return (
    <article className="space-y-7 bg-white px-1 py-1 text-[#1F1F1F] sm:px-3" aria-label="自定义情报助手日报">
      <header className="text-center">
        <p className="text-[30px] font-black tracking-[0.24em] text-[#111111]">自定义情报助手</p>
        <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-[#667085]">金融科技情报日报 · Financial Tech Daily</p>
        <p className="mt-3 text-[11px] tracking-[0.16em] text-[#667085]">{formatNewsletterDate(executedAt)} · 深圳</p>
      </header>

      <div className="border-y-[3px] border-[#111111] py-1" aria-hidden="true" />

      <section className="border-b border-[#D0D5DD] pb-6">
        <div className="mb-3 flex items-center gap-2">
          <span className="rounded-sm bg-[#C62828] px-2 py-1 text-[10px] font-bold tracking-[0.16em] text-white">独家分析</span>
          <span className="text-[11px] font-semibold tracking-[0.14em] text-[#667085]">EXECUTIVE TAKEAWAY</span>
        </div>
        <h2 className="text-xl font-black leading-8 tracking-wide text-[#1F1F1F]">核心判断</h2>
        <div className="mt-4">
          <NewsletterItems items={itemList(report.core_judgment)} sourceIndexes={sourceIndexes} />
        </div>
      </section>

      <div className="grid gap-8 md:grid-cols-2">
        <NewsletterSection title="动态" items={itemList(report.key_developments)} sourceIndexes={sourceIndexes} />
        <NewsletterSection title="分析" items={itemList(report.impact_analysis)} sourceIndexes={sourceIndexes} />
      </div>

      <section>
        <div className="mb-4 flex items-center gap-2 border-b border-[#1F1F1F] pb-2">
          <span className="h-4 w-1 bg-[#C62828]" aria-hidden="true" />
          <h3 className="text-sm font-black tracking-[0.12em] text-[#1F1F1F]">行动建议</h3>
        </div>
        <NewsletterItems items={itemList(report.company_implications)} sourceIndexes={sourceIndexes} />
      </section>

      <section className="border border-[#E4B5B5] bg-[#FFF8F8] p-4">
        <div className="mb-2 flex items-center gap-2">
          <span className="h-4 w-1 bg-[#C62828]" aria-hidden="true" />
          <h3 className="text-sm font-black tracking-[0.12em] text-[#8F1D1D]">风险提示</h3>
        </div>
        <NewsletterItems items={itemList(report.risks_and_watch_items)} sourceIndexes={sourceIndexes} />
      </section>

      {report.reference_warnings?.length ? <div className="border-l-[3px] border-[#C62828] pl-3 text-xs leading-5 text-[#8F1D1D]">{report.reference_warnings.join("；")}</div> : null}

      <footer className="border-t-[3px] border-[#111111] bg-[#111111] px-4 py-4 text-white">
        <p className="text-[10px] font-bold tracking-[0.14em] text-[#F4B4B4]">信息来源 · SOURCES</p>
        {sources.length ? (
          <ol className="mt-3 space-y-1.5 text-[10px] leading-5 text-[#E4E4E4]">
            {sources.map((source, index) => <li key={source.id} id={`assistant-source-${source.id}`} className="break-words"><span className="mr-1 font-mono text-[#F4B4B4]">[{index + 1}]</span>{source.title || "未命名来源"}{source.site_name ? ` · ${source.site_name}` : ""}</li>)}
          </ol>
        ) : <p className="mt-2 text-xs text-[#AFAFAF]">暂无来源。</p>}
      </footer>
    </article>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section><h3 className={REPORT_HEADING_CLASS}>{title}</h3>{children}</section>;
}

export function ReportBody({ execution, templateStyle = "research" }: { execution: IntelligenceAssistantExecution; templateStyle?: IntelligenceReportTemplateStyle }) {
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
  if (templateStyle === "newsletter") {
    return <NewsletterReportBody execution={execution} report={report} sources={sources} sourceIndexes={sourceIndexes} />;
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
