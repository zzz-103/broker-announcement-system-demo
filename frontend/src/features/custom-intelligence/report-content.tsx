"use client";

import { ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import { useMemo, useState } from "react";
import type {
  CustomIntelligenceExecution,
  CustomIntelligenceOptionsResponse,
  IntelligenceReport,
  IntelligenceSource,
} from "@/lib/api/contracts";
import { REPORT_HEADING_CLASS, REPORT_PROSE_CLASS } from "./custom-intelligence-constants";
import { formatDate, optionLabel, safeHttpUrl } from "./custom-intelligence-utils";

function TextList({ items, empty = "暂无", spaced = false }: { items: string[] | undefined; empty?: string; spaced?: boolean }) {
  const values = (items ?? []).filter(Boolean);
  if (!values.length) return <span className="text-sm text-[#98A2B3]">{empty}</span>;
  return <ul className={spaced ? "space-y-2.5" : "space-y-1.5"}>{values.map((item, index) => <li key={`${item}-${index}`} className="flex gap-2 text-sm leading-6 text-[#344054]"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-[#7699D7]" /> <span className="whitespace-pre-wrap break-words">{item}</span></li>)}</ul>;
}

export function SourceCard({ source, index, anchorPrefix = "report-source" }: { source: IntelligenceSource; index: number; anchorPrefix?: string }) {
  const [expanded, setExpanded] = useState(false);
  const url = safeHttpUrl(source.url);
  const snippet = source.snippet?.trim();
  return (
    <article id={`${anchorPrefix}-${source.id}`} className="scroll-mt-24 rounded-lg border border-[#E9EEF4] bg-white p-4">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start gap-2">
            <span className="shrink-0 rounded bg-[#F2F4F7] px-1.5 py-0.5 text-[10px] font-semibold text-[#667085]">{index}</span>
            <h4 className="min-w-0 break-words text-sm font-semibold leading-6 text-[#243B61]">{source.title || "未命名来源"}</h4>
          </div>
          <p className="mt-1 text-[11px] leading-5 text-[#667085]">{source.site_name || "未知站点"}{source.date ? ` · ${source.date}` : ""}</p>
        </div>
        {url ? (
          <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[#C8D7F0] bg-white px-2.5 py-1.5 text-[11px] font-semibold text-[#315EA8] hover:bg-[#EEF4FF]">
            <ExternalLink className="size-3.5" aria-hidden="true" />打开原文
          </a>
        ) : (
          <span className="shrink-0 text-[10px] text-[#98A2B3]">链接不可用</span>
        )}
      </div>
      {snippet && (
        <div className="mt-2.5">
          <p className={`whitespace-pre-wrap break-words text-[13px] leading-6 text-[#667085] ${expanded ? "" : "line-clamp-2"}`}>{snippet}</p>
          <button type="button" onClick={() => setExpanded((current) => !current)} className="mt-1.5 inline-flex items-center gap-1 rounded-md text-[11px] font-semibold text-[#315EA8] hover:text-[#1D4ED8]">
            {expanded ? <ChevronUp className="size-3.5" aria-hidden="true" /> : <ChevronDown className="size-3.5" aria-hidden="true" />}
            {expanded ? "收起摘要" : "展开摘要"}
          </button>
        </div>
      )}
    </article>
  );
}

function SourceBadge({
  sourceId,
  source,
  index,
  anchorPrefix = "report-source",
}: {
  sourceId: string;
  source?: IntelligenceSource;
  index?: number;
  anchorPrefix?: string;
}) {
  if (!source) {
    return <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">来源 {index ?? "?"}（未匹配）</span>;
  }
  return (
    <button
      type="button"
      onClick={() => document.getElementById(`${anchorPrefix}-${sourceId}`)?.scrollIntoView({ behavior: "smooth", block: "start" })}
      title={`定位到来源：${source.title || "未命名来源"}`}
      className="max-w-full min-w-0 truncate rounded border border-[#C8D7F0] bg-white px-1.5 py-0.5 text-[10px] text-[#315EA8] hover:bg-[#EEF4FF]"
    >
      来源 {index ?? "?"} · {source.title || "来源"}
    </button>
  );
}

function DynamicCard({
  dynamic,
  index,
  sourceMap,
  sourceIndexes,
  anchorPrefix,
}: {
  dynamic: IntelligenceReport["key_dynamics"][number];
  index: number;
  sourceMap: Map<string, IntelligenceSource>;
  sourceIndexes: Map<string, number>;
  anchorPrefix: string;
}) {
  const sourceIds = dynamic.source_ids ?? [];
  return (
    <article className="min-w-0 rounded-lg bg-[#F8FAFC] p-4 sm:p-5">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <h4 className="min-w-0 break-words text-[15px] font-bold leading-6 text-[#243B61]">{dynamic.title || `动态 ${index + 1}`}</h4>
        {dynamic.information_time ? <span className="shrink-0 text-[11px] leading-6 text-[#98A2B3]">{dynamic.information_time}</span> : null}
      </div>
      {dynamic.institutions?.length ? (
        <p className="mt-1.5 text-xs leading-5 text-[#667085]">涉及机构：{dynamic.institutions.join("、")}</p>
      ) : null}
      {dynamic.event_tags?.length ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {dynamic.event_tags.map((tag) => (
            <span key={tag} className="rounded bg-[#EEF4FF] px-1.5 py-0.5 text-[10px] text-[#315EA8]">{tag}</span>
          ))}
        </div>
      ) : null}
      {dynamic.summary ? (
        <div className="mt-3.5">
          <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-[#98A2B3]">摘要</p>
          <p className="whitespace-pre-wrap break-words text-sm leading-[1.85] text-[#344054]">{dynamic.summary}</p>
        </div>
      ) : null}
      {dynamic.impact_analysis ? (
        <div className="mt-3.5 rounded-r-md border-l-2 border-[#7699D7] bg-white p-3.5">
          <p className="mb-1 text-[11px] font-semibold tracking-wide text-[#98A2B3]">影响分析</p>
          <p className="whitespace-pre-wrap break-words text-[13px] leading-[1.8] text-[#475467]">{dynamic.impact_analysis}</p>
        </div>
      ) : null}
      {sourceIds.length ? (
        <div className="mt-3.5 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-semibold text-[#98A2B3]">来源</span>
          {sourceIds.map((sourceId) => (
            <SourceBadge key={sourceId} sourceId={sourceId} source={sourceMap.get(sourceId)} index={sourceIndexes.get(sourceId)} anchorPrefix={anchorPrefix} />
          ))}
        </div>
      ) : null}
    </article>
  );
}

function ReportSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0">
      <h3 className={REPORT_HEADING_CLASS}>{title}</h3>
      {children}
    </section>
  );
}

/**
 * 完整报告正文：右侧报告区与“展开阅读”宽屏弹窗共用，保证层级与样式一致。
 */
export function ReportBody({
  execution,
  options,
  anchorPrefix,
}: {
  execution: CustomIntelligenceExecution;
  options: CustomIntelligenceOptionsResponse;
  anchorPrefix: string;
}) {
  const report = (execution.report ?? {}) as Partial<IntelligenceReport>;
  const sources = execution.sources;
  const sourceMap = useMemo(() => new Map(sources.map((source) => [source.id, source])), [sources]);
  const sourceIndexes = useMemo(() => new Map(sources.map((source, index) => [source.id, index + 1])), [sources]);
  const focusSections = (report.focus_sections ?? []).filter(
    (section) => section.title?.trim() && section.items?.length,
  );
  const dynamics = report.key_dynamics ?? [];
  const opportunities = report.opportunities ?? [];
  const risks = report.risks ?? [];
  const watchItems = report.watch_items ?? [];
  const recommendedFollowups = report.recommended_followups ?? [];
  const analysisFailed = execution.search_status === "succeeded" && execution.analysis_status === "failed";
  return (
    <div className="min-w-0 space-y-9">
      {analysisFailed && (
        <div role="status" className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
          百度搜索已完成，DeepSeek 分析失败。当前可查看原始来源，也可以重新分析。
        </div>
      )}
      {report.is_fallback && (
        <div role="status" className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
          本次报告使用基础格式展示。
        </div>
      )}
      <section className="grid gap-3 rounded-lg border border-[#E9EEF4] bg-[#F8FAFD] p-3.5 sm:grid-cols-2 lg:grid-cols-4">
        <div><p className="text-[10px] font-semibold text-[#98A2B3]">完成时间</p><p className="mt-1 text-xs leading-5 text-[#344054]">{report.executed_at || formatDate(execution.completed_at || execution.created_at)}</p></div>
        <div><p className="text-[10px] font-semibold text-[#98A2B3]">时间范围</p><p className="mt-1 text-xs leading-5 text-[#344054]">{optionLabel(options.time_ranges, report.time_range || execution.snapshot.time_range)}</p></div>
        <div><p className="text-[10px] font-semibold text-[#98A2B3]">报告类型</p><p className="mt-1 text-xs leading-5 text-[#344054]">{optionLabel(options.report_types, report.report_type || execution.snapshot.report_type)}</p></div>
        <div><p className="text-[10px] font-semibold text-[#98A2B3]">有效来源数</p><p className="mt-1 text-xs leading-5 text-[#344054]">{report.valid_source_count ?? sources.length}</p></div>
      </section>
      <ReportSection title="核心结论">
        <p className={REPORT_PROSE_CLASS}>{report.core_conclusion || "暂无核心结论。"}</p>
      </ReportSection>
      {dynamics.length > 0 && (
        <ReportSection title="重点动态">
          <div className="space-y-4">
            {dynamics.map((dynamic, index) => (
              <DynamicCard key={`${dynamic.title}-${index}`} dynamic={dynamic} index={index} sourceMap={sourceMap} sourceIndexes={sourceIndexes} anchorPrefix={anchorPrefix} />
            ))}
          </div>
        </ReportSection>
      )}
      {focusSections.length > 0 && (
        <ReportSection title="专属分析章节">
          <div className="space-y-4">
            {focusSections.map((section) => (
              <div key={section.title} className="min-w-0 rounded-lg border border-[#E9EEF4] bg-white p-4 sm:p-5">
                <h4 className="text-sm font-bold text-[#243B61]">{section.title}</h4>
                <div className="mt-3"><TextList items={section.items} spaced /></div>
              </div>
            ))}
          </div>
        </ReportSection>
      )}
      {report.impact_analysis?.trim() ? (
        <ReportSection title="影响分析">
          <p className={REPORT_PROSE_CLASS}>{report.impact_analysis}</p>
        </ReportSection>
      ) : null}
      {(opportunities.length > 0 || risks.length > 0 || watchItems.length > 0) && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {opportunities.length > 0 && <ReportSection title="机会"><TextList items={opportunities} spaced /></ReportSection>}
          {risks.length > 0 && <ReportSection title="风险"><TextList items={risks} spaced /></ReportSection>}
          {watchItems.length > 0 && <ReportSection title="关注事项"><TextList items={watchItems} spaced /></ReportSection>}
        </div>
      )}
      {recommendedFollowups.length > 0 && (
        <ReportSection title="推荐追问">
          <TextList items={recommendedFollowups} spaced />
        </ReportSection>
      )}
      {sources.length > 0 && (
        <section id={`${anchorPrefix}s`} className="scroll-mt-24 border-t border-[#E4EAF2] pt-7">
          <h3 className={REPORT_HEADING_CLASS}>本次报告参考来源（{sources.length}）</h3>
          <div className="mt-3 space-y-3">
            {sources.map((source, index) => <SourceCard key={source.id} source={source} index={index + 1} anchorPrefix={anchorPrefix} />)}
          </div>
        </section>
      )}
    </div>
  );
}
