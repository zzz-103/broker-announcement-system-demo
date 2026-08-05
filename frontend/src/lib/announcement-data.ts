import { fetchDashboardFilters, fetchDashboardManifest, fetchDashboardOverview, fetchDashboardTenderProjects } from "@/lib/api/backend-client";
import type { DashboardFilters, DashboardOverview, TenderProjectData } from "@dashboard-data/contracts";
import { normalizeBrokerName } from "@/lib/broker-names";

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

export interface BrokerActivityDistribution { high: number; medium: number; low: number; }
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
  overview: DashboardOverview;
  filters: DashboardFilters;
}

export class DataNotGeneratedError extends Error {
  constructor(message = "尚未生成标准化看板数据，请先在后端完成数据处理或复制有效数据包。") {
    super(message);
    this.name = "DataNotGeneratedError";
  }
}

function reviveDate(timestamp: number | null): Date | null {
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) return null;
  const value = new Date(timestamp);
  return Number.isNaN(value.getTime()) ? null : value;
}

export function fromDashboardProject(row: TenderProjectData): ProcessedRecord {
  const broker = normalizeBrokerName(row.broker_name) || "主体待识别";
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
    validBrokerName: broker,
    validPublishDate: reviveDate(row.publish_timestamp),
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

export async function loadAndProcessData(token: string): Promise<LoadedAnnouncementData> {
  try {
    const [manifest, overview, filters, rows] = await Promise.all([
      fetchDashboardManifest(token),
      fetchDashboardOverview(token),
      fetchDashboardFilters(token),
      fetchDashboardTenderProjects(token),
    ]);
    if (manifest.schema_version.split(".")[0] !== "1" || manifest.minimum_reader_version.split(".")[0] !== "1") {
      throw new Error("看板数据版本不兼容，请更新正式前端或重新导出数据包。");
    }
    return {
      records: rows.map(fromDashboardProject),
      updatedAt: manifest.generated_at || null,
      overview,
      filters,
    };
  } catch (error) {
    if (error instanceof Error && error.message.includes("版本不兼容")) throw error;
    const status = (error as { status?: number }).status;
    if (status === 404) throw new DataNotGeneratedError();
    if (status === 0) throw new Error("无法连接 FastAPI 后端，请确认服务已启动");
    throw error;
  }
}

const INVALID_BROKER_NAMES = new Set(["", "未知", "未识别", "主体待识别", "券商待识别", "无法识别", "未提供", "无", "null", "undefined", "-", "--"]);

export function getValidBrokerName(record: ProcessedRecord): string | null {
  if (record.is_broker_project === false) return null;
  const brokerName = record.validBrokerName.trim();
  return brokerName && !INVALID_BROKER_NAMES.has(brokerName.toLowerCase()) ? brokerName : null;
}

export function recordMatchesSearch(record: ProcessedRecord, keyword: string): boolean {
  return record.searchText.includes(keyword);
}

export function getDashboardStatistics(records: ProcessedRecord[]): DashboardStatistics {
  const brokerCounts = new Map<string, number>();
  const sourceNames = new Set<string>();
  for (const record of records) {
    const broker = getValidBrokerName(record);
    if (broker) brokerCounts.set(broker, (brokerCounts.get(broker) ?? 0) + 1);
    if (record.sourceName) sourceNames.add(record.sourceName);
  }
  const brokerActivity: BrokerActivityDistribution = { high: 0, medium: 0, low: 0 };
  for (const count of brokerCounts.values()) {
    if (count > 50) brokerActivity.high += 1;
    else if (count >= 10) brokerActivity.medium += 1;
    else brokerActivity.low += 1;
  }
  const sources = sourceNames.size ? [...sourceNames] : [...SUPPORTED_SOURCES];
  return { brokerCount: brokerCounts.size, brokerNames: [...brokerCounts.keys()], brokerActivity, sources, sourceCount: sources.length, institutionBreakdown: null };
}

export function getDataBaseline(records: ProcessedRecord[]): Date | null {
  let latest: Date | null = null;
  for (const record of records) {
    if (record.validPublishDate && (!latest || record.validPublishDate > latest)) latest = record.validPublishDate;
  }
  return latest;
}

export function uniqueCount(values: string[]): number { return new Set(values).size; }
export function formatDate(value: Date | null): string {
  if (!value) return "日期未识别";
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}
export function formatAmount(value: number | null): string {
  if (value === null) return "未披露";
  return `¥${value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
export function formatAmountInWan(value: number | null): string {
  if (value === null) return "未披露";
  return `${(value / 10000).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}万元`;
}
export function displayAmountLabel(record: ProcessedRecord): string { return record.display_amount_kind === "winning" ? "成交金额" : "项目预算"; }

export function exportCsv(records: ProcessedRecord[]): void {
  const headers = ["券商", "项目名称", "项目方向", "项目标签", "公告阶段", "采购方式", "供应商", "公开金额类型", "公开金额", "公告日期"];
  const rows = records.map((record) => [record.validBrokerName, record.normalizedProjectName, record.primaryDomain, record.topicTags.join("/"), record.announcement_stage || "其他", record.procurement_method || "方式未识别", record.normalizedSupplier || "未披露", record.display_amount_yuan !== null ? displayAmountLabel(record) : "未披露", record.display_amount_yuan !== null ? String(record.display_amount_yuan) : "未披露", formatDate(record.validPublishDate)]);
  const content = [headers, ...rows].map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob(["\uFEFF" + content], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `招采情报_${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function scoreProject(record: ProcessedRecord, _baseline: Date | null): number { return record.priorityScore; }
export function getScoreReason(record: ProcessedRecord): string { return record.priorityReason; }
