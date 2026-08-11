"use client";

import * as React from "react";
import { Bookmark, Loader2, Play, Sparkles } from "lucide-react";
import { HoverSelect } from "@/components/hover-select";
import type { IntelligenceAssistantRequest, IntelligenceAssistantTopic } from "@/lib/api/contracts";
import {
  AUDIENCE_OPTIONS,
  FIELD_INPUT_CLASS,
  FOCUS_TAG_LIMIT,
  FOCUS_TAG_OPTIONS,
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

function TopicTagSelector({ value, onChange }: { value: string[]; onChange: (value: string[]) => void }) {
  return (
    <fieldset>
      <legend className="mb-1.5 flex w-full items-center justify-between gap-2 text-xs font-semibold text-[#344054]">
        <span>业务主题</span><span className="text-[10px] font-normal text-[#98A2B3]">可选 · {value.length}/{FOCUS_TAG_LIMIT}</span>
      </legend>
      <div className="flex flex-wrap gap-1.5" aria-label="业务主题快捷标签">
        {FOCUS_TAG_OPTIONS.map((tag) => {
          const selected = value.includes(tag);
          return (
            <button
              key={tag}
              type="button"
              aria-pressed={selected}
              disabled={!selected && value.length >= FOCUS_TAG_LIMIT}
              onClick={() => onChange(selected ? value.filter((item) => item !== tag) : [...value, tag])}
              className={`rounded-full border px-2.5 py-1 text-[11px] transition ${selected ? "border-[#4F7CFF] bg-[#EEF4FF] text-[#2455AC]" : "border-[#E4EAF2] bg-white text-[#667085] hover:border-[#9FB9E8]"} disabled:cursor-not-allowed disabled:opacity-40`}
            >
              {tag}
            </button>
          );
        })}
      </div>
    </fieldset>
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
  onResetWorkspace: () => void;
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
  onResetWorkspace,
  children,
}: InstantSearchPanelProps) {
  const update = <K extends keyof IntelligenceAssistantRequest>(key: K, value: IntelligenceAssistantRequest[K]) => {
    onFormChange({ ...form, [key]: value });
  };
  const selectedAssistant = topics.find((topic) => topic.id === selectedConfigId);
  const disabled = activeExecutionId !== null || optionsLoading || !serviceAvailable || !form.focus.trim();
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      <div className={`min-w-0 transition-all duration-300 ease-out motion-reduce:transition-none ${workspaceMode ? "w-full lg:w-[36%] lg:min-w-[330px] lg:max-w-[480px] lg:shrink-0" : "w-full"}`}>
        <form
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
              <p className="mt-2 text-xs leading-5 text-[#667085]">填写关注内容与报告范围。</p>
            </div>
            {workspaceMode && (
              <button type="button" onClick={onResetWorkspace} className="shrink-0 rounded-md border border-[#D0D5DD] px-2.5 py-1.5 text-[11px] font-semibold text-[#475467] hover:bg-[#F8FAFD]">新问题</button>
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
            <div>
              <FieldLabel htmlFor="custom-intelligence-focus" required>关注内容</FieldLabel>
              <textarea
                id="custom-intelligence-focus"
                required
                value={form.focus}
                onChange={(event) => update("focus", event.target.value)}
                rows={workspaceMode ? 3 : 4}
                maxLength={1000}
                autoFocus={!workspaceMode}
                placeholder="例如：近期券商财富管理业务的竞争变化和潜在机会有哪些？"
                className="w-full resize-y rounded-md border border-[#D0D5DD] bg-white px-3 py-2.5 text-sm leading-6 text-[#172033] outline-none transition focus:border-[#4F7CFF] focus:ring-2 focus:ring-[#4F7CFF]/15"
              />
              <p className="mt-1 text-right text-[10px] text-[#98A2B3]">{form.focus.length}/1000</p>
            </div>

            <fieldset aria-required="true">
              <legend className="mb-1.5 flex items-center text-xs font-semibold text-[#344054]">报告受众<RequiredMark /></legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
                {AUDIENCE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={form.audience === option.value}
                    onClick={() => onFormChange({
                      ...form,
                      audience: option.value,
                      audience_detail: option.value === "custom" ? form.audience_detail : "",
                    })}
                    className={`rounded-md border px-2.5 py-2 text-left text-xs transition ${form.audience === option.value ? "border-[#4F7CFF] bg-[#EEF4FF] text-[#2455AC]" : "border-[#E4EAF2] bg-[#F8FAFC] text-[#475467] hover:border-[#9FB9E8]"}`}
                  >
                    <span className="block font-semibold">{option.label}</span>
                    <span className="mt-0.5 block text-[10px] leading-4 text-[#98A2B3]">{option.detail}</span>
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

            <TopicTagSelector value={form.focus_tags} onChange={(value) => update("focus_tags", value)} />

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

            <div>
              <FieldLabel htmlFor="custom-intelligence-extra-focus" hint="可选">额外关注</FieldLabel>
              <textarea id="custom-intelligence-extra-focus" value={form.extra_focus} onChange={(event) => update("extra_focus", event.target.value)} rows={2} maxLength={600} placeholder="例如：请特别关注对分支机构客户运营的影响。" className="w-full resize-y rounded-md border border-[#D0D5DD] bg-white px-3 py-2.5 text-sm leading-6 text-[#172033] outline-none transition focus:border-[#4F7CFF] focus:ring-2 focus:ring-[#4F7CFF]/15" />
            </div>
          </div>

          <div className="mt-5 space-y-3 border-t border-[#E4EAF2] pt-4">
            {!serviceAvailable && !optionsLoading && <p className="rounded-md bg-amber-50 px-3 py-2 text-[11px] leading-5 text-amber-800">情报搜索服务暂不可用，请联系管理员。</p>}
            <button type="submit" disabled={disabled} className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-[#2563EB] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#1D4ED8] disabled:cursor-not-allowed disabled:opacity-50">
              {activeExecutionId !== null ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Play className="size-4" aria-hidden="true" />}
              {activeExecutionId !== null ? "正在生成报告…" : "生成报告"}
            </button>
            <button type="button" onClick={onSaveCurrentConfig} disabled={!form.focus.trim()} className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-[#C8D7F0] bg-white px-3 py-2 text-xs font-semibold text-[#315EA8] hover:bg-[#EEF4FF] disabled:cursor-not-allowed disabled:opacity-50">
              <Bookmark className="size-3.5" aria-hidden="true" />保存为我的助手
            </button>
          </div>
        </form>
      </div>
      {workspaceMode && <div className="ci-panel-in min-w-0 flex-1">{children}</div>}
    </div>
  );
}
