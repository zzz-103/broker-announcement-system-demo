import type { AppUpdateData, DashboardFilters, DashboardOverview } from "@dashboard-data/contracts";
import {
  DashboardDataError,
  loadStaticDataset,
  loadStaticManifest,
} from "@/lib/static-dashboard-data";

export class AppReleaseNotGeneratedError extends Error {
  constructor(
    message = "尚未提供券商 App 更新数据，请复制包含 app_updates.json 的 dashboard-data 目录。",
  ) {
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
}

export interface LoadedAppReleaseData {
  records: AppReleaseRecord[];
  updatedAt: string | null;
  overview: DashboardOverview;
  filters: DashboardFilters;
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

function fromRow(row: AppUpdateData): AppReleaseRecord {
  const date =
    typeof row.publish_timestamp === "number"
      ? new Date(row.publish_timestamp)
      : null;
  return {
    id: row.id,
    brokerCode: row.broker_code,
    brokerName: row.broker_name,
    rawBrokerName: row.broker_name,
    appName: row.app_name,
    sourceUrl: row.source_url,
    contentSha256: row.content_sha256,
    crawlTime: row.crawl_time,
    markdownFile: "",
    appVersion: row.app_version,
    platform: row.platform,
    publishDateRaw: row.publish_date,
    publishDate: date && !Number.isNaN(date.getTime()) ? date : null,
    updateType: row.update_type,
    updateSummary: row.update_summary,
    featureTags: row.feature_tags,
    highlights: row.highlights,
    processedAt: row.processed_at,
    searchText: row.search_text,
  };
}

export async function loadAppReleases(): Promise<LoadedAppReleaseData> {
  try {
    const [manifest, overview, filters, rows] = await Promise.all([
      loadStaticManifest(),
      loadStaticDataset("overview"),
      loadStaticDataset("filters"),
      loadStaticDataset("app_updates"),
    ]);
    const dataset = manifest.datasets.app_updates;
    if (!dataset.available && !rows.length) {
      throw new AppReleaseNotGeneratedError(dataset.reason ?? undefined);
    }
    return {
      records: rows.map(fromRow),
      updatedAt: manifest.generated_at || null,
      overview,
      filters,
    };
  } catch (error) {
    if (error instanceof AppReleaseNotGeneratedError) throw error;
    if (error instanceof DashboardDataError) {
      throw new AppReleaseNotGeneratedError(error.message);
    }
    throw error;
  }
}

export function appReleaseMatchesSearch(record: AppReleaseRecord, keyword: string): boolean {
  return record.searchText.includes(keyword);
}

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

export function sortByPublishDateDesc(records: AppReleaseRecord[]): AppReleaseRecord[] {
  return [...records].sort(
    (a, b) =>
      (b.publishDate?.getTime() ?? 0) - (a.publishDate?.getTime() ?? 0) ||
      b.appVersion.localeCompare(a.appVersion, "zh-Hans-CN"),
  );
}

export function groupByBrokerApp(records: AppReleaseRecord[]): BrokerAppGroup[] {
  const groups = new Map<string, AppReleaseRecord[]>();
  for (const record of records) {
    const key = `${record.brokerCode || record.brokerName}||${record.appName}`;
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }
  return [...groups.entries()]
    .map(([key, list]) => {
      const releases = sortByPublishDateDesc(list);
      return {
        key,
        brokerCode: releases[0].brokerCode,
        brokerName: displayBrokerName(releases[0]),
        appName: releases[0].appName || "未知应用",
        releases,
        latest: releases[0],
        count: releases.length,
      };
    })
    .sort(
      (a, b) =>
        (b.latest.publishDate?.getTime() ?? 0) -
          (a.latest.publishDate?.getTime() ?? 0) ||
        b.count - a.count,
    );
}

export interface CountItem {
  name: string;
  count: number;
}

export function getUpdateTypeDistribution(records: AppReleaseRecord[]): CountItem[] {
  const counts = new Map<string, number>();
  records.forEach((record) => {
    counts.set(record.updateType, (counts.get(record.updateType) ?? 0) + 1);
  });
  return [
    ...UPDATE_TYPE_ORDER.filter((name) => counts.has(name)).map((name) => ({
      name,
      count: counts.get(name) ?? 0,
    })),
    ...[...counts.entries()]
      .filter(([name]) => !UPDATE_TYPE_ORDER.includes(name as (typeof UPDATE_TYPE_ORDER)[number]))
      .map(([name, count]) => ({ name, count })),
  ];
}

export function getFeatureTagDistribution(records: AppReleaseRecord[]): CountItem[] {
  const counts = new Map<string, number>();
  records.forEach((record) => {
    record.featureTags.forEach((tag) => {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    });
  });
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh-Hans-CN"));
}

export function getBrokerReleaseCounts(records: AppReleaseRecord[]): CountItem[] {
  const counts = new Map<string, number>();
  records.forEach((record) => {
    const name = displayBrokerName(record);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  });
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh-Hans-CN"));
}

export function getReleaseTrend(records: AppReleaseRecord[]): CountItem[] {
  const counts = new Map<string, number>();
  records.forEach((record) => {
    if (!record.publishDate) return;
    const key = `${record.publishDate.getFullYear()}-${String(record.publishDate.getMonth() + 1).padStart(2, "0")}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
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
  records.forEach((record) => {
    const broker = record.brokerName || record.brokerCode;
    if (broker) brokers.add(broker);
    if (record.appName) apps.add(`${broker}||${record.appName}`);
    if (record.publishDate && (!latest || record.publishDate > latest)) {
      latest = record.publishDate;
    }
  });
  return {
    releaseCount: records.length,
    brokerCount: brokers.size,
    appCount: apps.size,
    latestPublishDate: latest,
  };
}

export function formatReleaseDate(value: Date | string | null): string {
  const date = value instanceof Date ? value : value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "日期未识别";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
