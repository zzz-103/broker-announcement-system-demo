import {
  BackendApiError,
  fetchAnnouncements,
} from "@/lib/api/backend-client";

// ─── Raw CSV row ───
interface RawCsvRow {
  broker_folder?: string;
  markdown_file?: string;
  document_sha1?: string;
  processed_at?: string;
  raw_json_path?: string;
  broker_name?: string;
  is_broker_project?: string;
  publish_date?: string;
  announcement_stage?: string;
  procurement_category?: string;
  project_subcategory?: string;
  project_name?: string;
  procurement_method?: string;
  budget_amount_yuan?: string;
  winning_supplier?: string;
  winning_amount_yuan?: string;
  winner?: string;
  winner_candidates?: string;
  winning_amount?: string;
  source?: string;
  data_source?: string;
}

export class DataNotGeneratedError extends Error {
  constructor() {
    super("尚未生成看板数据，请先运行爬虫和 LLM。");
    this.name = "DataNotGeneratedError";
  }
}

// ─── Processed record ───
export interface ProcessedRecord {
  // raw fields
  broker_folder: string;
  markdown_file: string;
  document_sha1: string;
  processed_at: string;
  raw_json_path: string;
  is_broker_project: boolean | null;
  announcement_stage: string;
  project_name_raw: string;
  procurement_method: string;
  budget_amount_yuan: number | null;
  winning_amount_yuan: number | null;
  display_amount_yuan: number | null;
  display_amount_kind: "winning" | "budget" | null;
  sourceName: string;

  // derived fields
  validBrokerName: string;
  validPublishDate: Date | null;
  normalizedProjectName: string;
  projectKey: string;
  normalizedSupplier: string;
  amountSampleKey: string | null;
  primaryDomain: string;
  topicTags: string[];
  isFinTech: boolean;
}

export const SUPPORTED_SOURCES = ["金采网"] as const;

export interface BrokerActivityDistribution {
  high: number;
  medium: number;
  low: number;
}

export interface DashboardStatistics {
  brokerCount: number;
  brokerNames: string[];
  brokerActivity: BrokerActivityDistribution;
  sources: string[];
  sourceCount: number;
  institutionBreakdown: null;
}

export interface LoadedAnnouncementData {
  records: ProcessedRecord[];
  updatedAt: string | null;
}

// ─── Domain classification ───
const DOMAIN_RULES: { domain: string; keywords: string[] }[] = [
  {
    domain: "AI与智能化",
    keywords: [
      "AI", "AIGC", "大模型", "智能体", "人工智能", "机器学习", "知识库",
      "智能客服", "语音识别", "OCR", "智能投研", "智能问答", "智能运营",
    ],
  },
  {
    domain: "数据治理与数据平台",
    keywords: [
      "数据治理", "数据仓库", "数据中台", "数据平台", "湖仓", "数据湖",
      "指标平台", "主数据", "元数据", "数据质量", "数据资产", "数据集市",
      "BI", "驾驶舱", "实时数据", "数据交换",
    ],
  },
  {
    domain: "财富管理与客户经营",
    keywords: [
      "财富管理", "财富CRM", "CRM", "客户画像", "客户运营", "营销平台",
      "精准营销", "投顾平台", "产品销售", "客户服务",
    ],
  },
  {
    domain: "APP与数字化渠道",
    keywords: [
      "APP", "移动端", "手机证券", "鸿蒙", "小程序", "互联网金融",
      "网上交易", "客户端", "数字渠道", "移动应用",
    ],
  },
  {
    domain: "交易、柜台与核心系统",
    keywords: [
      "交易系统", "核心交易", "柜台", "集中交易", "极速交易", "两融",
      "融资融券", "期权", "清算", "结算", "估值", "登记结算", "法人清算",
      "行情交易", "OMS", "订单管理",
    ],
  },
  {
    domain: "网络安全与监管科技",
    keywords: [
      "信息安全", "网络安全", "数据安全", "防火墙", "态势感知", "漏洞",
      "渗透测试", "终端安全", "反洗钱", "监管报送", "风险管理", "合规管理",
      "灾备", "容灾",
    ],
  },
  {
    domain: "云计算、算力与基础设施",
    keywords: [
      "服务器", "存储", "算力", "云平台", "云计算", "容器", "虚拟化",
      "数据库", "操作系统", "交换机", "路由器", "网络设备", "机房", "备份",
      "硬件设备",
    ],
  },
  {
    domain: "IT运维与技术服务",
    keywords: [
      "运维", "维保", "驻场", "技术支持", "技术服务", "开发外包",
      "人员外包", "系统维护", "续保", "续采",
    ],
  },
  {
    domain: "投研资讯与金融数据",
    keywords: [
      "Wind", "同花顺", "金融数据", "行情数据", "资讯服务", "研报",
      "投研数据", "舆情", "数据终端", "资讯终端",
    ],
  },
];

const NON_FINTECH_KEYWORDS = [
  "工程装修", "物业", "办公用品", "员工活动", "租赁", "法律服务",
  "审计服务", "行政采购", "装修", "保洁", "安保", "餐饮", "车辆",
  "驾驶", "印刷", "广告制作",
];

const TAG_RULES: { tag: string; keywords: string[] }[] = [
  { tag: "信创", keywords: ["信创", "国产化", "国产", "自主可控", "适配"] },
  { tag: "AI", keywords: ["AI", "AIGC", "大模型", "智能体", "人工智能"] },
  { tag: "数据治理", keywords: ["数据治理", "数据质量", "主数据", "元数据"] },
  { tag: "二期建设", keywords: ["二期", "三期", "四期", "第二阶段"] },
  { tag: "系统升级", keywords: ["升级", "改造", "扩容", "优化"] },
  { tag: "新建", keywords: ["新建", "建设", "构建", "搭建"] },
  { tag: "续采", keywords: ["续采", "续保", "续费", "延续"] },
  { tag: "运维", keywords: ["运维", "维保", "维护", "驻场"] },
  { tag: "软件采购", keywords: ["软件", "License", "授权", "许可"] },
  { tag: "硬件采购", keywords: ["硬件", "服务器", "设备", "采购设备"] },
  { tag: "外包服务", keywords: ["外包", "驻场", "人员外包", "人力外包"] },
];

// ─── Helpers ───
function fullToHalf(str: string): string {
  return str
    .replace(/[\uff01-\uff5e]/g, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) - 0xfee0)
    )
    .replace(/\u3000/g, " ");
}

function normalizeBrackets(str: string): string {
  return str.replace(/\uff08/g, "(").replace(/\uff09/g, ")");
}

const STAGE_SUFFIXES = [
  "采购公告", "招标公告", "结果公告", "结果公示", "中标公告",
  "成交公告", "流标公告", "废标公告", "候选人公示",
];

function stripStageSuffix(name: string): string {
  for (const suffix of STAGE_SUFFIXES) {
    if (name.endsWith(suffix) && name.length > suffix.length) {
      return name.slice(0, name.length - suffix.length);
    }
  }
  return name;
}

function normalizeProjectName(raw: string): string {
  let name = raw.trim();
  name = fullToHalf(name);
  name = normalizeBrackets(name);
  name = name.replace(/\s+/g, " ");
  name = stripStageSuffix(name);
  name = name.trim();
  return name || raw.trim();
}

function normalizeSupplier(raw: string): string {
  let s = raw.trim();
  s = s.replace(/\u3000/g, " ");
  s = s.replace(/\s+/g, " ");
  return s;
}

function candidateSupplierText(raw: string): string {
  const text = raw.trim();
  if (!text) return "";
  try {
    const candidates: unknown = JSON.parse(text);
    if (Array.isArray(candidates)) {
      const names = candidates
        .filter((candidate): candidate is string => typeof candidate === "string")
        .map((candidate) => candidate.trim())
        .filter(Boolean);
      if (names.length > 0) return names.join("、");
    }
  } catch {
    // Keep non-JSON candidate text as supplied by the backend.
  }
  return text;
}

function parsePositiveAmount(raw: string | undefined): number | null {
  const parsed = raw?.trim() ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function classifyDomain(
  projectName: string,
  subcategory: string,
  category: string
): { primaryDomain: string; isFinTech: boolean } {
  const text = `${projectName} ${subcategory} ${category}`;

  // Check non-fintech first for category-based items
  for (const kw of NON_FINTECH_KEYWORDS) {
    if (text.includes(kw)) {
      return { primaryDomain: "非金融科技及其他", isFinTech: false };
    }
  }

  for (const rule of DOMAIN_RULES) {
    for (const kw of rule.keywords) {
      if (text.includes(kw)) {
        return { primaryDomain: rule.domain, isFinTech: true };
      }
    }
  }

  // If procurement_category is IT-related but no keyword matched
  if (category === "IT软硬件") {
    return { primaryDomain: "IT运维与技术服务", isFinTech: true };
  }
  if (category === "专业及金融服务") {
    return { primaryDomain: "非金融科技及其他", isFinTech: false };
  }

  return { primaryDomain: "非金融科技及其他", isFinTech: false };
}

function generateTags(projectName: string, subcategory: string): string[] {
  const text = `${projectName} ${subcategory}`;
  const tags: string[] = [];
  for (const rule of TAG_RULES) {
    for (const kw of rule.keywords) {
      if (text.includes(kw)) {
        tags.push(rule.tag);
        break;
      }
    }
  }
  return tags;
}

function parseDate(raw: string): Date | null {
  if (!raw || !raw.trim()) return null;
  const d = new Date(raw.trim());
  if (isNaN(d.getTime())) return null;
  return d;
}

// ─── Main processing ───
export function processRecords(rawRows: RawCsvRow[]): ProcessedRecord[] {
  return rawRows.map((row) => {
    const brokerNameRaw = row.broker_name?.trim() ?? "";
    const brokerProjectRaw = row.is_broker_project?.trim().toLowerCase() ?? "";
    const isBrokerProject =
      brokerProjectRaw === "true" ? true : brokerProjectRaw === "false" ? false : null;
    const validBrokerName = brokerNameRaw || "主体待识别";
    const publishDateRaw = row.publish_date?.trim() ?? "";
    const validPublishDate = parseDate(publishDateRaw);
    const projectNameRaw = row.project_name?.trim() ?? "";
    const normalizedProjectName = normalizeProjectName(projectNameRaw);
    const projectKey = `${validBrokerName}||${normalizedProjectName}`;
    const supplierRaw =
      row.winning_supplier?.trim() ||
      row.winner?.trim() ||
      candidateSupplierText(row.winner_candidates ?? "");
    const normalizedSupplier = normalizeSupplier(supplierRaw);

    const winningAmount = parsePositiveAmount(
      row.winning_amount_yuan?.trim() || row.winning_amount,
    );
    const budgetAmount = parsePositiveAmount(row.budget_amount_yuan);

    const displayAmount = winningAmount ?? budgetAmount;
    const displayAmountKind = winningAmount !== null
      ? "winning"
      : budgetAmount !== null
        ? "budget"
        : null;
    const amountSampleKey = displayAmount !== null
      ? `${projectKey}||${displayAmountKind}||${displayAmount}`
      : null;

    const subcategory = row.project_subcategory?.trim() ?? "";
    const category = row.procurement_category?.trim() ?? "";
    const { primaryDomain, isFinTech } = classifyDomain(
      projectNameRaw,
      subcategory,
      category
    );
    const topicTags = generateTags(projectNameRaw, subcategory);
    const sourceName = (row.source ?? row.data_source ?? "").trim();
    const procurementMethod = row.procurement_method?.trim() ?? "";
    return {
      broker_folder: row.broker_folder?.trim() ?? "",
      markdown_file: row.markdown_file?.trim() ?? "",
      document_sha1: row.document_sha1?.trim() ?? "",
      processed_at: row.processed_at?.trim() ?? "",
      raw_json_path: row.raw_json_path?.trim() ?? "",
      is_broker_project: isBrokerProject,
      announcement_stage: row.announcement_stage?.trim() ?? "",
      project_name_raw: projectNameRaw,
      procurement_method: procurementMethod,
      budget_amount_yuan: budgetAmount,
      winning_amount_yuan: winningAmount,
      display_amount_yuan: displayAmount,
      display_amount_kind: displayAmountKind,
      sourceName,
      validBrokerName,
      validPublishDate,
      normalizedProjectName,
      projectKey,
      normalizedSupplier,
      amountSampleKey,
      primaryDomain,
      topicTags,
      isFinTech,
    };
  });
}

const SEARCH_TEXT_CACHE = new WeakMap<ProcessedRecord, string>();

export function recordMatchesSearch(record: ProcessedRecord, keyword: string): boolean {
  let searchText = SEARCH_TEXT_CACHE.get(record);
  if (searchText === undefined) {
    searchText = [
      record.project_name_raw,
      record.validBrokerName,
      record.normalizedSupplier,
      record.procurement_method,
    ].join("\n").toLowerCase();
    SEARCH_TEXT_CACHE.set(record, searchText);
  }
  return searchText.includes(keyword);
}

const INVALID_BROKER_NAMES = new Set([
  "",
  "未知",
  "未识别",
  "主体待识别",
  "券商待识别",
  "无法识别",
  "未提供",
  "无",
  "null",
  "undefined",
  "-",
  "--",
]);

export function getValidBrokerName(record: ProcessedRecord): string | null {
  if (record.is_broker_project === false) return null;
  const brokerName = record.validBrokerName.trim();
  if (!brokerName) return null;
  if (INVALID_BROKER_NAMES.has(brokerName.toLowerCase())) return null;
  return brokerName;
}

export async function loadAndProcessData(token: string): Promise<LoadedAnnouncementData> {
  try {
    const data = await fetchAnnouncements(token);
    return {
      records: data.records.length === 0 ? [] : processRecords(data.records as RawCsvRow[]),
      updatedAt: data.meta.updated_at,
    };
  } catch (error) {
    if (error instanceof BackendApiError && error.status === 404) {
      throw new DataNotGeneratedError();
    }
    if (error instanceof BackendApiError && error.status === 0) {
      throw new Error("无法连接 FastAPI 后端，请确认服务已启动");
    }
    throw error;
  }
}

export function getDashboardStatistics(records: ProcessedRecord[]): DashboardStatistics {
  const brokerCounts = new Map<string, number>();
  const sourceNames = new Set<string>();

  for (const record of records) {
    const brokerName = getValidBrokerName(record);
    if (brokerName) {
      brokerCounts.set(brokerName, (brokerCounts.get(brokerName) ?? 0) + 1);
    }
    if (record.sourceName) sourceNames.add(record.sourceName);
  }

  const brokerActivity: BrokerActivityDistribution = { high: 0, medium: 0, low: 0 };
  for (const count of brokerCounts.values()) {
    if (count > 50) brokerActivity.high += 1;
    else if (count >= 10) brokerActivity.medium += 1;
    else brokerActivity.low += 1;
  }

  const sources = sourceNames.size > 0 ? Array.from(sourceNames) : [...SUPPORTED_SOURCES];
  return {
    brokerCount: brokerCounts.size,
    brokerNames: Array.from(brokerCounts.keys()),
    brokerActivity,
    sources,
    sourceCount: sources.length,
    // The current CSV has no reliable institution type field, so no client-side inference is made.
    institutionBreakdown: null,
  };
}

// ─── Derived analytics helpers ───
export function getDataBaseline(records: ProcessedRecord[]): Date | null {
  let max: Date | null = null;
  for (const r of records) {
    if (r.validPublishDate) {
      if (!max || r.validPublishDate > max) max = r.validPublishDate;
    }
  }
  return max;
}

export function uniqueCount(arr: string[]): number {
  return new Set(arr).size;
}

export function formatDate(d: Date | null): string {
  if (!d) return "日期未识别";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function formatAmount(v: number | null): string {
  if (v === null) return "未披露";
  return `¥${v.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatAmountInWan(v: number | null): string {
  if (v === null) return "未披露";
  return `${(v / 10000).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}万元`;
}

export function displayAmountLabel(record: ProcessedRecord): string {
  return record.display_amount_kind === "winning" ? "成交金额" : "项目预算";
}

export function exportCsv(records: ProcessedRecord[]): void {
  const headers = [
    "主体", "项目名称", "金融科技方向", "主题标签", "公告阶段",
    "采购方式", "结果披露供应商", "公开金额类型", "公开金额", "公告日期",
  ];
  const rows = records.map((r) => [
    r.validBrokerName,
    r.normalizedProjectName,
    r.primaryDomain,
    r.topicTags.join("/"),
    r.announcement_stage || "待确认",
    r.procurement_method || "方式未识别",
    r.normalizedSupplier || "未披露",
    r.display_amount_yuan !== null ? displayAmountLabel(r) : "未披露",
    r.display_amount_yuan !== null ? String(r.display_amount_yuan) : "未披露",
    formatDate(r.validPublishDate),
  ]);

  const csvContent = [headers, ...rows]
    .map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(","))
    .join("\n");

  const bom = "\uFEFF";
  const blob = new Blob([bom + csvContent], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `招采情报_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Project scoring for key projects ───
export function scoreProject(r: ProcessedRecord, baseline: Date | null): number {
  let score = 0;
  // AI domain
  if (r.primaryDomain === "AI与智能化") score += 30;
  // Core trading
  if (r.primaryDomain === "交易、柜台与核心系统") score += 20;
  // Xinchuang tags
  if (r.topicTags.includes("信创")) score += 15;
  // Result announced
  if (r.announcement_stage === "结果公示") score += 15;
  // Supplier disclosed
  if (r.normalizedSupplier) score += 10;
  if (r.display_amount_kind === "winning") score += 10;
  if (r.display_amount_kind === "budget") score += 5;
  // Recent (within 30 days of baseline)
  if (baseline && r.validPublishDate) {
    const diff = baseline.getTime() - r.validPublishDate.getTime();
    if (diff <= 30 * 86400000) score += 20;
  }
  return score;
}

export function getScoreReason(r: ProcessedRecord): string {
  const reasons: string[] = [];
  if (r.primaryDomain === "AI与智能化")
    reasons.push("近期新增的AI与智能化项目");
  if (r.primaryDomain === "交易、柜台与核心系统")
    reasons.push("涉及核心交易系统建设");
  if (r.topicTags.includes("信创"))
    reasons.push("具有信创或国产化属性");
  if (r.announcement_stage === "结果公示" && r.normalizedSupplier)
    reasons.push("结果公告已披露供应商");
  if (r.display_amount_kind === "winning")
    reasons.push("公告公开披露成交金额");
  if (r.display_amount_kind === "budget")
    reasons.push("公告公开披露项目预算");
  return reasons[0] || "公开招采动态值得关注";
}
