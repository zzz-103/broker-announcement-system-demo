"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { LogOut, RefreshCw, Search, TrendingUp, List, AlertCircle, ArrowLeft } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/auth-store";
import { BackendApiError } from "@/lib/api/backend-client";
import { LoginPageWithApply } from "@/components/login-page-with-apply";
import {
  AppReleaseNotGeneratedError,
  getAppReleaseStatistics,
  groupByBrokerApp,
  loadAppReleases,
  sortByPublishDateDesc,
  formatReleaseDate,
  appReleaseMatchesSearch,
  getUpdateTypeDistribution,
  getFeatureTagDistribution,
  getBrokerReleaseCounts,
  getReleaseTrend,
  type AppReleaseRecord,
} from "@/lib/app-release-data";
import { KpiCard } from "@/components/app-watch/kpi-card";
import { FilterBar } from "@/components/app-watch/filter-bar";
import { OverviewCharts } from "@/components/app-watch/overview-charts";
import { ReleaseTable } from "@/components/app-watch/release-table";
import { ReleaseDetailDrawer } from "@/components/app-watch/release-detail-drawer";
import { ModuleSwitcher } from "@/components/app-watch/module-switcher";

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
  const { token, clearAuth, username, isAdmin, logout, isLoggedIn } = useAuthStore();
  const restoreSession = useAuthStore((state) => state.restoreSession);
  
  // Data state
  const [records, setRecords] = useState<AppReleaseRecord[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [dataStatus, setDataStatus] = useState<"loading" | "empty" | "ready" | "error">("loading");
  const [dataMessage, setDataMessage] = useState<string | null>(null);
  const [dataVersion, setDataVersion] = useState(0);
  
  // UI state
  const [viewMode, setViewMode] = useState<ViewMode>("overview");
  const [selectedRecord, setSelectedRecord] = useState<AppReleaseRecord | null>(null);
  const [showDrawer, setShowDrawer] = useState(false);
  
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
    setDataStatus("loading");
    setDataMessage(null);
    loadAppReleases(token)
      .then(({ records: loaded, updatedAt: at }) => {
        setRecords(loaded);
        setUpdatedAt(at);
        setDataStatus(loaded.length === 0 ? "empty" : "ready");
        setDataMessage(loaded.length === 0 ? "尚未生成券商 App 更新数据，请先运行券商 App 更新任务。" : null);
      })
      .catch((err: unknown) => {
        if (err instanceof BackendApiError && err.status === 401) {
          clearAuth("登录已失效，请重新登录");
          return;
        }
        setRecords([]);
        setUpdatedAt(null);
        if (err instanceof AppReleaseNotGeneratedError) {
          setDataStatus("empty");
          setDataMessage(err.message);
        } else {
          setDataStatus("error");
          setDataMessage(err instanceof Error ? err.message : "数据加载失败");
        }
      });
  }, [token, clearAuth, dataVersion]);

  const deferredSearch = useDeferredValue(filters.search.trim().toLowerCase());
  const baseline = useMemo(() => {
    let latest = 0;
    for (const record of records) {
      latest = Math.max(latest, record.publishDate?.getTime() ?? 0);
    }
    return latest > 0 ? new Date(latest) : null;
  }, [records]);

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
  const groups = useMemo(() => groupByBrokerApp(filteredRecords), [filteredRecords]);
  
  // Options for filters
  const brokerOptions = useMemo(() => {
    const set = new Set<string>();
    records.forEach(r => { if (r.brokerName) set.add(r.brokerName); });
    return Array.from(set).sort();
  }, [records]);
  
  const appOptions = useMemo(() => {
    const set = new Set<string>();
    records.forEach(r => { if (r.appName) set.add(r.appName); });
    return Array.from(set).sort();
  }, [records]);
  
  const updateTypeOptions = useMemo(() => getUpdateTypeDistribution(records).map(i => i.name), [records]);
  const tagOptions = useMemo(() => getFeatureTagDistribution(records).map(i => i.name), [records]);

  // Handle record click
  const handleRecordClick = (record: AppReleaseRecord) => {
    setSelectedRecord(record);
    setShowDrawer(true);
  };

  const isBusy = dataStatus === "loading";

  if (!isLoggedIn) {
    return <LoginPageWithApply />;
  }

  return (
    <div className="min-h-screen min-w-0 max-w-full overflow-x-hidden bg-[#F4F7FB]">
      {/* Header */}
      <header
        className="relative flex min-w-0 flex-col overflow-hidden px-3 py-3 text-white sm:h-[76px] sm:flex-row sm:items-center sm:px-8 sm:py-0 sticky top-0 z-40 border-b border-blue-500/20 shrink-0"
        style={{ background: "linear-gradient(105deg, #102847 0%, #17385F 58%, #1E4070 100%)" }}
      >
        <div className="relative z-10 flex flex-1 items-center gap-2 min-w-0">
          <div className="flex items-center gap-2">
            <button
              onClick={() => router.push("/")}
              className="mr-2 flex items-center gap-1 text-xs text-slate-300 hover:text-white transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              返回
            </button>
            <Image src="/brand/company-icon.png" alt="世纪证券" width={36} height={36} className="size-8 shrink-0 rounded-lg sm:size-9" priority />
            <span className="text-lg font-bold">券商 App 更新看板</span>
          </div>
        </div>

        <div className="relative z-10 mt-2 flex min-w-0 items-center gap-1.5 text-[11px] text-slate-300 sm:mt-0 sm:gap-4 sm:text-[12px]">
          {/* Module Switcher */}
          <div className="flex shrink-0 items-center gap-1.5 border-r border-white/10 pr-1.5 sm:border-l sm:border-r-0 sm:pr-0 sm:pl-3.5">
            <ModuleSwitcher activeModule="app-watch" />
          </div>

          {/* Data Status Group */}
          <div className="flex items-center gap-3.5 border-r border-white/10 pr-3.5 hidden md:flex">
              <span className="whitespace-nowrap flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                最新数据：
                <span className="text-white font-medium">
                  {updatedAt ? updatedAt.slice(0, 10) : "数据未生成"}
                </span>
              </span>
          </div>

          {/* Main Actions Group */}
          <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:flex-none sm:gap-2.5">
            <button
              onClick={refreshData}
              disabled={isBusy}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-white/15 text-slate-200 hover:text-white hover:bg-white/10 active:scale-[0.98] transition-all whitespace-nowrap disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isBusy ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline">刷新数据</span>
            </button>
          </div>

          {/* Admin & User Controls Group */}
          <div className="flex shrink-0 items-center gap-1.5 border-l border-white/10 pl-1.5 sm:gap-3 sm:pl-3.5">
            <span className="text-slate-300 max-w-[80px] truncate hidden sm:inline">
              {username}{isAdmin ? "（管理员）" : ""}
            </span>
            <button
              onClick={logout}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 active:scale-[0.95] transition-all"
              title="退出登录"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="mx-auto max-w-[1600px] min-w-0 px-3 py-4 space-y-4 sm:px-8 sm:py-5">
        {/* Status message */}
        {(dataStatus === "loading" || dataStatus === "empty" || dataStatus === "error") && (
          <div
            className={`rounded-[10px] border px-4 py-3 text-[13px] ${
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
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
          <KpiCard label="更新条数" value={statistics.releaseCount} />
          <KpiCard label="覆盖券商" value={statistics.brokerCount} />
          <KpiCard label="覆盖 App" value={statistics.appCount} />
          <KpiCard label="最新更新" value={formatReleaseDate(statistics.latestPublishDate)} isText />
        </div>

        {/* View toggle & filter bar */}
        <div className="space-y-3">
          {/* View toggle */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setViewMode("overview")}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold transition-all duration-200 ${
                viewMode === "overview"
                  ? "border border-[#D7E5FF] bg-white text-[#2563EB] shadow-[0_1px_3px_rgba(16,40,71,0.08)]"
                  : "border border-transparent text-[#667085] hover:bg-white/75 hover:text-[#344054]"
              }`}
            >
              <TrendingUp className="w-4 h-4" />
              更新总览
            </button>
            <button
              onClick={() => setViewMode("details")}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold transition-all duration-200 ${
                viewMode === "details"
                  ? "border border-[#D7E5FF] bg-white text-[#2563EB] shadow-[0_1px_3px_rgba(16,40,71,0.08)]"
                  : "border border-transparent text-[#667085] hover:bg-white/75 hover:text-[#344054]"
              }`}
            >
              <List className="w-4 h-4" />
              更新明细 ({filteredRecords.length})
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
              <div className="grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-6 lg:grid-cols-12">
                <OverviewCharts data={filteredRecords} />
              </div>
              
              {/* Update summary placeholder */}
              <div className="rounded-xl border border-[#E4E9F0] bg-white p-6">
                <h3 className="text-base font-bold text-[#172033]">本期更新摘要</h3>
                <p className="mt-2 text-sm text-[#667085]">
                  {filteredRecords.length === 0
                    ? "暂无更新数据，请先在管理控制台运行券商 App 更新任务。"
                    : `当前筛选条件下共有${filteredRecords.length}条更新记录，覆盖${statistics.brokerCount}家券商和${statistics.appCount}个 App。`}
                </p>
              </div>
            </>
          ) : (
            /* Details table */
            <ReleaseTable
              releases={filteredRecords}
              onSelect={handleRecordClick}
            />
          )}

          {/* Updated at */}
          {updatedAt && (
            <p className="flex items-center gap-1 text-[11px] text-[#98A2B3]">
              <span className="w-3 h-3">📱</span>
              数据更新时间：{updatedAt}
            </p>
          )}
        </div>
      </main>

      {/* Detail drawer */}
      <ReleaseDetailDrawer
        record={selectedRecord}
        onClose={() => setShowDrawer(false)}
      />
    </div>
  );
}
