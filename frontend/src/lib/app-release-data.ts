import { fetchDashboardAppUpdates, fetchDashboardFilters, fetchDashboardManifest, fetchDashboardOverview } from "@/lib/api/backend-client";
import { normalizeBrokerName } from "@/lib/broker-names";
import type { AppUpdateData, DashboardFilters, DashboardOverview } from "@dashboard-data/contracts";

export class AppReleaseNotGeneratedError extends Error {
  constructor(message = "尚未生成券商 App 更新数据，请先运行券商 App 更新任务。") {
    super(message);
    this.name = "AppReleaseNotGeneratedError";
  }
}

export interface AppReleaseRecord {
  id: string;
  brokerCode: string;
  brokerName: string;
  rawBrokerName: string;
  appName: string;
  sourceUrl: string;
  contentSha256: string;
  crawlTime: string;
  markdownFile: string;
  appVersion: string;
  platform: string;
  publishDateRaw: string;
  publishDate: Date | null;
  updateType: string;
  updateSummary: string;
  featureTags: string[];
  highlights: string[];
  processedAt: string;
  searchText: string;
  platforms: string[];
  mergedRecordCount: number;
}

export interface LoadedAppReleaseData {
  records: AppReleaseRecord[];
  updatedAt: string | null;
  overview: DashboardOverview;
  filters: DashboardFilters;
}
export const UPDATE_TYPE_ORDER = ["新功能", "体验优化", "问题修复", "合规安全", "其他"] as const;
export const FEATURE_TAG_ORDER = ["行情", "交易", "开户", "理财", "资讯", "AI智能", "安全", "其他"] as const;
export const UPDATE_TYPE_COLORS: Record<string, string> = { 新功能: "#2563EB", 体验优化: "#0F9F8F", 问题修复: "#F59E0B", 合规安全: "#D64545", 其他: "#98A2B3" };

/**
 * 功能标签展示映射：后端标签值保持不变，仅在用户界面统一为业务语言。
 */
export function displayFeatureTag(tag: string): string {
  return tag === "AI智能" ? "智能化" : tag;
}

function reviveDate(timestamp: number | null): Date | null {
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) return null;
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function fromDashboardAppUpdate(row: AppUpdateData): AppReleaseRecord {
  return {
    id: row.id,
    brokerCode: row.broker_code,
    brokerName: normalizeBrokerName(row.broker_name),
    rawBrokerName: row.broker_name,
    appName: row.app_name,
    sourceUrl: row.source_url,
    contentSha256: row.content_sha256,
    crawlTime: row.crawl_time,
    markdownFile: "",
    appVersion: row.app_version,
    platform: row.platform,
    publishDateRaw: row.publish_date,
    publishDate: reviveDate(row.publish_timestamp),
    updateType: row.update_type,
    updateSummary: row.update_summary,
    featureTags: row.feature_tags,
    highlights: row.highlights,
    processedAt: row.processed_at,
    searchText: row.search_text,
    platforms: row.platform && row.platform !== "未知" ? [row.platform] : [],
    mergedRecordCount: 1,
  };
}

const LOW_VALUE_UPDATE_PATTERNS = [
  /^(?:[-*]\s*)?(?:运行环境|系统要求|支持语言|适用客户|文件大小|下载地址|下载链接|md5|开发者|官方网站|官方微信|热线电话)\s*[：:]/i,
  /^(?:需要|支持)\s*(?:iOS|Android|安卓|鸿蒙|HarmonyOS)\s*[\d.]+/i,
  /(?:手机版智能炒股软件|股票交易平台|一站式服务|专注于提供|欢迎.*联系)/i,
] as const;

const CHANGE_PATTERN = /(?:新增|增加|上线|推出|支持|优化|提升|改进|升级|修复|解决|调整|完善|改版|安全|合规|风控)/i;

function normalizedVersion(value: string): string {
  return value.trim().replace(/^[vV]\s*/, "").replace(/\s+/g, "").toLowerCase();
}

function meaningfulUpdateText(value: string): boolean {
  const text = value.replace(/\s+/g, " ").trim();
  return Boolean(text) && !LOW_VALUE_UPDATE_PATTERNS.some((pattern) => pattern.test(text));
}

function updateTextScore(value: string): number {
  const text = value.replace(/\s+/g, " ").trim();
  if (!meaningfulUpdateText(text)) return -100;
  let score = Math.min(text.length, 120) / 30;
  if (CHANGE_PATTERN.test(text)) score += 8;
  if (/\d/.test(text)) score += 1;
  return score;
}

function releaseEventKey(record: AppReleaseRecord, index: number): string {
  const version = normalizedVersion(record.appVersion);
  if (!version) return `unversioned:${record.id || record.contentSha256 || index}:${index}`;
  const broker = (record.brokerCode || record.rawBrokerName || record.brokerName).trim().toLowerCase();
  const app = record.appName.trim().replace(/\s+/g, " ").toLowerCase();
  return `versioned:${broker}||${app}||${version}`;
}

/**
 * Imported 1.x dashboard packages can contain one row per crawl snapshot or
 * platform. Collapse those rows into the user-facing release event so charts
 * and recent updates count versions, while retaining the merged provenance.
 */
export function canonicalizeAppReleases(records: AppReleaseRecord[]): AppReleaseRecord[] {
  const groups = new Map<string, AppReleaseRecord[]>();
  records.forEach((record, index) => {
    const key = releaseEventKey(record, index);
    groups.set(key, [...(groups.get(key) ?? []), record]);
  });

  return [...groups.entries()].map(([key, group]) => {
    const ordered = sortByPublishDateDesc(group);
    const representative = [...ordered].sort((a, b) =>
      updateTextScore(b.updateSummary) - updateTextScore(a.updateSummary)
      || Math.max(0, ...b.highlights.map(updateTextScore)) - Math.max(0, ...a.highlights.map(updateTextScore))
      || (b.publishDate?.getTime() ?? 0) - (a.publishDate?.getTime() ?? 0)
    )[0];
    const platforms = [...new Set(group.flatMap((record) =>
      record.platforms.length ? record.platforms : record.platform && record.platform !== "未知" ? [record.platform] : []
    ))].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
    const summaries = group.map((record) => record.updateSummary).filter(meaningfulUpdateText);
    const updateSummary = summaries.sort((a, b) => updateTextScore(b) - updateTextScore(a))[0] ?? "";
    const highlights = [...new Set(group.flatMap((record) => record.highlights)
      .map((item) => item.replace(/\s+/g, " ").trim())
      .filter((item) => meaningfulUpdateText(item) && item !== updateSummary))]
      .sort((a, b) => updateTextScore(b) - updateTextScore(a))
      .slice(0, 5);
    const latest = ordered[0];

    return {
      ...representative,
      id: key,
      platform: platforms.length > 1 ? "全平台" : platforms[0] || representative.platform || "未知",
      platforms,
      publishDateRaw: latest.publishDateRaw,
      publishDate: latest.publishDate,
      updateSummary,
      highlights,
      featureTags: [...new Set(group.flatMap((record) => record.featureTags))],
      mergedRecordCount: group.reduce((sum, record) => sum + record.mergedRecordCount, 0),
      searchText: group.map((record) => record.searchText).join("\n"),
    };
  });
}

export async function loadAppReleases(token: string, signal?: AbortSignal): Promise<LoadedAppReleaseData> {
  try {
    const [manifest, overview, filters, rows] = await Promise.all([
      fetchDashboardManifest(token, signal),
      fetchDashboardOverview(token, signal),
      fetchDashboardFilters(token, signal),
      fetchDashboardAppUpdates(token, signal),
    ]);
    if (manifest.schema_version.split(".")[0] !== "1" || manifest.minimum_reader_version.split(".")[0] !== "1") {
      throw new Error("看板数据版本不兼容，请更新正式前端或重新导出数据包。");
    }
    const dataset = manifest.datasets.app_updates;
    if (!dataset?.available && !rows.length) throw new AppReleaseNotGeneratedError(dataset?.reason ?? undefined);
    return { records: canonicalizeAppReleases(rows.map(fromDashboardAppUpdate)), updatedAt: manifest.generated_at || null, overview, filters };
  } catch (error) {
    if (error instanceof AppReleaseNotGeneratedError) throw error;
    const status = (error as { status?: number }).status;
    if (status === 404) throw new AppReleaseNotGeneratedError();
    if (status === 0) throw new Error("无法连接 FastAPI 后端，请确认服务已启动");
    throw error;
  }
}

export function appReleaseMatchesSearch(record: AppReleaseRecord, keyword: string): boolean { return record.searchText.includes(keyword); }

export interface BrokerAppGroup { key: string; brokerCode: string; brokerName: string; appName: string; releases: AppReleaseRecord[]; latest: AppReleaseRecord; count: number; }
function displayBrokerName(record: AppReleaseRecord): string { return record.brokerName || record.brokerCode || "未知券商"; }
export function sortByPublishDateDesc(records: AppReleaseRecord[]): AppReleaseRecord[] {
  return [...records].sort((a, b) => (b.publishDate?.getTime() ?? 0) - (a.publishDate?.getTime() ?? 0) || b.appVersion.localeCompare(a.appVersion, "zh-Hans-CN"));
}
export function groupByBrokerApp(records: AppReleaseRecord[]): BrokerAppGroup[] {
  const groups = new Map<string, AppReleaseRecord[]>();
  for (const record of records) {
    const key = `${record.brokerCode || record.brokerName}||${record.appName}`;
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }
  return [...groups.entries()].map(([key, list]) => {
    const releases = sortByPublishDateDesc(list);
    return { key, brokerCode: releases[0].brokerCode, brokerName: displayBrokerName(releases[0]), appName: releases[0].appName || "未知应用", releases, latest: releases[0], count: releases.length };
  }).sort((a, b) => (b.latest.publishDate?.getTime() ?? 0) - (a.latest.publishDate?.getTime() ?? 0) || b.count - a.count);
}

export interface CountItem { name: string; count: number; }
export function getUpdateTypeDistribution(records: AppReleaseRecord[]): CountItem[] {
  const counts = new Map<string, number>();
  records.forEach((record) => counts.set(record.updateType, (counts.get(record.updateType) ?? 0) + 1));
  const known = UPDATE_TYPE_ORDER.filter((type) => counts.has(type)).map((name) => ({ name, count: counts.get(name) ?? 0 }));
  const extra = [...counts.entries()].filter(([name]) => !UPDATE_TYPE_ORDER.includes(name as (typeof UPDATE_TYPE_ORDER)[number])).map(([name, count]) => ({ name, count }));
  return [...known, ...extra];
}
export function getFeatureTagDistribution(records: AppReleaseRecord[]): CountItem[] {
  const counts = new Map<string, number>();
  records.forEach((record) => record.featureTags.forEach((tag) => counts.set(tag, (counts.get(tag) ?? 0) + 1)));
  return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh-Hans-CN"));
}
export function getBrokerReleaseCounts(records: AppReleaseRecord[]): CountItem[] {
  const counts = new Map<string, number>();
  records.forEach((record) => { const name = displayBrokerName(record); counts.set(name, (counts.get(name) ?? 0) + 1); });
  return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh-Hans-CN"));
}
export function getReleaseTrend(records: AppReleaseRecord[]): CountItem[] {
  const counts = new Map<string, number>();
  records.forEach((record) => { if (record.publishDate) { const key = `${record.publishDate.getFullYear()}-${String(record.publishDate.getMonth() + 1).padStart(2, "0")}`; counts.set(key, (counts.get(key) ?? 0) + 1); } });
  return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name));
}
export interface AppReleaseStatistics { releaseCount: number; brokerCount: number; appCount: number; latestPublishDate: Date | null; }
export function getAppReleaseStatistics(records: AppReleaseRecord[]): AppReleaseStatistics {
  const brokers = new Set<string>();
  const apps = new Set<string>();
  let latest: Date | null = null;
  records.forEach((record) => {
    const broker = record.brokerName || record.brokerCode;
    if (broker) brokers.add(broker);
    if (record.appName) apps.add(`${broker}||${record.appName}`);
    if (record.publishDate && (!latest || record.publishDate > latest)) latest = record.publishDate;
  });
  return { releaseCount: records.length, brokerCount: brokers.size, appCount: apps.size, latestPublishDate: latest };
}
export function formatReleaseDate(value: Date | string | null): string {
  const date = value instanceof Date ? value : value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "日期未识别";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

const APP_RELEASE_CSV_HEADERS = [
  "券商",
  "券商代码",
  "App名称",
  "版本号",
  "平台",
  "发布日期",
  "更新类型",
  "更新摘要",
  "功能标签",
  "更新要点",
  "来源链接",
  "采集时间",
  "处理时间",
] as const;

function escapeCsvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function formatAppReleasePublishDate(record: AppReleaseRecord): string {
  const formattedDate = formatReleaseDate(record.publishDate);
  return formattedDate === "日期未识别" ? record.publishDateRaw || formattedDate : formattedDate;
}

export function exportAppReleaseCsv(records: AppReleaseRecord[]): void {
  const rows = records.map((record) => [
    record.brokerName || record.rawBrokerName || record.brokerCode || "未知券商",
    record.brokerCode || "未提供",
    record.appName || "未知应用",
    record.appVersion || "未识别",
    record.platform || "未知",
    formatAppReleasePublishDate(record),
    record.updateType || "其他",
    record.updateSummary || "未提供",
    record.featureTags.length > 0 ? record.featureTags.join("、") : "无",
    record.highlights.length > 0 ? record.highlights.join("；") : "无",
    record.sourceUrl || "未提供",
    record.crawlTime || "未提供",
    record.processedAt || "未提供",
  ]);
  const content = [APP_RELEASE_CSV_HEADERS, ...rows]
    .map((row) => row.map(escapeCsvCell).join(","))
    .join("\n");
  const url = URL.createObjectURL(new Blob(["\uFEFF" + content], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `券商App更新_${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
