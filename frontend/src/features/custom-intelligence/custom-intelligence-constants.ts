import type {
  CustomIntelligenceOptionsResponse,
  InstantSearchRequest,
} from "@/lib/api/contracts";

export const TOPIC_LIMIT = 10;
export const EXECUTIONS_PAGE_SIZE = 10;
export const EXPORT_PAGE_SIZE = 50;

export const DEFAULT_FORM: InstantSearchRequest = {
  question: "",
  description: "",
  keywords: [],
  focus_objects: [],
  analysis_perspective: "industry_research",
  time_range: "month",
  source_preference: "balanced",
  specified_sites: [],
  report_type: "industry_trends",
  analysis_depth: "standard",
  extra_requirements: "",
};

export const FALLBACK_OPTIONS: CustomIntelligenceOptionsResponse = {
  perspectives: [
    { value: "management", label: "管理层视角" },
    { value: "product_business", label: "产品与业务视角" },
    { value: "technology", label: "技术视角" },
    { value: "compliance_risk", label: "合规与风险视角" },
    { value: "industry_research", label: "行业研究视角" },
  ],
  time_ranges: [
    { value: "week", label: "最近 7 天" },
    { value: "month", label: "最近 30 天" },
    { value: "semiyear", label: "最近 180 天" },
    { value: "year", label: "最近 365 天" },
  ],
  report_types: [
    { value: "management_brief", label: "管理层简报" },
    { value: "competitive_analysis", label: "竞争分析" },
    { value: "industry_trends", label: "行业动态" },
    { value: "risk_monitoring", label: "风险监控" },
  ],
  analysis_depths: [
    { value: "concise", label: "简洁" },
    { value: "standard", label: "标准" },
    { value: "deep", label: "深入" },
  ],
  source_preferences: [
    { value: "authoritative", label: "权威来源优先" },
    { value: "balanced", label: "综合平衡" },
    { value: "news", label: "新闻与公告优先" },
    { value: "research", label: "研究资料优先" },
  ],
  preset_questions: [],
  service_configured: false,
  service_enabled: false,
  service_status: "not_configured",
  deep_search_enabled: false,
  analysis_configured: false,
  analysis_service_status: "not_configured",
};

export const FIELD_INPUT_CLASS = "w-full rounded-md border border-[#D0D5DD] bg-white px-3 py-2.5 text-sm text-[#172033] outline-none transition placeholder:text-[#98A2B3] focus:border-[#4F7CFF] focus:ring-2 focus:ring-[#4F7CFF]/15";
export const REPORT_HEADING_CLASS = "mb-3 text-[15px] font-bold tracking-tight text-[#172033]";
export const REPORT_PROSE_CLASS = "max-w-[46rem] whitespace-pre-wrap break-words text-[15px] leading-[1.9] text-[#344054]";
