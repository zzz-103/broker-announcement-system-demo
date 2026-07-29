import {
  BackendApiError,
  fetchAppReleases,
} from "@/lib/api/backend-client";

// ─── Raw CSV row (mirrors broker-app-watch exporter CSV_COLUMNS) ───
interface RawAppReleaseRow {
  broker_code?: string;
  broker_name?: string;
  app_name?: string;
  source_url?: string;
  content_sha256?: string;
  crawl_time?: string;
  markdown_file?: string;
  processed_at?: string;
  app_version?: string;
  platform?: string;
  publish_date?: string;
  update_type?: string;
  update_summary?: string;
  feature_tags?: string;
  highlights?: string;
}

export class AppReleaseNotGeneratedError extends Error {
  constructor() {
    super("尚未生成券商 App 更新数据，请先运行券商 App 更新任务。");
    this.name = "AppReleaseNotGeneratedError";
  }
}

// ─── Processed record ───
export interface AppReleaseRecord {
  brokerCode: string;
  brokerName: string;
  appName: string;
  sourceUrl: string;
  contentSha256: string;
  crawlTime: string;
  markdownFile: string;
  processedAt: string;
  appVersion: string;
  platform: string;
  publishDateRaw: string;
  publishDate: Date | null;
  updateType: string;
  updateSummary: string;
  featureTags: string[];
  highlights: string[];
}

export interface LoadedAppReleaseData {
  records: AppReleaseRecord[];
  updatedAt: string | null;
}

export const UPDATE_TYPE_ORDER = [
  "新功能",
  "体验优化",
  "问题修复",
  "合规安全",
  "其他",
] as const;

export const FEATURE_TAG_ORDER = [
  "行情",
  "交易",
  "开户",
  "理财",
  "资讯",
  "AI智能",
  "安全",
  "其他",
] as const;

export const UPDATE_TYPE_COLORS: Record<string, string> = {
  新功能: "#2563EB",
  体验优化: "#0F9F8F",
  问题修复: "#F59E0B",
  合规安全: "#D64545",
  其他: "#98A2B3",
};

// ─── Helpers ───
function parseJsonArray(raw: string | undefined): string[] {
  const text = (raw ?? "").trim();
  if (!text) return [];
  try {
    const parsed: unknown = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean);
    }
  } catch {
    // Non-JSON content: treat the whole string as a single entry.
    return [text];
  }
  return [];
}

function parseDate(raw: string): Date | null {
  if (!raw || !raw.trim()) return null;
  
  const text = raw.trim();
  
  // Try standard ISO parsing first
  let d = new Date(text);
  if (!isNaN(d.getTime())) return d;
  
  // Try Chinese format: 2026.7.11, 2026.7.11 10:30:45
  const chineseFormat = /^(\d{4})[(./)](\d{1,2})[(./)](\d{1,2})(?: (\d{1,2}):(\d{2}):(\d{2}))?$/;
  const match = text.match(chineseFormat);
  if (match) {
    const [, year, month, day, hour = '0', minute = '0', second = '0'] = match;
    d = new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(minute), parseInt(second));
    if (!isNaN(d.getTime())) return d;
  }
  
  // Try YYYY-MM-DD HH:mm:ss
  const dashedFormat = /^(\d{4})-(\d{1,2})-(\d{1,2}) (\d{1,2}):(\d{2}):(\d{2})$/;
  const match2 = text.match(dashedFormat);
  if (match2) {
    const [, year, month, day, hour, minute, second] = match2;
    d = new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(minute), parseInt(second));
    if (!isNaN(d.getTime())) return d;
  }
  
  return null;
}

// ─── Main processing ───
export function processAppReleases(rawRows: RawAppReleaseRow[]): AppReleaseRecord[] {
  return rawRows
    .map((row) => {
      const brokerCode = row.broker_code?.trim() ?? "";
      const brokerName = row.broker_name?.trim() ?? "";
      const appName = row.app_name?.trim() ?? "";
      const appVersion = row.app_version?.trim() ?? "";
      const platform = row.platform?.trim() || "未知";
      const publishDateRaw = row.publish_date?.trim() ?? "";
      const updateType = row.update_type?.trim() || "其他";
      const updateSummary = row.update_summary?.trim() ?? "";
      const featureTags = parseJsonArray(row.feature_tags);
      const highlights = parseJsonArray(row.highlights);
      return {
        brokerCode,
        brokerName,
        appName,
        sourceUrl: row.source_url?.trim() ?? "",
        contentSha256: row.content_sha256?.trim() ?? "",
        crawlTime: row.crawl_time?.trim() ?? "",
        markdownFile: row.markdown_file?.trim() ?? "",
        processedAt: row.processed_at?.trim() ?? "",
        appVersion,
        platform,
        publishDateRaw,
        publishDate: parseDate(publishDateRaw),
        updateType,
        updateSummary,
        featureTags,
        highlights,
      };
    })
    .filter((record) => record.brokerCode || record.appName || record.updateSummary);
}

const APP_RELEASE_SEARCH_CACHE = new WeakMap<AppReleaseRecord, string>();

export function appReleaseMatchesSearch(record: AppReleaseRecord, keyword: string): boolean {
  let searchText = APP_RELEASE_SEARCH_CACHE.get(record);
  if (searchText === undefined) {
    searchText = [
      record.brokerName,
      record.brokerCode,
      record.appName,
      record.appVersion,
      record.updateSummary,
      record.updateType,
      record.featureTags.join(" "),
      record.highlights.join(" "),
    ].join("\n").toLowerCase();
    APP_RELEASE_SEARCH_CACHE.set(record, searchText);
  }
  return searchText.includes(keyword);
}

export async function loadAppReleases(token: string): Promise<LoadedAppReleaseData> {
  try {
    const data = await fetchAppReleases(token);
    return {
      records: data.records.length === 0 ? [] : processAppReleases(data.records as RawAppReleaseRow[]),
      updatedAt: data.meta.updated_at,
    };
  } catch (error) {
    if (error instanceof BackendApiError && error.status === 404) {
      throw new AppReleaseNotGeneratedError();
    }
    if (error instanceof BackendApiError && error.status === 0) {
      throw new Error("无法连接 FastAPI 后端，请确认服务已启动");
    }
    throw error;
  }
}

// ─── Grouping & shaping ───
export interface BrokerAppGroup {
  key: string;
  brokerCode: string;
  brokerName: string;
  appName: string;
  releases: AppReleaseRecord[];
  latest: AppReleaseRecord;
  count: number;
}

function displayBrokerName(record: AppReleaseRecord): string {
  return record.brokerName || record.brokerCode || "未知券商";
}

export function groupByBrokerApp(records: AppReleaseRecord[]): BrokerAppGroup[] {
  const groups = new Map<string, AppReleaseRecord[]>();
  for (const record of records) {
    const key = `${record.brokerCode}||${record.appName}`;
    const list = groups.get(key);
    if (list) list.push(record);
    else groups.set(key, [record]);
  }

  const result: BrokerAppGroup[] = [];
  for (const [key, list] of groups) {
    const releases = sortByPublishDateDesc(list);
    const latest = releases[0];
    result.push({
      key,
      brokerCode: latest.brokerCode,
      brokerName: displayBrokerName(latest),
      appName: latest.appName || "未知应用",
      releases,
      latest,
      count: releases.length,
    });
  }

  return result.sort((a, b) => {
    const aTime = a.latest.publishDate?.getTime() ?? 0;
    const bTime = b.latest.publishDate?.getTime() ?? 0;
    if (bTime !== aTime) return bTime - aTime;
    return b.count - a.count;
  });
}

export function sortByPublishDateDesc(records: AppReleaseRecord[]): AppReleaseRecord[] {
  return [...records].sort((a, b) => {
    const aTime = a.publishDate?.getTime() ?? 0;
    const bTime = b.publishDate?.getTime() ?? 0;
    if (bTime !== aTime) return bTime - aTime;
    return b.appVersion.localeCompare(a.appVersion, "zh-Hans-CN");
  });
}

export interface CountItem {
  name: string;
  count: number;
}

export function getUpdateTypeDistribution(records: AppReleaseRecord[]): CountItem[] {
  const counts = new Map<string, number>();
  for (const record of records) {
    counts.set(record.updateType, (counts.get(record.updateType) ?? 0) + 1);
  }
  const known = UPDATE_TYPE_ORDER.filter((type) => counts.has(type)).map((type) => ({
    name: type,
    count: counts.get(type) ?? 0,
  }));
  const extra = [...counts.keys()]
    .filter((type) => !UPDATE_TYPE_ORDER.includes(type as (typeof UPDATE_TYPE_ORDER)[number]))
    .map((type) => ({ name: type, count: counts.get(type) ?? 0 }));
  return [...known, ...extra];
}

export function getFeatureTagDistribution(records: AppReleaseRecord[]): CountItem[] {
  const counts = new Map<string, number>();
  for (const record of records) {
    for (const tag of record.featureTags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.name.localeCompare(b.name, "zh-Hans-CN");
    });
}

export function getBrokerReleaseCounts(records: AppReleaseRecord[]): CountItem[] {
  const counts = new Map<string, number>();
  for (const record of records) {
    const name = displayBrokerName(record);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh-Hans-CN"));
}

export function getReleaseTrend(records: AppReleaseRecord[]): CountItem[] {
  const counts = new Map<string, number>();
  for (const record of records) {
    if (!record.publishDate) continue;
    const key = `${record.publishDate.getFullYear()}-${String(
      record.publishDate.getMonth() + 1,
    ).padStart(2, "0")}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface AppReleaseStatistics {
  releaseCount: number;
  brokerCount: number;
  appCount: number;
  latestPublishDate: Date | null;
}

export function getAppReleaseStatistics(records: AppReleaseRecord[]): AppReleaseStatistics {
  const brokers = new Set<string>();
  const apps = new Set<string>();
  let latest: Date | null = null;
  for (const record of records) {
    if (record.brokerCode) brokers.add(record.brokerCode);
    if (record.appName) apps.add(`${record.brokerCode}||${record.appName}`);
    if (record.publishDate && (!latest || record.publishDate > latest)) {
      latest = record.publishDate;
    }
  }
  return {
    releaseCount: records.length,
    brokerCount: brokers.size,
    appCount: apps.size,
    latestPublishDate: latest,
  };
}

// ─── Formatting ───
export function formatReleaseDate(value: Date | string | null): string {
  const d = value instanceof Date ? value : parseDate(value ?? "");
  if (!d) return "日期未识别";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
