"use client";

import * as React from "react";
import { Bookmark, ChevronUp, Loader2, PencilLine, Play, Sparkles } from "lucide-react";
import { HoverSelect } from "@/components/hover-select";
import type { IntelligenceAssistantRequest, IntelligenceAssistantTopic } from "@/lib/api/contracts";
import {
  AUDIENCE_OPTIONS,
  AUDIENCE_RESEARCH_SUGGESTIONS,
  FIELD_INPUT_CLASS,
  FOCUS_TAG_LIMIT,
  REPORT_LENGTH_OPTIONS,
  TIME_RANGE_OPTIONS,
} from "./custom-intelligence-constants";

function RequiredMark() {
  return <><span className="ml-0.5 text-sm font-bold text-red-500" aria-hidden="true">*</span><span className="sr-only">（必填）</span></>;
}

function FieldLabel({ children, hint, htmlFor, required = false }: { children: React.ReactNode; hint?: string; htmlFor?: string; required?: boolean }) {
  return (
    <div className="mb-1.5 flex items-center justify-between gap-2">
      <label htmlFor={htmlFor} className="flex items-center text-xs font-semibold text-[#344054]">{children}{required && <RequiredMark />}</label>
      {hint && <span className="text-[10px] text-[#98A2B3]">{hint}</span>}
    </div>
  );
}

function FocusDirectionSelector({
  audience,
  value,
  compact,
  onChange,
}: {
  audience: IntelligenceAssistantRequest["audience"];
  value: string[];
  compact: boolean;
  onChange: (value: string[]) => void;
}) {
  const suggestions = AUDIENCE_RESEARCH_SUGGESTIONS[audience] ?? [];
  return (
    <fieldset>
      <legend className="mb-1.5 flex w-full items-center justify-between gap-2 text-xs font-semibold text-[#344054]">
        <span>关注方向</span>
        <span className="text-[10px] font-normal text-[#98A2B3]">多选 · {value.length}/{FOCUS_TAG_LIMIT}</span>
      </legend>
      <div className={`flex flex-wrap ${compact ? "gap-1" : "gap-1.5"}`} aria-label="推荐关注方向">
        {suggestions.map((suggestion) => {
          const selected = value.includes(suggestion);
          return (
            <button
              key={suggestion}
              type="button"
              aria-pressed={selected}
              disabled={!selected && value.length >= FOCUS_TAG_LIMIT}
              onClick={() => onChange(selected ? value.filter((item) => item !== suggestion) : [...value, suggestion])}
              className={`rounded-full border text-left text-[11px] transition-colors ${compact ? "px-2 py-0.5 leading-4" : "px-2.5 py-1 leading-5"} ${selected ? "border-[#4F7CFF] bg-[#EEF4FF] font-medium text-[#2455AC]" : "border-[#DCE3ED] bg-white text-[#667085] hover:border-[#9FB9E8] hover:bg-[#F8FBFF]"} disabled:cursor-not-allowed disabled:opacity-40`}
            >
              {suggestion}
            </button>
          );
        })}
      </div>
      <p className="mt-1.5 text-[10px] leading-4 text-[#98A2B3]">可直接选择关注方向，也可自行输入，系统会自动识别并梳理需求。</p>
    </fieldset>
  );
}

function WorkspaceRequestSummary({
  form,
  onEdit,
}: {
  form: IntelligenceAssistantRequest;
  onEdit: () => void;
}) {
  const audience = AUDIENCE_OPTIONS.find((option) => option.value === form.audience)?.label || "未指定受众";
  const timeRange = TIME_RANGE_OPTIONS.find((option) => option.value === form.time_range)?.label || "未指定时间";
  const reportLength = REPORT_LENGTH_OPTIONS.find((option) => option.value === form.report_length)?.label || "未指定篇幅";

  return (
    <aside aria-label="本次报告需求" className="rounded-lg border border-[#E4EAF2] bg-white p-3.5">
      <div className="flex items-center gap-2">
        <span className="flex size-8 items-center justify-center rounded-lg bg-[#EAF2FF] text-[#2563EB]">
          <Sparkles className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-[#172033]">本次报告需求</h3>
        </div>
      </div>

      <p className="mt-3 line-clamp-2 whitespace-pre-wrap break-words text-sm font-medium leading-5 text-[#344054]">
        {form.focus.trim() || form.focus_tags.join("、") || "尚未选择关注方向"}
      </p>

      <div className="mt-2.5 flex flex-wrap gap-1.5" aria-label="需求范围摘要">
        {[audience, timeRange, reportLength].map((label) => (
          <span key={label} className="rounded-full bg-[#F2F4F7] px-2.5 py-1 text-[10px] font-medium text-[#667085]">
            {label}
          </span>
        ))}
      </div>
      {form.focus_tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1" aria-label="已选关注方向">
          {form.focus_tags.map((tag) => <span key={tag} className="rounded-full border border-[#DCE8F8] px-2 py-0.5 text-[10px] text-[#315EA8]">{tag}</span>)}
        </div>
      )}

      <button
        type="button"
        onClick={onEdit}
        className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-[#C8D7F0] bg-white px-3 py-1.5 text-xs font-semibold text-[#315EA8] transition-colors hover:bg-[#EEF4FF] active:bg-[#E4EDFC]"
      >
        <PencilLine className="size-3.5" aria-hidden="true" />调整需求
      </button>
    </aside>
  );
}

export interface InstantSearchPanelProps {
  topics: IntelligenceAssistantTopic[];
  selectedConfigId: number | null;
  form: IntelligenceAssistantRequest;
  activeExecutionId: number | null;
  workspaceMode: boolean;
  optionsLoading: boolean;
  serviceAvailable: boolean;
  onFormChange: (value: IntelligenceAssistantRequest) => void;
  onApplyConfig: (value: string) => void;
  onStartSearch: () => void;
  onSaveCurrentConfig: () => void;
  children?: React.ReactNode;
}

export function InstantSearchPanel({
  topics,
  selectedConfigId,
  form,
  activeExecutionId,
  workspaceMode,
  optionsLoading,
  serviceAvailable,
  onFormChange,
  onApplyConfig,
  onStartSearch,
  onSaveCurrentConfig,
  children,
}: InstantSearchPanelProps) {
  const [editingWorkspace, setEditingWorkspace] = React.useState(false);
  React.useEffect(() => {
    setEditingWorkspace(false);
  }, [activeExecutionId, workspaceMode]);

  const update = <K extends keyof IntelligenceAssistantRequest>(key: K, value: IntelligenceAssistantRequest[K]) => {
    onFormChange({ ...form, [key]: value });
  };
  const selectedAssistant = topics.find((topic) => topic.id === selectedConfigId);
  const disabled = activeExecutionId !== null || optionsLoading || !serviceAvailable || (!form.focus.trim() && form.focus_tags.length === 0);
  const showFullForm = !workspaceMode || editingWorkspace;
  return (
    <div className={`flex flex-col gap-4 lg:grid lg:h-full lg:min-h-0 lg:items-stretch lg:transition-[grid-template-columns] lg:duration-200 lg:ease-out motion-reduce:transition-none ${workspaceMode ? showFullForm ? "lg:grid-cols-[minmax(320px,380px)_minmax(0,1fr)]" : "lg:grid-cols-[260px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)]" : "lg:grid-cols-1"}`}>
      <div className={`min-w-0 ${workspaceMode ? "ci-scroll-region lg:h-full lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain" : "w-full"}`}>
        {showFullForm ? <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!disabled) onStartSearch();
          }}
          className="rounded-lg border border-[#E4EAF2] bg-white p-4 sm:p-5"
        >
          <div className="mb-5 flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="flex size-8 items-center justify-center rounded-lg bg-[#EAF2FF] text-[#2563EB]"><Sparkles className="size-4" aria-hidden="true" /></span>
                <h3 className="text-base font-semibold text-[#172033]">{workspaceMode ? "调整报告需求" : "报告需求"}</h3>
              </div>
              <p className="mt-2 text-xs leading-5 text-[#667085]">选择受众与关注方向，必要时补充具体需求。</p>
            </div>
            {workspaceMode && (
              <button type="button" onClick={() => setEditingWorkspace(false)} className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[#D0D5DD] px-2.5 py-1.5 text-[11px] font-semibold text-[#475467] hover:bg-[#F8FAFD]">
                <ChevronUp className="size-3" aria-hidden="true" />收起
              </button>
            )}
          </div>

          {topics.length > 0 && (
            <div className="mb-4">
              <FieldLabel htmlFor="custom-intelligence-assistant-picker">我的助手</FieldLabel>
              <HoverSelect
                id="custom-intelligence-assistant-picker"
                value={selectedConfigId === null ? "none" : String(selectedConfigId)}
                onChange={onApplyConfig}
                options={[
                  { value: "none", label: "不使用已保存助手" },
                  ...topics.map((topic) => ({ value: String(topic.id), label: topic.name })),
                ]}
                placeholder="选择助手"
                className="w-full"
              />
              {selectedAssistant && <p className="mt-1 text-[10px] text-[#98A2B3]">已载入「{selectedAssistant.name}」，可以临时修改。</p>}
            </div>
          )}

          <div className="space-y-4">
            <fieldset aria-required="true">
              <legend className="mb-1.5 flex items-center text-xs font-semibold text-[#344054]">报告受众<RequiredMark /></legend>
              <div className={`grid grid-cols-2 gap-1.5 ${workspaceMode ? "" : "sm:grid-cols-3 lg:grid-cols-5"}`}>
                {AUDIENCE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={form.audience === option.value}
                    onClick={() => onFormChange({
                      ...form,
                      audience: option.value,
                      audience_detail: option.value === "custom" ? form.audience_detail : "",
                      focus_tags: [],
                    })}
                    className={`rounded-md border px-2.5 text-left text-xs transition-colors ${workspaceMode ? "py-1.5" : "py-2"} ${form.audience === option.value ? "border-[#4F7CFF] bg-[#EEF4FF] text-[#2455AC]" : "border-[#E4EAF2] bg-[#F8FAFC] text-[#475467] hover:border-[#9FB9E8]"}`}
                  >
                    <span className="block font-semibold">{option.label}</span>
                    {!workspaceMode && <span className="mt-0.5 block text-[10px] leading-4 text-[#98A2B3]">{option.detail}</span>}
                  </button>
                ))}
              </div>
            </fieldset>
            {form.audience === "custom" && (
              <div>
                <FieldLabel htmlFor="custom-intelligence-audience-detail" required>受众说明</FieldLabel>
                <input id="custom-intelligence-audience-detail" required value={form.audience_detail} onChange={(event) => update("audience_detail", event.target.value)} maxLength={240} placeholder="例如：分公司负责人，关注可执行动作" className={FIELD_INPUT_CLASS} />
              </div>
            )}

            <FocusDirectionSelector
              audience={form.audience}
              value={form.focus_tags}
              compact={workspaceMode}
              onChange={(value) => update("focus_tags", value)}
            />

            <div>
              <FieldLabel htmlFor="custom-intelligence-focus" hint="可选补充">关注内容</FieldLabel>
              <textarea
                id="custom-intelligence-focus"
                value={form.focus}
                onChange={(event) => update("focus", event.target.value)}
                rows={workspaceMode ? 2 : 3}
                maxLength={1000}
                autoFocus={!workspaceMode}
                placeholder={"可以补充你特别关注的内容，例如：券商 AI 应用、财富管理转型。\n系统将自动检索相关情报并生成总结报告。"}
                className="w-full resize-y rounded-md border border-[#D0D5DD] bg-white px-3 py-2 text-sm leading-6 text-[#172033] outline-none transition focus:border-[#4F7CFF] focus:ring-2 focus:ring-[#4F7CFF]/15"
              />
              <p className="mt-1 text-right text-[10px] text-[#98A2B3]">{form.focus.length}/1000</p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <FieldLabel htmlFor="custom-intelligence-time-range" required>时间范围</FieldLabel>
                <HoverSelect
                  id="custom-intelligence-time-range"
                  value={form.time_range}
                  onChange={(value) => update("time_range", value as IntelligenceAssistantRequest["time_range"])}
                  options={TIME_RANGE_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
                  placeholder="时间范围"
                  className="w-full"
                />
              </div>
              <div>
                <FieldLabel htmlFor="custom-intelligence-report-length" required>报告篇幅</FieldLabel>
                <HoverSelect
                  id="custom-intelligence-report-length"
                  value={form.report_length}
                  onChange={(value) => update("report_length", value as IntelligenceAssistantRequest["report_length"])}
                  options={REPORT_LENGTH_OPTIONS.map((option) => ({ value: option.value, label: `${option.label} · ${option.detail}` }))}
                  placeholder="报告篇幅"
                  className="w-full"
                />
              </div>
            </div>

          </div>

          <div className="mt-5 border-t border-[#E4EAF2] pt-4">
            {!serviceAvailable && !optionsLoading && <p className="rounded-md bg-amber-50 px-3 py-2 text-[11px] leading-5 text-amber-800">情报搜索服务暂不可用，请联系管理员。</p>}
            <div className={`flex flex-wrap items-center justify-end gap-2.5 ${!serviceAvailable && !optionsLoading ? "mt-3" : ""}`}>
              <button type="button" onClick={onSaveCurrentConfig} disabled={!form.focus.trim() && form.focus_tags.length === 0} className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md border border-[#D7E0EC] bg-[#F8FAFD] px-3.5 py-2 text-xs font-semibold text-[#315EA8] transition-[background-color,border-color,color,transform] duration-150 ease-out hover:border-[#B8CAE5] hover:bg-[#EEF4FF] active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transform-none sm:min-h-10">
                <Bookmark className="size-3.5" aria-hidden="true" />保存为我的助手
              </button>
              <button type="submit" disabled={disabled} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-[#2563EB] px-5 py-2 text-sm font-semibold text-white shadow-sm transition-[background-color,box-shadow,transform] duration-150 ease-out hover:bg-[#1D4ED8] hover:shadow active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none motion-reduce:transform-none sm:min-h-10">
                {activeExecutionId !== null ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Play className="size-4" aria-hidden="true" />}
                {activeExecutionId !== null ? "正在生成报告…" : "生成报告"}
              </button>
            </div>
          </div>
        </form> : <WorkspaceRequestSummary form={form} onEdit={() => setEditingWorkspace(true)} />}
      </div>
      {workspaceMode && (
        <div className="ci-panel-in ci-scroll-region min-w-0 lg:h-full lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain" tabIndex={0} aria-label="报告正文，可独立滚动">
          {children}
        </div>
      )}
    </div>
  );
}
