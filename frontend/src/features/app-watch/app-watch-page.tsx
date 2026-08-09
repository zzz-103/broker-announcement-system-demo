"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { RefreshCw, TrendingUp, List } from "lucide-react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/auth-store";
import { BackendApiError, isAbortError } from "@/lib/api/backend-client";
import { LoginPageWithApply } from "@/components/login-page-with-apply";
import { SessionLoading } from "@/components/session-loading";
import {
  AppReleaseNotGeneratedError,
  getAppReleaseStatistics,
  loadAppReleases,
  formatReleaseDate,
  appReleaseMatchesSearch,
  getUpdateTypeDistribution,
  getFeatureTagDistribution,
  exportAppReleaseCsv,
  type AppReleaseRecord,
} from "@/lib/app-release-data";
import { formatCount, formatDateTime, formatMonthDay } from "@/lib/display";
import { DashboardHeader } from "@/components/dashboard-header";
import { KpiCard } from "@/components/app-watch/kpi-card";
import { FilterBar } from "@/components/app-watch/filter-bar";
import { OverviewCharts } from "@/components/app-watch/overview-charts";
import { ReleaseTable } from "@/components/app-watch/release-table";
import { ReleaseDetailDrawer } from "@/components/app-watch/release-detail-drawer";
import type { DashboardFilters, DashboardOverview } from "@dashboard-data/contracts";

type ViewMode = "overview" | "details";

interface FilterState {
  search: string;
  timeRange: "30d" | "90d" | "year" | "all";
  brokerNames: string[];
  appNames: string[];
  updateTypes: string[];
  featureTags: string[];
}

export default function AppUpdatesPage() {
  const router = useRouter();
  const { token, clearAuth, username, isAdmin, logout, isHydrated, isLoggedIn } = useAuthStore();
  const restoreSession = useAuthStore((state) => state.restoreSession);
  
  // Data state
  const [records, setRecords] = useState<AppReleaseRecord[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [dataOverview, setDataOverview] = useState<DashboardOverview | null>(null);
  const [dataFilters, setDataFilters] = useState<DashboardFilters | null>(null);
  const [dataStatus, setDataStatus] = useState<"loading" | "empty" | "ready" | "error">("loading");
  const [dataMessage, setDataMessage] = useState<string | null>(null);
  const [dataVersion, setDataVersion] = useState(0);
  
  // UI state
  const [viewMode, setViewMode] = useState<ViewMode>("overview");
  const [selectedRecord, setSelectedRecord] = useState<AppReleaseRecord | null>(null);
  
  // Filter state
  const [filters, setFilters] = useState<FilterState>({
    search: "",
    timeRange: "90d",
    brokerNames: [],
    appNames: [],
    updateTypes: [],
    featureTags: [],
  });
  
  const refreshData = useCallback(() => setDataVersion((v) => v + 1), []);

  // This page can be opened directly in a new tab from the admin console.
  // Zustand starts with an empty in-memory store in that tab, so restore the
  // session before attempting the authenticated data request.
  useEffect(() => {
    restoreSession();
  }, [restoreSession]);

  // Load data
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    setDataStatus("loading");
    setDataMessage(null);
    loadAppReleases(token, controller.signal)
      .then(({ records: loaded, updatedAt: at, overview, filters: loadedFilters }) => {
        setRecords(loaded);
        setUpdatedAt(at);
        setDataOverview(overview);
        setDataFilters(loadedFilters);
        setDataStatus(loaded.length === 0 ? "empty" : "ready");
        setDataMessage(loaded.length === 0 ? "尚未生成券商 App 更新数据，请先运行券商 App 更新任务。" : null);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) return;
        if (err instanceof BackendApiError && err.status === 401) {
          clearAuth("登录已失效，请重新登录");
          return;
        }
        setRecords([]);
        setUpdatedAt(null);
        setDataOverview(null);
        setDataFilters(null);
        if (err instanceof AppReleaseNotGeneratedError) {
          setDataStatus("empty");
          setDataMessage(err.message);
        } else {
          setDataStatus("error");
          setDataMessage(err instanceof Error ? err.message : "数据加载失败");
        }
      });
    return () => controller.abort();
  }, [token, clearAuth, dataVersion]);

  const deferredSearch = useDeferredValue(filters.search.trim().toLowerCase());
  const baseline = useMemo(() => {
    const packagedDate = dataOverview?.app_updates.period.to ? new Date(`${dataOverview.app_updates.period.to}T00:00:00Z`) : null;
    if (packagedDate && !Number.isNaN(packagedDate.getTime())) return packagedDate;
    let latest = 0;
    for (const record of records) {
      latest = Math.max(latest, record.publishDate?.getTime() ?? 0);
    }
    return latest > 0 ? new Date(latest) : null;
  }, [dataOverview, records]);

  const selectedBrokerNames = useMemo(() => new Set(filters.brokerNames), [filters.brokerNames]);
  const selectedAppNames = useMemo(() => new Set(filters.appNames), [filters.appNames]);
  const selectedUpdateTypes = useMemo(() => new Set(filters.updateTypes), [filters.updateTypes]);
  const selectedFeatureTags = useMemo(() => new Set(filters.featureTags), [filters.featureTags]);

  // Filtering and all chart/statistical derivation stay in the visitor's
  // browser; the local server only serves the compact cached dataset.
  const filteredRecords = useMemo(() => {
    let cutoff: Date | null = null;
    if (filters.timeRange !== "all" && baseline) {
      if (filters.timeRange === "30d") {
        cutoff = new Date(baseline.getTime() - 30 * 24 * 60 * 60 * 1000);
      } else if (filters.timeRange === "90d") {
        cutoff = new Date(baseline.getTime() - 90 * 24 * 60 * 60 * 1000);
      } else if (filters.timeRange === "year") {
        cutoff = new Date(baseline.getFullYear(), 0, 1);
      }
    }

    return records.filter((record) => {
      if (deferredSearch && !appReleaseMatchesSearch(record, deferredSearch)) return false;
      if (cutoff && (!record.publishDate || record.publishDate < cutoff)) return false;
      if (selectedBrokerNames.size && !selectedBrokerNames.has(record.brokerName)) return false;
      if (selectedAppNames.size && !selectedAppNames.has(record.appName)) return false;
      if (selectedUpdateTypes.size && !selectedUpdateTypes.has(record.updateType)) return false;
      if (
        selectedFeatureTags.size &&
        !record.featureTags.some((tag) => selectedFeatureTags.has(tag))
      ) {
        return false;
      }
      return true;
    });
  }, [
    baseline,
    deferredSearch,
    filters.timeRange,
    records,
    selectedAppNames,
    selectedBrokerNames,
    selectedFeatureTags,
    selectedUpdateTypes,
  ]);

  // Statistics and groups
  const statistics = useMemo(() => getAppReleaseStatistics(filteredRecords), [filteredRecords]);
  // Options for filters
  const brokerOptions = useMemo(() => {
    return dataFilters?.app_updates.brokers ?? [...new Set(records.map((record) => record.brokerName).filter(Boolean))].sort();
  }, [dataFilters, records]);
  
  const appOptions = useMemo(() => {
    return dataFilters?.app_updates.apps ?? [...new Set(records.map((record) => record.appName).filter(Boolean))].sort();
  }, [dataFilters, records]);
  
  const updateTypeOptions = useMemo(() => dataFilters?.app_updates.update_types ?? getUpdateTypeDistribution(records).map(i => i.name), [dataFilters, records]);
  const tagOptions = useMemo(() => dataFilters?.app_updates.feature_tags ?? getFeatureTagDistribution(records).map(i => i.name), [dataFilters, records]);

  // Keep the detail drawer focused on distinct information when an imported
  // highlight repeats the one-line summary shown in the overview fields.
  const handleRecordClick = useCallback((record: AppReleaseRecord) => {
    const summary = record.updateSummary.trim();
    const highlights = summary
      ? record.highlights.filter((highlight) => highlight.trim() !== summary)
      : record.highlights;
    setSelectedRecord(highlights.length === record.highlights.length ? record : { ...record, highlights });
  }, []);

  const isBusy = dataStatus === "loading";

  if (!isHydrated) {
    return <SessionLoading />;
  }

  if (!isLoggedIn) {
    return <LoginPageWithApply />;
  }

  return (
    <div className="min-h-screen min-w-0 max-w-full overflow-x-hidden bg-[#F4F7FB]">
      <DashboardHeader
        username={username}
        isAdmin={isAdmin}
        activeModule="app-watch"
        statusText={
          dataStatus === "ready"
            ? formatMonthDay(baseline)
            : dataStatus === "loading"
              ? "加载中"
              : dataStatus === "empty"
                ? "待生成"
                : "不可用"
        }
        statusTone={dataStatus === "ready" ? "ready" : dataStatus === "loading" ? "loading" : dataStatus === "empty" ? "stale" : "unavailable"}
        statusDescription={updatedAt ? `App 更新数据更新时间：${formatDateTime(updatedAt)}` : dataMessage || undefined}
        exportOptions={[
          {
            id: "filtered-csv",
            label: "当前筛选结果",
            description: `${formatCount(filteredRecords.length)} 条记录`,
            disabled: filteredRecords.length === 0,
            onSelect: () => exportAppReleaseCsv(filteredRecords),
          },
          {
            id: "all-csv",
            label: "全部数据",
            description: `${formatCount(records.length)} 条记录`,
            disabled: records.length === 0,
            onSelect: () => exportAppReleaseCsv(records),
          },
        ]}
        onOpenAdmin={() => router.push("/admin")}
        onLogout={logout}
      />

      {/* Main content */}
      <main className="mx-auto max-w-[1600px] min-w-0 space-y-4 px-3 py-4 sm:px-8 sm:py-5" aria-busy={isBusy}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-[#172033] sm:text-2xl">App 更新</h2>
            <p className="mt-1 text-xs text-[#667085]">汇总券商 App 版本与功能变化。</p>
          </div>
          <button
            type="button"
            onClick={refreshData}
            disabled={isBusy}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[#D0D5DD] bg-white px-3 text-xs font-semibold text-[#475467] transition-colors hover:bg-[#F8FAFD] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw className={`size-3.5 ${isBusy ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden="true" />
            刷新数据
          </button>
        </div>
        {/* Status message */}
        {(dataStatus === "loading" || dataStatus === "empty" || dataStatus === "error") && (
          <div
            role={dataStatus === "error" ? "alert" : "status"}
            aria-live={dataStatus === "error" ? "assertive" : "polite"}
            className={`rounded-lg border px-4 py-3 text-[13px] ${
              dataStatus === "error"
                ? "border-red-100 bg-red-50 text-red-600"
                : "border-amber-100 bg-amber-50 text-amber-700"
            }`}
          >
            {dataStatus === "loading"
              ? "正在加载券商 App 更新数据..."
              : dataMessage || "尚未生成券商 App 更新数据。"}
          </div>
        )}

        {/* KPI Cards */}
        <div className="surface-metrics grid grid-cols-2 gap-px sm:grid-cols-4">
          <KpiCard label="更新记录" value={statistics.releaseCount} />
          <KpiCard label="覆盖券商" value={statistics.brokerCount} />
          <KpiCard label="覆盖 App" value={statistics.appCount} />
          <KpiCard label="最新更新" value={formatReleaseDate(statistics.latestPublishDate)} isText />
        </div>

        {/* View toggle & filter bar */}
        <div className="space-y-3">
          {/* View toggle */}
          <div className="flex items-center gap-1 border-b border-[#E4EAF2]" role="tablist" aria-label="App 更新内容">
            <button
              type="button"
              role="tab"
              id="app-updates-tab-overview"
              aria-selected={viewMode === "overview"}
              aria-controls="app-updates-overview-panel"
              tabIndex={viewMode === "overview" ? 0 : -1}
              onClick={() => setViewMode("overview")}
              onKeyDown={(event) => {
                if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
                event.preventDefault();
                setViewMode("details");
                requestAnimationFrame(() => document.getElementById("app-updates-tab-details")?.focus());
              }}
              className={`inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-semibold transition-colors duration-150 motion-reduce:transition-none ${
                viewMode === "overview"
                  ? "border-[#2563EB] text-[#2563EB]"
                  : "border-transparent text-[#667085] hover:text-[#344054]"
              }`}
            >
              <TrendingUp className="w-4 h-4" />
              更新总览
            </button>
            <button
              type="button"
              role="tab"
              id="app-updates-tab-details"
              aria-selected={viewMode === "details"}
              aria-controls="app-updates-details-panel"
              tabIndex={viewMode === "details" ? 0 : -1}
              onClick={() => setViewMode("details")}
              onKeyDown={(event) => {
                if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
                event.preventDefault();
                setViewMode("overview");
                requestAnimationFrame(() => document.getElementById("app-updates-tab-overview")?.focus());
              }}
              className={`inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-semibold transition-colors duration-150 motion-reduce:transition-none ${
                viewMode === "details"
                  ? "border-[#2563EB] text-[#2563EB]"
                  : "border-transparent text-[#667085] hover:text-[#344054]"
              }`}
            >
              <List className="w-4 h-4" />
              更新明细
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
                  viewMode === "details" ? "bg-[#EAF2FF] text-[#2563EB]" : "bg-[#E8EDF3] text-[#667085]"
                }`}
              >
                {formatCount(filteredRecords.length)}
              </span>
            </button>
          </div>

          {/* Filter bar */}
          <FilterBar
            filters={filters}
            setFilters={setFilters}
            brokerOptions={brokerOptions}
            appOptions={appOptions}
            updateTypeOptions={updateTypeOptions}
            tagOptions={tagOptions}
          />

          {/* Content area */}
          {viewMode === "overview" ? (
            <>
              {/* Charts */}
              <div id="app-updates-overview-panel" role="tabpanel" aria-labelledby="app-updates-tab-overview" className="surface-metrics grid grid-cols-1 gap-px md:grid-cols-6 lg:grid-cols-12">
                <OverviewCharts data={filteredRecords} onSelect={handleRecordClick} />
              </div>
            </>
          ) : (
            /* Details table */
            <div id="app-updates-details-panel" role="tabpanel" aria-labelledby="app-updates-tab-details">
              <ReleaseTable releases={filteredRecords} onSelect={handleRecordClick} />
            </div>
          )}

          {/* Updated at */}
          {updatedAt && (
            <p className="text-[11px] text-[#98A2B3]">
              数据更新时间：{formatDateTime(updatedAt)}
            </p>
          )}
        </div>
      </main>

      {/* Detail drawer */}
      <ReleaseDetailDrawer
        record={selectedRecord}
        onClose={() => setSelectedRecord(null)}
      />
    </div>
  );
}
