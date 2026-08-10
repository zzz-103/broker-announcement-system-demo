"use client";

import { Bookmark, Play } from "lucide-react";
import type {
  CustomIntelligenceOptionsResponse,
  IntelligenceTopic,
  InstantSearchRequest,
} from "@/lib/api/contracts";
import { ConfigFields, SavedConfigPicker } from "./config-fields";
import { KeywordSuggestionPicker } from "./keyword-suggestion-picker";

export interface InstantSearchPanelProps {
  children?: React.ReactNode;
  topics: IntelligenceTopic[];
  selectedConfigId: number | null;
  selectedConfig?: IntelligenceTopic;
  form: InstantSearchRequest;
  options: CustomIntelligenceOptionsResponse;
  optionsLoading: boolean;
  serviceAvailable: boolean;
  analysisAvailable: boolean;
  activeExecutionId: number | null;
  workspaceMode: boolean;
  suggesting: boolean;
  keywordSuggestions: string[];
  selectedSuggestions: string[];
  onFormChange: (value: InstantSearchRequest) => void;
  onApplyConfig: (value: string) => void;
  onStartSearch: () => void;
  onSuggestKeywords: () => void;
  onSelectedSuggestionsChange: (value: string[]) => void;
  onMergeKeywords: () => void;
  onSaveCurrentConfig: () => void;
  onResetWorkspace: () => void;
}

export function InstantSearchPanel({
  children,
  topics,
  selectedConfigId,
  selectedConfig,
  form,
  options,
  optionsLoading,
  serviceAvailable,
  analysisAvailable,
  activeExecutionId,
  workspaceMode,
  suggesting,
  keywordSuggestions,
  selectedSuggestions,
  onFormChange,
  onApplyConfig,
  onStartSearch,
  onSuggestKeywords,
  onSelectedSuggestionsChange,
  onMergeKeywords,
  onSaveCurrentConfig,
  onResetWorkspace,
}: InstantSearchPanelProps) {
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      <div className={`min-w-0 transition-all duration-300 ease-out motion-reduce:transition-none ${workspaceMode ? "w-full lg:w-[32%] lg:min-w-[330px] lg:max-w-[430px] lg:shrink-0" : "w-full"}`}>
        <div className="rounded-lg border border-[#E4EAF2] bg-white p-4">
          <div className="mb-4 flex items-start justify-between gap-2">
            <div>
              <h3 className="text-base font-semibold text-[#172033]">{workspaceMode ? "搜索配置" : "搜索情报"}</h3>
              <p className="mt-1 text-xs leading-5 text-[#667085]">{workspaceMode ? "修改配置后重新搜索，右侧会进入新的执行状态。" : "输入业务问题，选择分析角度和时间范围。"}</p>
            </div>
            {workspaceMode && (
              <button type="button" onClick={onResetWorkspace} className="shrink-0 rounded-md border border-[#D0D5DD] px-2.5 py-1.5 text-[11px] font-semibold text-[#475467] hover:bg-[#F8FAFD]">
                收起报告区
              </button>
            )}
          </div>
          <div className="space-y-4">
            <SavedConfigPicker topics={topics} selectedId={selectedConfigId} onSelect={onApplyConfig} />
            {selectedConfig && (
              <p className="-mt-2 text-[10px] leading-4 text-[#98A2B3]">已载入「{selectedConfig.name}」；点击“保存当前配置”将更新该配置。</p>
            )}
            <ConfigFields value={form} onChange={onFormChange} options={options} compact={workspaceMode} />
          </div>
          <div className="mt-4 space-y-3 border-t border-[#E4EAF2] pt-4">
            <button onClick={onStartSearch} disabled={activeExecutionId !== null || !form.question.trim() || optionsLoading || !serviceAvailable} className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-[#2563EB] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#1D4ED8] disabled:cursor-not-allowed disabled:opacity-50">
              <Play className="size-4" />开始搜索
            </button>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button onClick={onSuggestKeywords} disabled={suggesting || !analysisAvailable} title={analysisAvailable ? undefined : "LLM 分析服务未配置"} className="inline-flex items-center gap-1.5 rounded-md border border-[#C8D7F0] bg-[#F8FAFD] px-3 py-2 text-xs font-semibold text-[#315EA8] transition hover:bg-[#EEF4FF] disabled:cursor-not-allowed disabled:opacity-50">
                {suggesting ? "正在生成…" : "补充关键词"}
              </button>
              <button onClick={onSaveCurrentConfig} className="inline-flex items-center gap-1.5 rounded-md border border-[#C8D7F0] bg-white px-3 py-2 text-xs font-semibold text-[#315EA8] transition hover:bg-[#EEF4FF]">
                <Bookmark className="size-3.5" aria-hidden="true" />保存当前配置
              </button>
            </div>
          </div>
          {keywordSuggestions.length > 0 && (
            <KeywordSuggestionPicker
              title="生成的关键词"
              description="勾选需要的词，确认后加入当前配置。"
              suggestions={keywordSuggestions}
              selected={selectedSuggestions}
              onSelectionChange={onSelectedSuggestionsChange}
              onMerge={onMergeKeywords}
            />
          )}
        </div>
      </div>
      {workspaceMode && (
        <div className="ci-panel-in min-w-0 flex-1">
          {children}
        </div>
      )}
    </div>
  );
}
