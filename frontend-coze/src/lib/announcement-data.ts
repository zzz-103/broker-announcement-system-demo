import type { DashboardFilters, DashboardManifest, DashboardOverview, TenderProjectData } from "@dashboard-data/contracts";
import {
  DashboardDataError,
  loadStaticDataset,
  loadStaticManifest,
} from "@/lib/static-dashboard-data";

export const ANNOUNCEMENT_STAGES = ["采购招标", "结果公示", "流标废标", "其他"] as const;

export interface ProcessedRecord {
  id: string;
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
  rawBrokerName: string;
  validBrokerName: string;
  validPublishDate: Date | null;
  normalizedProjectName: string;
  projectKey: string;
  normalizedSupplier: string;
  amountSampleKey: string | null;
  primaryDomain: string;
  topicTags: string[];
  isFinTech: boolean;
  searchText: string;
  priorityScore: number;
  priorityReason: string;
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
  manifest: DashboardManifest;
  overview: DashboardOverview;
  filters: DashboardFilters;
}

export class DataNotGeneratedError extends Error {
  constructor(message = "尚未提供标准化招采数据，请复制完整的 dashboard-data 目录。") {
    super(message);
    this.name = "DataNotGeneratedError";
  }
}

function dateFromRow(row: TenderProjectData): Date | null {
  if (typeof row.publish_timestamp !== "number") return null;
  const value = new Date(row.publish_timestamp);
  return Number.isNaN(value.getTime()) ? null : value;
}

export function fromDashboardProject(row: TenderProjectData): ProcessedRecord {
  return {
    id: row.id,
    broker_folder: "",
    markdown_file: "",
    document_sha1: "",
    processed_at: row.processed_at,
    raw_json_path: "",
    is_broker_project: row.is_broker_project,
    announcement_stage: row.announcement_stage,
    project_name_raw: row.project_name,
    procurement_method: row.procurement_method,
    budget_amount_yuan: row.budget_amount_yuan,
    winning_amount_yuan: row.winning_amount_yuan,
    display_amount_yuan: row.display_amount_yuan,
    display_amount_kind: row.display_amount_kind,
    sourceName: row.source_name,
    rawBrokerName: row.broker_name,
    validBrokerName: row.broker_name || "主体待识别",
    validPublishDate: dateFromRow(row),
    normalizedProjectName: row.normalized_project_name,
    projectKey: row.project_key,
    normalizedSupplier: row.supplier_name,
    amountSampleKey: row.amount_sample_key,
    primaryDomain: row.primary_domain,
    topicTags: row.topic_tags,
    isFinTech: row.is_fintech,
    searchText: row.search_text,
    priorityScore: row.priority_score,
    priorityReason: row.priority_reason,
  };
}

export async function loadAndProcessData(): Promise<LoadedAnnouncementData> {
  try {
    const [manifest, overview, filters, rows] = await Promise.all([
      loadStaticManifest(),
      loadStaticDataset("overview"),
      loadStaticDataset("filters"),
      loadStaticDataset("tender_projects"),
    ]);
    return {
      records: rows.map(fromDashboardProject),
      updatedAt: manifest.generated_at || null,
      manifest,
      overview,
      filters,
    };
  } catch (error) {
    if (error instanceof DashboardDataError) {
      throw new DataNotGeneratedError(error.message);
    }
    throw error;
  }
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
  const broker = record.validBrokerName.trim();
  if (
    record.is_broker_project === false ||
    !broker ||
    INVALID_BROKER_NAMES.has(broker.toLowerCase())
  ) {
    return null;
  }
  return broker;
}

export function recordMatchesSearch(record: ProcessedRecord, keyword: string): boolean {
  return record.searchText.includes(keyword);
}

export function getDashboardStatistics(records: ProcessedRecord[]): DashboardStatistics {
  const brokerCounts = new Map<string, number>();
  const sources = new Set<string>();
  for (const record of records) {
    const broker = getValidBrokerName(record);
    if (broker) brokerCounts.set(broker, (brokerCounts.get(broker) ?? 0) + 1);
    if (record.sourceName) sources.add(record.sourceName);
  }

  const brokerActivity: BrokerActivityDistribution = { high: 0, medium: 0, low: 0 };
  for (const count of brokerCounts.values()) {
    if (count > 50) brokerActivity.high += 1;
    else if (count >= 10) brokerActivity.medium += 1;
    else brokerActivity.low += 1;
  }

  const sourceNames = sources.size ? [...sources] : [...SUPPORTED_SOURCES];
  return {
    brokerCount: brokerCounts.size,
    brokerNames: [...brokerCounts.keys()],
    brokerActivity,
    sources: sourceNames,
    sourceCount: sourceNames.length,
    institutionBreakdown: null,
  };
}

export function getDataBaseline(records: ProcessedRecord[]): Date | null {
  let latest: Date | null = null;
  for (const record of records) {
    if (record.validPublishDate && (!latest || record.validPublishDate > latest)) {
      latest = record.validPublishDate;
    }
  }
  return latest;
}

export function uniqueCount(values: string[]): number {
  return new Set(values).size;
}

export function formatDate(value: Date | null): string {
  if (!value) return "日期未识别";
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

export function formatAmount(value: number | null): string {
  return value === null
    ? "未披露"
    : `¥${value.toLocaleString("zh-CN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
}

export function formatAmountInWan(value: number | null): string {
  return value === null
    ? "未披露"
    : `${(value / 10000).toLocaleString("zh-CN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}万元`;
}

export function displayAmountLabel(record: ProcessedRecord): string {
  return record.display_amount_kind === "winning" ? "成交金额" : "项目预算";
}

export function scoreProject(record: ProcessedRecord, _baseline: Date | null): number {
  void _baseline;
  return record.priorityScore;
}

export function getScoreReason(record: ProcessedRecord): string {
  return record.priorityReason;
}

export function exportCsv(records: ProcessedRecord[]): void {
  const headers = [
    "主体",
    "项目名称",
    "金融科技方向",
    "主题标签",
    "公告阶段",
    "采购方式",
    "结果披露供应商",
    "公开金额类型",
    "公开金额",
    "公告日期",
  ];
  const rows = records.map((record) => [
    record.validBrokerName,
    record.normalizedProjectName,
    record.primaryDomain,
    record.topicTags.join("/"),
    record.announcement_stage || "其他",
    record.procurement_method || "方式未识别",
    record.normalizedSupplier || "未披露",
    record.display_amount_yuan !== null ? displayAmountLabel(record) : "未披露",
    record.display_amount_yuan !== null ? String(record.display_amount_yuan) : "未披露",
    formatDate(record.validPublishDate),
  ]);
  const text = [headers, ...rows]
    .map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const url = URL.createObjectURL(
    new Blob(["\uFEFF" + text], { type: "text/csv;charset=utf-8" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `招采情报_${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
