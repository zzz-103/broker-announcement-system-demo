"use client";

import {
  BrainCircuit,
  FileText,
  Loader2,
  Pencil,
  Play,
  Plus,
} from "lucide-react";
import type {
  CustomIntelligenceExecution,
  CustomIntelligenceOptionsResponse,
  IntelligenceTopic,
} from "@/lib/api/contracts";
import { formatDateOnly } from "@/lib/display";
import { optionLabel } from "./custom-intelligence-utils";
import { RowMenu } from "./row-menu";

interface SavedConfigListProps {
  topics: IntelligenceTopic[];
  loading: boolean;
  options: CustomIntelligenceOptionsResponse;
  serviceAvailable: boolean;
  activeExecutionId: number | null;
  topicUpdatingId: number | null;
  recentExecutionsByTopic?: Map<number, CustomIntelligenceExecution>;
  onCreate: () => void;
  onToggle: (topic: IntelligenceTopic) => void;
  onEdit: (topic: IntelligenceTopic) => void;
  onDelete: (topic: IntelligenceTopic) => void;
  onLoad: (topic: IntelligenceTopic) => void;
  onLoadAndSearch: (topic: IntelligenceTopic) => void;
  onOpenReport?: (execution: CustomIntelligenceExecution) => void;
}

export function SavedConfigList({
  topics,
  loading,
  options,
  serviceAvailable,
  activeExecutionId,
  topicUpdatingId,
  recentExecutionsByTopic,
  onCreate,
  onToggle,
  onEdit,
  onDelete,
  onLoad,
  onLoadAndSearch,
  onOpenReport,
}: SavedConfigListProps) {
  if (loading && topics.length === 0) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-[#667085]" role="status" aria-live="polite">
        <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        正在加载已保存配置…
      </div>
    );
  }

  if (topics.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[#C8D7F0] bg-[#F8FAFD] py-8 text-center" role="status">
        <BrainCircuit className="mx-auto size-7 text-[#9FB9E8]" aria-hidden="true" />
        <p className="mt-2 text-sm font-semibold text-[#344054]">暂无已保存配置</p>
        <p className="mt-1 text-xs text-[#98A2B3]">在即时搜索中保存常用参数组合，之后可一键载入或搜索。</p>
        <button type="button" onClick={onCreate} className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-[#2563EB] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1D4ED8]">
          <Plus className="size-3.5" aria-hidden="true" />新建配置
        </button>
      </div>
    );
  }

  return (
    <div className="divide-y divide-[#E4EAF2]" aria-busy={loading}>
      {topics.map((topic) => {
        const recent = recentExecutionsByTopic?.get(topic.id);
        const busy = topicUpdatingId === topic.id;
        return (
          <article key={topic.id} className={`grid gap-3 px-3 py-3.5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center ${topic.enabled ? "bg-white" : "bg-[#FAFBFC]"}`}>
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <h4 className="min-w-0 truncate text-sm font-semibold text-[#243B61]" title={topic.name}>{topic.name}</h4>
                <span className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold ${topic.enabled ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                  {topic.enabled ? "已启用" : "已停用"}
                </span>
              </div>
              {topic.question && (
                <p className="mt-1 truncate text-xs text-[#344054]" title={topic.question}>业务问题：{topic.question}</p>
              )}
              <p className="mt-1 truncate text-xs text-[#667085]" title={topic.description || "未填写业务背景"}>{topic.description || "未填写业务背景"}</p>
              <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5 text-[10px] text-[#98A2B3]">
                <span>{optionLabel(options.perspectives, topic.analysis_perspective)}</span>
                <span aria-hidden="true">·</span>
                <span>{optionLabel(options.time_ranges, topic.time_range)}</span>
                <span aria-hidden="true">·</span>
                <span>更新于 {topic.updated_at ? formatDateOnly(topic.updated_at) : "—"}</span>
                {recent && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className={recent.status === "succeeded" ? "text-emerald-600" : recent.status === "failed" ? "text-red-600" : "text-amber-600"}>
                      {recent.status === "succeeded" ? "最近成功" : recent.status === "failed" && recent.search_status === "succeeded" ? "分析失败" : recent.status === "failed" ? "最近失败" : "最近执行中"}
                    </span>
                  </>
                )}
                {topic.keywords.slice(0, 4).map((keyword) => (
                  <span key={keyword} className="rounded bg-[#EEF4FF] px-1.5 py-0.5 text-[#315EA8]" title={keyword}>{keyword}</span>
                ))}
                {topic.keywords.length > 4 && <span>+{topic.keywords.length - 4}</span>}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t border-[#F0F2F5] pt-2 lg:border-t-0 lg:pt-0">
              {recent?.search_status === "succeeded" && (
                <button type="button" onClick={() => onOpenReport?.(recent)} className="inline-flex items-center gap-1 rounded-md border border-[#C8D7F0] px-2.5 py-1.5 text-[11px] font-semibold text-[#315EA8] hover:bg-[#EEF4FF]">
                  <FileText className="size-3" aria-hidden="true" />{recent.analysis_status === "succeeded" ? "查看最近报告" : "查看原始结果"}
                </button>
              )}
              <button type="button" onClick={() => onLoad(topic)} className="rounded-md border border-[#D0D5DD] px-2.5 py-1.5 text-[11px] font-semibold text-[#475467] hover:bg-[#F8FAFD]">
                载入
              </button>
              <button type="button" onClick={() => onEdit(topic)} className="inline-flex items-center gap-1 rounded-md border border-[#D0D5DD] px-2.5 py-1.5 text-[11px] font-semibold text-[#475467] hover:bg-[#F8FAFD]">
                <Pencil className="size-3" aria-hidden="true" />编辑
              </button>
              <button type="button" onClick={() => onLoadAndSearch(topic)} disabled={!topic.enabled || activeExecutionId !== null || !serviceAvailable || busy} className="inline-flex items-center gap-1 rounded-md bg-[#2563EB] px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-[#1D4ED8] disabled:cursor-not-allowed disabled:opacity-45 lg:ml-auto">
                <Play className="size-3" aria-hidden="true" />载入并搜索
              </button>
              <RowMenu
                label={`配置「${topic.name}」更多操作`}
                items={[
                  {
                    label: topic.enabled ? "停用配置" : "启用配置",
                    disabled: busy || activeExecutionId !== null,
                    onSelect: () => onToggle(topic),
                  },
                  { label: "删除配置", danger: true, disabled: busy || activeExecutionId !== null, onSelect: () => onDelete(topic) },
                ]}
              />
            </div>
          </article>
        );
      })}
    </div>
  );
}
