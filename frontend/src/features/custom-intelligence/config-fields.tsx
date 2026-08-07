"use client";

import { ChevronDown, X } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { HoverSelect } from "@/components/hover-select";
import type {
  CustomIntelligenceOptionsResponse,
  IntelligenceAnalysisDepth,
  IntelligencePerspective,
  IntelligenceReportType,
  IntelligenceSourcePreference,
  IntelligenceTimeRange,
  IntelligenceTopic,
  InstantSearchRequest,
} from "@/lib/api/contracts";
import { FIELD_INPUT_CLASS, TOPIC_LIMIT } from "./custom-intelligence-constants";

export function FieldLabel({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="mb-1.5 flex items-center justify-between gap-2">
      <label className="text-xs font-semibold text-[#344054]">{children}</label>
      {hint && <span className="text-[10px] text-[#98A2B3]">{hint}</span>}
    </div>
  );
}

function TagEditor({
  label,
  values,
  placeholder,
  onChange,
  hint,
}: {
  label: string;
  values: string[];
  placeholder: string;
  onChange: (values: string[]) => void;
  hint?: string;
}) {
  const [draft, setDraft] = useState("");
  const add = useCallback(() => {
    const value = draft.trim();
    if (!value || values.includes(value)) {
      setDraft("");
      return;
    }
    onChange([...values, value]);
    setDraft("");
  }, [draft, onChange, values]);
  return (
    <div>
      <FieldLabel hint={hint}>{label}</FieldLabel>
      <div className="min-h-10 rounded-md border border-[#D0D5DD] bg-white px-2 py-1.5 focus-within:border-[#4F7CFF] focus-within:ring-2 focus-within:ring-[#4F7CFF]/10">
        <div className="flex flex-wrap gap-1.5">
          {values.map((value) => (
            <span key={value} className="inline-flex max-w-full items-center gap-1 rounded-md bg-[#EEF4FF] px-2 py-1 text-[11px] font-medium text-[#315EA8]">
              <span className="truncate">{value}</span>
              <button type="button" onClick={() => onChange(values.filter((item) => item !== value))} className="rounded p-0.5 text-[#6B8BC7] hover:bg-[#DCE8FF] hover:text-[#1D4ED8]" aria-label={`移除${value}`}>
                <X className="size-3" />
              </button>
            </span>
          ))}
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === "," || event.key === "，") {
                event.preventDefault();
                add();
              }
            }}
            onBlur={add}
            placeholder={values.length ? "继续添加…" : placeholder}
            className="min-w-[120px] flex-1 border-0 bg-transparent px-1 py-1 text-xs text-[#172033] outline-none placeholder:text-[#98A2B3]"
          />
        </div>
      </div>
      <p className="mt-1 text-[10px] text-[#98A2B3]">按 Enter 添加，可重复点击标签右侧删除。</p>
    </div>
  );
}

export function ConfigFields({
  value,
  onChange,
  options,
  showQuestion = true,
  advancedDefaultOpen = false,
  compact = false,
}: {
  value: InstantSearchRequest;
  onChange: (value: InstantSearchRequest) => void;
  options: CustomIntelligenceOptionsResponse;
  showQuestion?: boolean;
  advancedDefaultOpen?: boolean;
  compact?: boolean;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(advancedDefaultOpen);
  const update = <K extends keyof InstantSearchRequest>(key: K, next: InstantSearchRequest[K]) => {
    onChange({ ...value, [key]: next });
  };
  const recommendedQuestions = options.preset_questions.filter(
    (preset) => preset.analysis_perspective === value.analysis_perspective,
  );
  return (
    <div className="space-y-4">
      {showQuestion && (
        <div>
          <FieldLabel hint="必填">业务问题</FieldLabel>
          <textarea
            id="custom-intelligence-question"
            value={value.question}
            onChange={(event) => update("question", event.target.value)}
            rows={compact ? 2 : 3}
            maxLength={1000}
            placeholder="例如：近期券商财富管理业务的竞争变化和潜在机会有哪些？"
            className="w-full resize-y rounded-md border border-[#D0D5DD] bg-white px-3 py-2.5 text-sm leading-6 text-[#172033] outline-none transition focus:border-[#4F7CFF] focus:ring-2 focus:ring-[#4F7CFF]/15"
          />
          <div className="mt-1 text-right text-[10px] text-[#98A2B3]">{value.question.length}/1000</div>
          {!compact && (
            <div className="mt-3">
              <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-[#475467]">
                常用查询
              </div>
              {recommendedQuestions.length ? (
                <div className="flex flex-wrap gap-2">
                  {recommendedQuestions.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => onChange({
                        ...value,
                        question: preset.question,
                        report_type: preset.report_type,
                      })}
                      className="max-w-full rounded-md border border-[#E4EAF2] bg-[#F8FAFC] px-3 py-2 text-left text-[11px] leading-5 text-[#475467] transition hover:border-[#9FB9E8] hover:bg-[#EEF4FF] hover:text-[#315EA8]"
                      title={preset.question}
                    >
                      <span className="font-semibold text-[#315EA8]">{preset.title}</span>
                      <span className="ml-1.5">{preset.question}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-[#98A2B3]">当前角度暂无常用查询。</p>
              )}
            </div>
          )}
        </div>
      )}
      <div className={`grid gap-4 ${compact ? "grid-cols-1" : "md:grid-cols-2"}`}>
        <div>
          <FieldLabel>分析角度</FieldLabel>
          <HoverSelect
            value={value.analysis_perspective}
            onChange={(next) => update("analysis_perspective", next as IntelligencePerspective)}
            options={options.perspectives}
            className="w-full"
          />
        </div>
        <div>
          <FieldLabel>时间范围</FieldLabel>
          <HoverSelect
            value={value.time_range}
            onChange={(next) => update("time_range", next as IntelligenceTimeRange)}
            options={options.time_ranges}
            className="w-full"
          />
        </div>
      </div>
      <details
        open={advancedOpen}
        onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
        className="group rounded-lg border border-[#E4EAF2] bg-[#F8FAFD] px-3.5 py-3"
      >
        <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-semibold text-[#344054]">
          <span className="inline-flex items-center gap-1.5"><ChevronDown className="size-4 transition group-open:rotate-180" />高级设置</span>
          <span className="text-[10px] font-normal text-[#98A2B3]">报告、来源、关键词等</span>
        </summary>
        <div className="mt-3 space-y-4 border-t border-[#E4EAF2] pt-3">
          <div className={`grid gap-4 ${compact ? "grid-cols-1 sm:grid-cols-2" : "md:grid-cols-3"}`}>
            <div>
              <FieldLabel>报告类型</FieldLabel>
              <HoverSelect
                value={value.report_type}
                onChange={(next) => update("report_type", next as IntelligenceReportType)}
                options={options.report_types}
                className="w-full"
              />
            </div>
            <div>
              <FieldLabel>分析深度</FieldLabel>
              <HoverSelect
                value={value.analysis_depth}
                onChange={(next) => update("analysis_depth", next as IntelligenceAnalysisDepth)}
                options={options.analysis_depths}
                className="w-full"
              />
            </div>
            <div>
              <FieldLabel>来源偏好</FieldLabel>
              <HoverSelect
                value={value.source_preference}
                onChange={(next) => update("source_preference", next as IntelligenceSourcePreference)}
                options={options.source_preferences}
                className="w-full"
              />
            </div>
          </div>
          <div>
            <FieldLabel hint="可选">业务背景</FieldLabel>
            <input value={value.description} onChange={(event) => update("description", event.target.value)} maxLength={2000} placeholder="补充业务背景、判断边界或关注原因" className={FIELD_INPUT_CLASS} />
          </div>
          <div className={`grid gap-4 ${compact ? "grid-cols-1" : "lg:grid-cols-2"}`}>
            <TagEditor label="检索关键词" values={value.keywords} onChange={(next) => update("keywords", next)} placeholder="例如：财富管理" />
            <TagEditor label="关注对象" values={value.focus_objects} onChange={(next) => update("focus_objects", next)} placeholder="例如：头部券商、投顾团队" />
          </div>
          <TagEditor label="指定站点" values={value.specified_sites} onChange={(next) => update("specified_sites", next)} placeholder="例如：csrc.gov.cn" hint="仅填写域名；提交时再次校验" />
          <div>
            <FieldLabel hint="可选">补充要求</FieldLabel>
            <textarea value={value.extra_requirements} onChange={(event) => update("extra_requirements", event.target.value)} rows={3} maxLength={2000} placeholder="例如：结论要区分已发生事实与推测，并给出可执行的跟进建议。" className="w-full resize-y rounded-md border border-[#D0D5DD] bg-white px-3 py-2.5 text-sm leading-6 text-[#172033] outline-none transition focus:border-[#4F7CFF] focus:ring-2 focus:ring-[#4F7CFF]/15" />
          </div>
        </div>
      </details>
    </div>
  );
}

export function SavedConfigPicker({
  topics,
  selectedId,
  onSelect,
}: {
  topics: IntelligenceTopic[];
  selectedId: number | null;
  onSelect: (value: string) => void;
}) {
  const selectOptions = useMemo(
    () => [
      { value: "none", label: "不使用已保存配置" },
      ...topics.map((topic) => ({ value: String(topic.id), label: topic.name })),
    ],
    [topics],
  );
  return (
    <div>
      <FieldLabel hint={topics.length ? `${topics.length}/${TOPIC_LIMIT}` : `最多 ${TOPIC_LIMIT} 个`}>已保存配置</FieldLabel>
      {topics.length ? (
        <HoverSelect
          value={selectedId === null ? "none" : String(selectedId)}
          onChange={onSelect}
          options={selectOptions}
          className="w-full"
        />
      ) : (
        <p className="rounded-md border border-dashed border-[#D0D5DD] bg-[#FAFBFC] px-3 py-2.5 text-xs text-[#98A2B3]">
          暂无已保存配置，可在下方“保存当前配置”。
        </p>
      )}
    </div>
  );
}
