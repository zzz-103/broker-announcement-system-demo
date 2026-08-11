"use client";

import * as React from "react";
import { Bookmark, ChevronUp, Loader2, PencilLine, Play, RefreshCw, Sparkles } from "lucide-react";
import { HoverSelect } from "@/components/hover-select";
import type { IntelligenceAssistantRequest, IntelligenceAssistantTopic } from "@/lib/api/contracts";
import {
  AUDIENCE_OPTIONS,
  AUDIENCE_RESEARCH_SUGGESTIONS,
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

function AudienceSuggestions({
  audience,
  focus,
  onApply,
}: {
  audience: IntelligenceAssistantRequest["audience"];
  focus: string;
  onApply: (value: string) => void;
}) {
  const suggestions = AUDIENCE_RESEARCH_SUGGESTIONS[audience] ?? [];
  const [groupIndex, setGroupIndex] = React.useState(0);
  const [message, setMessage] = React.useState("");
  const [systemSuggestion, setSystemSuggestion] = React.useState<string | null>(null);
  const previousAudienceRef = React.useRef(audience);
  const focusRef = React.useRef(focus);
  const systemSuggestionRef = React.useRef<string | null>(null);
  const onApplyRef = React.useRef(onApply);

  React.useEffect(() => {
    focusRef.current = focus;
  }, [focus]);

  React.useEffect(() => {
    systemSuggestionRef.current = systemSuggestion;
  }, [systemSuggestion]);

  React.useEffect(() => {
    onApplyRef.current = onApply;
  }, [onApply]);

  React.useEffect(() => {
    setGroupIndex(0);
    setMessage("");
    if (previousAudienceRef.current === audience) return;
    previousAudienceRef.current = audience;

    // Only remove the line that this component inserted. A matching line typed
    // by the user is intentionally left untouched.
    const inserted = systemSuggestionRef.current;
    if (!inserted) return;
    const currentFocus = focusRef.current;
    const nextFocus = removeExactLine(currentFocus, inserted);
    if (nextFocus !== currentFocus) onApplyRef.current(nextFocus);
    systemSuggestionRef.current = null;
    setSystemSuggestion(null);
  }, [audience]);

  if (!suggestions.length) return null;
  const groupCount = Math.ceil(suggestions.length / 2);
  const start = (groupIndex % groupCount) * 2;
  const visible = suggestions.slice(start, start + 2);
  const focusLines = new Set(focus.split("\n").map((item) => item.trim()).filter(Boolean));

  const apply = (suggestion: string) => {
    const currentFocus = focus;
    const inserted = systemSuggestionRef.current;
    const withoutInserted = inserted ? removeExactLine(currentFocus, inserted) : currentFocus;
    if (inserted === suggestion && withoutInserted === currentFocus) {
      setMessage("这条关注方向已经添加。");
      return;
    }
    if (withoutInserted.split("\n").some((line) => line.trim() === suggestion)) {
      if (withoutInserted !== currentFocus) {
        onApply(withoutInserted);
        systemSuggestionRef.current = null;
        setSystemSuggestion(null);
      }
      setMessage("这条关注方向已经添加。");
      return;
    }
    const next = withoutInserted.trim() ? `${withoutInserted.trimEnd()}\n${suggestion}` : suggestion;
    if (next.length > 1000) {
      setMessage("关注内容已接近 1000 字上限，请先精简后再添加。");
      return;
    }
    onApply(next);
    systemSuggestionRef.current = suggestion;
    setSystemSuggestion(suggestion);
    setMessage("已补充到关注内容。");
  };

  return (
    <div className="rounded-md border border-[#DCE8F8] bg-[#F8FBFF] px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-semibold text-[#315EA8]">根据报告受众推荐</p>
        <button
          type="button"
          onClick={() => {
            setGroupIndex((current) => (current + 1) % groupCount);
            setMessage("");
          }}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-[#667085] hover:text-[#315EA8]"
        >
          <RefreshCw className="size-3" aria-hidden="true" />换一组
        </button>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {visible.map((suggestion) => {
          const added = focusLines.has(suggestion);
          return (
            <button
              key={suggestion}
              type="button"
              disabled={added}
              onClick={() => apply(suggestion)}
              className="rounded-full border border-[#BFD2F3] bg-white px-3 py-1.5 text-left text-[11px] leading-5 text-[#315EA8] transition hover:border-[#7FA3DF] hover:bg-[#EEF4FF] disabled:cursor-default disabled:border-[#DCE8F8] disabled:bg-[#F3F7FD] disabled:text-[#98A2B3]"
            >
              {suggestion}
            </button>
          );
        })}
      </div>
      {message && <p className="mt-1.5 text-[10px] text-[#667085]" role="status" aria-live="polite">{message}</p>}
    </div>
  );
}

function removeExactLine(value: string, target: string): string {
  const lines = value.split(/\r?\n/);
  const index = lines.findIndex((line) => line.trim() === target);
  if (index < 0) return value;
  lines.splice(index, 1);
  return lines.join("\n").replace(/^\n+|\n+$/g, "");
}

function TopicTagSelector({ value, onChange }: { value: string[]; onChange: (value: string[]) => void }) {
  return (
    <fieldset>
      <legend className="mb-1.5 flex w-full items-center justify-between gap-2 text-xs font-semibold text-[#344054]">
        <span>研究侧重点</span><span className="text-[10px] font-normal text-[#98A2B3]">可选 · 作为软偏好 · {value.length}/{FOCUS_TAG_LIMIT}</span>
      </legend>
      <div className="flex flex-wrap gap-1.5" aria-label="研究侧重点快捷标签">
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
    <aside aria-label="本次报告需求" className="rounded-lg border border-[#E4EAF2] bg-white p-4 sm:p-5">
      <div className="flex items-center gap-2">
        <span className="flex size-8 items-center justify-center rounded-lg bg-[#EAF2FF] text-[#2563EB]">
          <Sparkles className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-[#172033]">本次报告需求</h3>
        </div>
      </div>

      <p className="mt-4 line-clamp-3 whitespace-pre-wrap break-words text-sm font-medium leading-6 text-[#344054]">
        {form.focus.trim() || "尚未填写关注内容"}
      </p>

      <div className="mt-3 flex flex-wrap gap-1.5" aria-label="需求范围摘要">
        {[audience, timeRange, reportLength].map((label) => (
          <span key={label} className="rounded-full bg-[#F2F4F7] px-2.5 py-1 text-[10px] font-medium text-[#667085]">
            {label}
          </span>
        ))}
      </div>

      <button
        type="button"
        onClick={onEdit}
        className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-[#C8D7F0] bg-white px-3 py-2 text-xs font-semibold text-[#315EA8] transition-colors hover:bg-[#EEF4FF] active:bg-[#E4EDFC]"
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
  const disabled = activeExecutionId !== null || optionsLoading || !serviceAvailable || !form.focus.trim();
  const showFullForm = !workspaceMode || editingWorkspace;
  return (
    <div className={`flex flex-col gap-4 lg:grid lg:h-full lg:min-h-0 lg:items-stretch lg:transition-[grid-template-columns] lg:duration-300 lg:ease-out motion-reduce:transition-none ${workspaceMode ? showFullForm ? "lg:grid-cols-[minmax(330px,430px)_minmax(0,1fr)]" : "lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[320px_minmax(0,1fr)]" : "lg:grid-cols-1"}`}>
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
              <p className="mt-2 text-xs leading-5 text-[#667085]">填写关注内容与报告范围。</p>
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

            <AudienceSuggestions
              audience={form.audience}
              focus={form.focus}
              onApply={(value) => update("focus", value)}
            />

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
