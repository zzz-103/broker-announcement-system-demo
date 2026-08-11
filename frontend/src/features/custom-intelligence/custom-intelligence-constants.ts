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

export const AUDIENCE_RESEARCH_SUGGESTIONS: Partial<Record<IntelligenceAssistantAudience, readonly string[]>> = {
  management: [
    "行业增长驱动与未来 12 个月关键变量",
    "主要券商战略动作与差异化路径",
    "对收入结构和利润率的潜在影响",
    "监管变化对经营优先级的影响",
    "可规模化新业务机会与进入时点",
    "重点竞争对手资源投入与成效",
    "高价值客群需求变化与机会",
    "关键风险、预警信号与应对顺序",
    "合作、投资或并购机会",
    "未来 90 天可验证的决策事项",
    "标杆案例的可复制条件",
    "技术趋势对组织与能力建设的影响",
  ],
  business_product: [
    "客户痛点与未满足需求",
    "主流产品功能与服务模式对比",
    "定价收费与商业模式变化",
    "用户增长、转化与活跃提升路径",
    "高价值客群与细分场景机会",
    "标杆券商产品上线与运营成效",
    "竞争差异化与价值主张",
    "渠道生态与合作伙伴机会",
    "产品合规边界与上线约束",
    "MVP 范围与迭代优先级",
    "运营流程与服务体验优化",
    "未来季度需求验证指标",
  ],
  technology: [
    "技术架构演进与关键组件",
    "自研、采购与联合建设比较",
    "标杆技术架构与落地案例",
    "数据治理与知识库质量",
    "大模型与 Agent 评估指标",
    "安全权限与审计留痕",
    "稳定性、性能与推理成本",
    "遗留系统集成与改造难点",
    "供应商能力与锁定风险",
    "私有化部署与国产化适配",
    "工程团队与运维能力建设",
    "PoC 到生产规模化条件",
  ],
  compliance_risk: [
    "最新监管规则与业务影响",
    "处罚案例与监管关注点",
    "数据使用与个人信息保护边界",
    "AI 模型治理、可解释性与问责",
    "投资顾问适当性管理要求",
    "信息披露与营销宣传合规",
    "第三方合作与供应商风险",
    "跨境业务与数据出境要求",
    "审计留痕与责任归属",
    "操作风险、欺诈与舆情信号",
    "风险指标与预警机制",
    "业务上线前合规核查要点",
  ],
  industry_research: [
    "市场规模与增长驱动",
    "竞争格局与市场份额变化",
    "主要机构战略与资源投入对比",
    "业务模式与收入结构演进",
    "客户结构与需求变化",
    "政策监管演进及行业影响",
    "技术创新与应用成熟度",
    "投融资、合作与并购动态",
    "国内外标杆机构对比",
    "关键供应商与产业生态",
    "成功案例与失败教训",
    "未来 6-12 个月趋势与不确定性",
  ],
};

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
export const REPORT_HEADING_CLASS = "mb-3 text-base font-bold tracking-tight text-[#172033]";
export const REPORT_PROSE_CLASS = "max-w-[52rem] whitespace-pre-wrap break-words text-[15px] leading-[1.9] text-[#344054]";
