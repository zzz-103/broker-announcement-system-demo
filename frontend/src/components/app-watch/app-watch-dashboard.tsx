"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { LogOut, RefreshCw, Search, Smartphone } from "lucide-react";
import { useAuthStore } from "@/store/auth-store";
import { BackendApiError } from "@/lib/api/backend-client";
import {
  AppReleaseNotGeneratedError,
  getAppReleaseStatistics,
  groupByBrokerApp,
  loadAppReleases,
  sortByPublishDateDesc,
  formatReleaseDate,
  type AppReleaseRecord,
} from "@/lib/app-release-data";
import { type ActiveModule } from "@/components/app-watch/module-switcher";
import { BrokerAppList } from "@/components/app-watch/broker-app-list";
import { ReleaseTimeline } from "@/components/app-watch/release-timeline";
import { ReleaseDetailDrawer } from "@/components/app-watch/release-detail-drawer";
import {
  BrokerReleaseCountChart,
  FeatureTagChart,
  ReleaseTrendChart,
  UpdateTypeChart,
} from "@/components/app-watch/app-watch-charts";

interface AppWatchDashboardProps {
  username: string;
  isAdmin: boolean;
  activeModule: ActiveModule;
  onLogout: () => void;
}

type DataStatus = "loading" | "empty" | "ready" | "error";

export function AppWatchDashboard({
  username,
  isAdmin,
  activeModule,
  onLogout,
}: AppWatchDashboardProps) {
  const { token, clearAuth } = useAuthStore();

  const [records, setRecords] = useState<AppReleaseRecord[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [dataStatus, setDataStatus] = useState<DataStatus>("loading");
  const [dataMessage, setDataMessage] = useState<string | null>(null);
  const [dataVersion, setDataVersion] = useState(0);

  const [search, setSearch] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectedRecord, setSelectedRecord] = useState<AppReleaseRecord | null>(null);

  const refreshData = useCallback(() => setDataVersion((v) => v + 1), []);

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

  const deferredSearch = search.trim().toLowerCase();

  const filteredRecords = useMemo(() => {
    if (!deferredSearch) return records;
    return records.filter((r) => r.searchText.includes(deferredSearch));
  }, [records, deferredSearch]);

  const groups = useMemo(() => groupByBrokerApp(filteredRecords), [filteredRecords]);
  const statistics = useMemo(() => getAppReleaseStatistics(filteredRecords), [filteredRecords]);

  const selectedGroup = useMemo(
    () => groups.find((g) => g.key === selectedKey) ?? null,
    [groups, selectedKey],
  );

  const timelineReleases = useMemo(() => {
    if (selectedGroup) return selectedGroup.releases;
    return sortByPublishDateDesc(filteredRecords).slice(0, 100);
  }, [selectedGroup, filteredRecords]);

  const timelineTitle = selectedGroup
    ? `${selectedGroup.brokerName} · ${selectedGroup.appName} 更新时间线`
    : "全部更新时间线";

  const isBusy = dataStatus === "loading";

  return (
    <div className="min-h-screen min-w-0 max-w-full overflow-x-hidden bg-[#F4F7FB]">
      {/* Header shell (reuses procurement styling tokens) */}
      <header
        className="relative flex min-w-0 flex-col overflow-hidden px-3 py-3 text-white sm:h-[76px] sm:flex-row sm:items-center sm:px-8 sm:py-0 sticky top-0 z-40 border-b border-blue-500/20 shrink-0"
        style={{
          background: "linear-gradient(105deg, #102847 0%, #17385F 58%, #1E4070 100%)",
        }}
      >
        <div className="relative z-10 flex flex-1 items-center gap-2 min-w-0">
          <Image
            src="/brand/company-icon.png"
            alt="世纪证券"
            width={36}
            height={36}
            className="size-8 shrink-0 rounded-lg sm:size-9"
            priority
          />
          <h1 className="min-w-0 text-[15px] font-bold leading-tight tracking-wide text-white sm:text-[18px]">
            券商 App 更新看板
          </h1>
        </div>

        <div className="relative z-10 mt-2 flex min-w-0 items-center gap-1.5 text-[11px] text-slate-300 sm:mt-0 sm:gap-4 sm:text-[12px]">
          <button
            onClick={refreshData}
            disabled={isBusy}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-white/15 text-slate-200 hover:text-white hover:bg-white/10 active:scale-[0.98] transition-all whitespace-nowrap disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isBusy ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">刷新数据</span>
          </button>
          <div className="flex shrink-0 items-center gap-2.5 border-l border-white/10 pl-3.5">
            <span className="text-slate-300 max-w-[80px] truncate hidden sm:inline">
              {username}
              {isAdmin ? "（管理员）" : ""}
            </span>
            <button
              onClick={onLogout}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 active:scale-[0.95] transition-all"
              title="退出登录"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] min-w-0 px-3 py-4 space-y-4 sm:px-8 sm:py-5">
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

        {/* Metric cards + search */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
          <MetricCard label="更新条数" value={statistics.releaseCount} />
          <MetricCard label="覆盖券商" value={statistics.brokerCount} />
          <MetricCard label="覆盖 App" value={statistics.appCount} />
          <MetricCard
            label="最新更新"
            value={formatReleaseDate(statistics.latestPublishDate)}
            isText
          />
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#98A2B3]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索券商、App、版本或更新内容"
            className="w-full rounded-xl border border-[#E4EAF2] bg-white py-2.5 pl-9 pr-3 text-[13px] text-[#172033] outline-none transition-colors focus:border-[#2563EB]"
          />
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-6 lg:grid-cols-12">
          <ReleaseTrendChart data={filteredRecords} />
          <UpdateTypeChart data={filteredRecords} />
          <FeatureTagChart data={filteredRecords} />
          <BrokerReleaseCountChart data={filteredRecords} />
        </div>

        {/* List + timeline */}
        <div className="grid grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <BrokerAppList groups={groups} selectedKey={selectedKey} onSelect={setSelectedKey} />
          </div>
          <div className="lg:col-span-7">
            <ReleaseTimeline
              title={timelineTitle}
              releases={timelineReleases}
              onSelect={setSelectedRecord}
            />
          </div>
        </div>

        {updatedAt && (
          <p className="flex items-center gap-1 text-[11px] text-[#98A2B3]">
            <Smartphone className="w-3 h-3" />
            数据更新时间：{updatedAt}
          </p>
        )}
      </main>

      <ReleaseDetailDrawer record={selectedRecord} onClose={() => setSelectedRecord(null)} />
    </div>
  );
}

function MetricCard({
  label,
  value,
  isText,
}: {
  label: string;
  value: number | string;
  isText?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-[#E4EAF2] bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
      <div className="text-[12px] text-[#667085]">{label}</div>
      <div
        className={`mt-1 font-bold text-[#172033] ${isText ? "text-[16px]" : "text-[24px]"}`}
      >
        {value}
      </div>
    </div>
  );
}
