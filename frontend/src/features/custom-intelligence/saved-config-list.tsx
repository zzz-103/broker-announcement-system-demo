"use client";

import { Edit3, Loader2, Play, Plus, Trash2 } from "lucide-react";
import type { IntelligenceAssistantTopic } from "@/lib/api/contracts";
import { AUDIENCE_LABEL, REPORT_LENGTH_LABEL, TIME_RANGE_LABEL } from "./custom-intelligence-constants";

export function SavedConfigList({
  topics,
  loading,
  activeExecutionId,
  onCreate,
  onEdit,
  onDelete,
  onRun,
}: {
  topics: IntelligenceAssistantTopic[];
  loading: boolean;
  activeExecutionId: number | null;
  onCreate: () => void;
  onEdit: (topic: IntelligenceAssistantTopic) => void;
  onDelete: (topic: IntelligenceAssistantTopic) => void;
  onRun: (topic: IntelligenceAssistantTopic) => void;
}) {
  if (loading && topics.length === 0) return <div className="flex items-center gap-2 py-10 text-sm text-[#667085]" role="status"><Loader2 className="size-4 animate-spin" aria-hidden="true" />正在加载我的助手…</div>;
  if (topics.length === 0) return (
    <div className="rounded-lg border border-dashed border-[#C8D7F0] bg-[#F8FAFD] py-10 text-center">
      <p className="text-sm font-semibold text-[#344054]">还没有保存助手</p>
      <p className="mt-1 text-xs text-[#98A2B3]">保存常用报告需求，便于再次使用。</p>
      <button type="button" onClick={onCreate} className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-[#2563EB] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1D4ED8]"><Plus className="size-3.5" aria-hidden="true" />新建助手</button>
    </div>
  );
  return (
    <div className="space-y-3" aria-busy={loading}>
      {topics.map((topic) => {
        const busy = activeExecutionId !== null;
        return (
          <article key={topic.id} className="rounded-lg border border-[#E4EAF2] bg-white p-4 sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h4 className="truncate text-sm font-semibold text-[#243B61]" title={topic.name}>{topic.name}</h4>
                <p className="mt-1 line-clamp-2 text-xs leading-5 text-[#475467]">{topic.focus}</p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] text-[#98A2B3]">
                  <span>{AUDIENCE_LABEL[topic.audience] || topic.audience}</span><span aria-hidden="true">·</span><span>{TIME_RANGE_LABEL[topic.time_range] || topic.time_range}</span><span aria-hidden="true">·</span><span>{REPORT_LENGTH_LABEL[topic.report_length] || topic.report_length}</span>
                  {topic.focus_tags.map((tag) => <span key={tag} className="rounded bg-[#EEF4FF] px-1.5 py-0.5 text-[#315EA8]">{tag}</span>)}
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <button type="button" onClick={() => onRun(topic)} disabled={busy} className="inline-flex items-center gap-1 rounded-md bg-[#2563EB] px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-[#1D4ED8] disabled:cursor-not-allowed disabled:opacity-45"><Play className="size-3" aria-hidden="true" />生成报告</button>
                <button type="button" onClick={() => onEdit(topic)} className="inline-flex items-center gap-1 rounded-md border border-[#D0D5DD] px-2.5 py-1.5 text-[11px] font-semibold text-[#475467] hover:bg-[#F8FAFC]"><Edit3 className="size-3" aria-hidden="true" />编辑</button>
                <button type="button" onClick={() => onDelete(topic)} disabled={busy} className="inline-flex items-center gap-1 rounded-md border border-transparent px-2.5 py-1.5 text-[11px] font-semibold text-[#B42318] hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"><Trash2 className="size-3" aria-hidden="true" />删除</button>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
