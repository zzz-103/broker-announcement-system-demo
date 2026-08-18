import type {
  IntelligenceAssistantAudience,
  IntelligenceAssistantRequest,
  IntelligenceReportLength,
  IntelligenceTimeRange,
} from "@/lib/api/contracts";

export const TOPIC_LIMIT = 10;
export const EXECUTIONS_PAGE_SIZE = 10;
export const FOCUS_TAG_LIMIT = 8;

export const DEFAULT_FORM: IntelligenceAssistantRequest = {
  audience: "management",
  audience_detail: "",
  focus_tags: [],
  focus: "",
  extra_focus: "",
  time_range: "month",
  report_length: "concise",
};

export const AUDIENCE_OPTIONS: readonly { value: IntelligenceAssistantAudience; label: string; detail: string }[] = [
  { value: "management", label: "管理层", detail: "行业趋势、竞争格局与战略机会" },
  { value: "wealth_management", label: "财富管理", detail: "客户、产品、投顾与渠道经营" },
  { value: "investment_banking", label: "投行业务", detail: "股债融资、并购与监管动态" },
  { value: "institutional_business", label: "机构业务", detail: "机构客户、交易服务与协同机会" },
  { value: "asset_management", label: "资产管理", detail: "产品、规模、策略与资管监管" },
  { value: "proprietary_investment", label: "自营投资", detail: "大类配置、策略表现与风险敞口" },
  { value: "research_business", label: "研究业务", detail: "研究趋势、客户需求与服务模式" },
  { value: "fintech_operations", label: "金融科技 / 运营", detail: "数字化能力、流程与运营效率" },
  { value: "compliance_risk", label: "合规风控", detail: "监管政策、风险信号与内控应对" },
  { value: "custom", label: "自定义", detail: "补充具体读者背景" },
];

export const AUDIENCE_RESEARCH_SUGGESTIONS: Partial<Record<IntelligenceAssistantAudience, readonly string[]>> = {
  management: [
    "行业趋势与增长驱动", "竞争格局与市场份额", "监管政策与经营影响", "战略机会与进入时点",
    "收入结构与盈利能力", "重点同业战略动作", "组织能力与资源配置", "关键风险与决策事项",
  ],
  wealth_management: [
    "客户分层与需求变化", "财富产品与产品货架", "投顾服务与买方转型", "渠道经营与线上增长",
    "高净值客户服务", "客户运营与转化提升", "同业财富业务对标", "适当性与销售合规",
  ],
  investment_banking: [
    "IPO 审核与发行动态", "再融资与资本市场政策", "债券承销与信用风险", "并购重组与产业整合",
    "项目储备与行业机会", "监管问询与执业质量", "投行同业竞争格局", "定价承销与项目执行",
  ],
  institutional_business: [
    "机构客户需求变化", "交易服务与主经纪商", "研究销售与客户覆盖", "衍生品与风险管理服务",
    "托管外包与运营服务", "跨境机构业务机会", "协同获客与综合服务", "机构业务合规动态",
  ],
  asset_management: [
    "产品布局与发行趋势", "管理规模与资金流向", "投资策略与业绩表现", "渠道合作与客户结构",
    "公募化与主动管理转型", "资管同业竞争格局", "资管监管与产品合规", "投研体系与能力建设",
  ],
  proprietary_investment: [
    "大类资产配置", "权益与固收策略", "衍生品及对冲工具", "市场风险与敞口管理",
    "收益表现与波动归因", "流动性与信用风险", "量化交易与策略迭代", "资本约束与监管指标",
  ],
  research_business: [
    "宏观与行业趋势", "重点赛道与公司研究", "机构客户研究需求", "研究产品与服务创新",
    "研究销售与佣金模式", "数据工具与智能研究", "同业研究能力对标", "合规边界与声誉风险",
  ],
  fintech_operations: [
    "AI 与智能化应用", "核心系统与技术架构", "数据治理与数据资产", "客户运营与流程优化",
    "研发效能与成本管理", "信息安全与业务连续性", "供应商与国产化替代", "运营质量与服务体验",
  ],
  compliance_risk: [
    "最新监管政策与解读", "处罚案例与监管关注点", "业务合规与适当性管理", "市场与信用风险",
    "操作风险与内控机制", "数据安全与隐私保护", "反洗钱与异常交易", "风险预警与整改跟踪",
  ],
  custom: [
    "行业趋势", "竞争格局", "客户需求", "产品与服务", "经营成效", "监管政策", "技术与运营", "风险与机会",
  ],
};

export const TIME_RANGE_OPTIONS: readonly { value: IntelligenceTimeRange; label: string }[] = [
  { value: "week", label: "最近 7 天" },
  { value: "month", label: "最近 30 天" },
  { value: "semiyear", label: "最近 180 天" },
  { value: "year", label: "最近 365 天" },
];

export const REPORT_LENGTH_OPTIONS: readonly { value: IntelligenceReportLength; label: string; detail: string }[] = [
  { value: "concise", label: "标准", detail: "重点结论清晰，约 3 分钟读完" },
  { value: "standard", label: "深度", detail: "完整结论、动态、影响与建议" },
];

export const AUDIENCE_LABEL: Record<string, string> = Object.fromEntries(
  AUDIENCE_OPTIONS.map((option) => [option.value, option.label]),
);
Object.assign(AUDIENCE_LABEL, {
  business_product: "业务 / 产品",
  technology: "技术",
  industry_research: "行业研究",
});
export const TIME_RANGE_LABEL: Record<string, string> = Object.fromEntries(
  TIME_RANGE_OPTIONS.map((option) => [option.value, option.label]),
);
export const REPORT_LENGTH_LABEL: Record<string, string> = Object.fromEntries(
  REPORT_LENGTH_OPTIONS.map((option) => [option.value, option.label]),
);
REPORT_LENGTH_LABEL.deep = "深度（历史超长）";

export const FIELD_INPUT_CLASS =
  "w-full rounded-md border border-[#D0D5DD] bg-white px-3 py-2.5 text-sm text-[#172033] outline-none transition placeholder:text-[#98A2B3] focus:border-[#4F7CFF] focus:ring-2 focus:ring-[#4F7CFF]/15";
export const REPORT_HEADING_CLASS = "mb-3 text-base font-bold tracking-tight text-[#172033]";
export const REPORT_PROSE_CLASS = "max-w-[52rem] whitespace-pre-wrap break-words text-[15px] leading-[1.9] text-[#344054]";
