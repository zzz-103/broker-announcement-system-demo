import type {
  IntelligenceAssistantAudience,
  IntelligenceAssistantRequest,
  IntelligenceReportLength,
  IntelligenceTimeRange,
} from "@/lib/api/contracts";

export const TOPIC_LIMIT = 10;
export const EXECUTIONS_PAGE_SIZE = 10;
export const FOCUS_TAG_LIMIT = 3;
export const FOCUS_TAG_OPTIONS = [
  "财富管理",
  "AI 与智能投顾",
  "数字化转型",
  "同业竞争",
  "客户运营",
  "机构业务",
  "监管政策",
  "合规与风险",
] as const;

export const DEFAULT_FORM: IntelligenceAssistantRequest = {
  audience: "management",
  audience_detail: "",
  focus_tags: [],
  focus: "",
  extra_focus: "",
  time_range: "month",
  report_length: "standard",
};

export const AUDIENCE_OPTIONS: readonly { value: IntelligenceAssistantAudience; label: string; detail: string }[] = [
  { value: "management", label: "管理层", detail: "结论先行，突出影响与决策动作" },
  { value: "business_product", label: "业务 / 产品", detail: "关注市场变化、客户与产品机会" },
  { value: "technology", label: "技术", detail: "关注技术路线、实施案例与能力建设" },
  { value: "compliance_risk", label: "合规风控", detail: "关注政策、风险信号与应对事项" },
  { value: "industry_research", label: "行业研究", detail: "关注行业趋势、机构案例与竞争格局" },
  { value: "custom", label: "自定义", detail: "在下方补充具体读者背景" },
];

export const TIME_RANGE_OPTIONS: readonly { value: IntelligenceTimeRange; label: string }[] = [
  { value: "week", label: "最近 7 天" },
  { value: "month", label: "最近 30 天" },
  { value: "semiyear", label: "最近 180 天" },
  { value: "year", label: "最近 365 天" },
];

export const REPORT_LENGTH_OPTIONS: readonly { value: IntelligenceReportLength; label: string; detail: string }[] = [
  { value: "concise", label: "简报", detail: "约 3 分钟读完" },
  { value: "standard", label: "标准", detail: "完整结论、动态与建议" },
  { value: "deep", label: "深度", detail: "更多案例和来源核验" },
];

export const AUDIENCE_LABEL: Record<string, string> = Object.fromEntries(
  AUDIENCE_OPTIONS.map((option) => [option.value, option.label]),
);
export const TIME_RANGE_LABEL: Record<string, string> = Object.fromEntries(
  TIME_RANGE_OPTIONS.map((option) => [option.value, option.label]),
);
export const REPORT_LENGTH_LABEL: Record<string, string> = Object.fromEntries(
  REPORT_LENGTH_OPTIONS.map((option) => [option.value, option.label]),
);

export const FIELD_INPUT_CLASS =
  "w-full rounded-md border border-[#D0D5DD] bg-white px-3 py-2.5 text-sm text-[#172033] outline-none transition placeholder:text-[#98A2B3] focus:border-[#4F7CFF] focus:ring-2 focus:ring-[#4F7CFF]/15";
export const REPORT_HEADING_CLASS = "mb-3 text-[15px] font-bold tracking-tight text-[#172033]";
export const REPORT_PROSE_CLASS = "max-w-[52rem] whitespace-pre-wrap break-words text-[15px] leading-[1.9] text-[#344054]";
