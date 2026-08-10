"use client";

import * as React from "react";
import { Bookmark, Loader2, Play, Sparkles } from "lucide-react";
import type { IntelligenceAssistantRequest, IntelligenceAssistantTopic } from "@/lib/api/contracts";
import {
  AUDIENCE_OPTIONS,
  FIELD_INPUT_CLASS,
  FOCUS_TAG_LIMIT,
  FOCUS_TAG_OPTIONS,
  REPORT_LENGTH_OPTIONS,
  TIME_RANGE_OPTIONS,
} from "./custom-intelligence-constants";

function FieldLabel({ children, hint, htmlFor }: { children: React.ReactNode; hint?: string; htmlFor?: string }) {
  return (
    <div className="mb-1.5 flex items-center justify-between gap-2">
      <label htmlFor={htmlFor} className="text-xs font-semibold text-[#344054]">{children}</label>
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
      <p className="mt-1.5 text-[10px] text-[#98A2B3]">最多选择 3 个；具体问题请直接写在自然语言描述中。</p>
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
                <h3 className="text-base font-semibold text-[#172033]">{workspaceMode ? "调整这次提问" : "告诉我你想知道什么"}</h3>
              </div>
              <p className="mt-2 text-xs leading-5 text-[#667085]">用一句业务问题开始，助手会自动检索公开资料并整理成可读报告。</p>
            </div>
            {workspaceMode && (
              <button type="button" onClick={onResetWorkspace} className="shrink-0 rounded-md border border-[#D0D5DD] px-2.5 py-1.5 text-[11px] font-semibold text-[#475467] hover:bg-[#F8FAFD]">新问题</button>
            )}
          </div>

          {topics.length > 0 && (
            <div className="mb-4">
              <FieldLabel htmlFor="custom-intelligence-assistant-picker">我的助手</FieldLabel>
              <select id="custom-intelligence-assistant-picker" value={selectedConfigId === null ? "none" : String(selectedConfigId)} onChange={(event) => onApplyConfig(event.target.value)} className={FIELD_INPUT_CLASS}>
                <option value="none">不使用已保存助手</option>
                {topics.map((topic) => <option key={topic.id} value={topic.id}>{topic.name}</option>)}
              </select>
              {selectedAssistant && <p className="mt-1 text-[10px] text-[#98A2B3]">已载入「{selectedAssistant.name}」，可以临时修改。</p>}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <FieldLabel htmlFor="custom-intelligence-focus" hint="必填">我想了解</FieldLabel>
              <textarea
                id="custom-intelligence-focus"
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

            <fieldset>
              <legend className="mb-1.5 text-xs font-semibold text-[#344054]">给谁看</legend>
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
                <FieldLabel htmlFor="custom-intelligence-audience-detail" hint="必填">自定义读者背景</FieldLabel>
                <input id="custom-intelligence-audience-detail" value={form.audience_detail} onChange={(event) => update("audience_detail", event.target.value)} maxLength={240} placeholder="例如：面向分公司负责人，关注可执行动作" className={FIELD_INPUT_CLASS} />
              </div>
            )}

            <TopicTagSelector value={form.focus_tags} onChange={(value) => update("focus_tags", value)} />

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <FieldLabel htmlFor="custom-intelligence-time-range">时间范围</FieldLabel>
                <select id="custom-intelligence-time-range" value={form.time_range} onChange={(event) => update("time_range", event.target.value as IntelligenceAssistantRequest["time_range"])} className={FIELD_INPUT_CLASS}>
                  {TIME_RANGE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </div>
              <div>
                <FieldLabel htmlFor="custom-intelligence-report-length">报告篇幅</FieldLabel>
                <select id="custom-intelligence-report-length" value={form.report_length} onChange={(event) => update("report_length", event.target.value as IntelligenceAssistantRequest["report_length"])} className={FIELD_INPUT_CLASS}>
                  {REPORT_LENGTH_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label} · {option.detail}</option>)}
                </select>
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
