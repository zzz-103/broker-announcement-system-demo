"use client";

import { useCallback, useEffect, useState, useMemo, useRef, useLayoutEffect } from "react";
import dynamic from "next/dynamic";
import {
  DataNotGeneratedError,
  loadAndProcessData,
  getDataBaseline,
  formatDate,
  exportCsv,
  uniqueCount,
  type ProcessedRecord,
} from "@/lib/announcement-data";
import { useFilterStore, type TimeRange } from "@/store/filter-store";
import { useAuthStore } from "@/store/auth-store";
import { BackendApiError } from "@/lib/api/backend-client";
import { LoginPage } from "@/components/login-page";
import { MetricCards } from "@/components/metric-cards";
import { ExecutiveSummary } from "@/components/executive-summary";
import {
  Search,
  RotateCcw,
  Download,
  Settings,
  LogOut,
} from "lucide-react";
import { HoverSelect } from "@/components/hover-select";
import { MultiHoverSelect } from "@/components/multi-hover-select";

// ─── Dynamic imports for heavy components (code splitting) ───
const AdminDashboard = dynamic(
  () => import("@/components/admin-dashboard").then((m) => m.AdminDashboard),
  { ssr: false }
);
const AiSummary = dynamic(
  () => import("@/components/ai-summary").then((m) => m.AiSummary),
  { ssr: false, loading: () => <div className="h-48 animate-pulse bg-white rounded-xl border border-[#E4E9F0]" /> }
);
const ProcurementTrendChart = dynamic(
  () => import("@/components/charts").then((m) => m.ProcurementTrendChart),
  { ssr: false, loading: () => <div className="h-64 animate-pulse bg-white rounded-xl border border-[#E4E9F0]" /> }
);
const DomainDistributionChart = dynamic(
  () => import("@/components/charts").then((m) => m.DomainDistributionChart),
  { ssr: false, loading: () => <div className="h-64 animate-pulse bg-white rounded-xl border border-[#E4E9F0]" /> }
);
const StageDistributionChart = dynamic(
  () => import("@/components/charts").then((m) => m.StageDistributionChart),
  { ssr: false, loading: () => <div className="h-64 animate-pulse bg-white rounded-xl border border-[#E4E9F0]" /> }
);
const BrokerActivityCard = dynamic(
  () => import("@/components/observation-cards").then((m) => m.BrokerActivityCard),
  { ssr: false }
);
const SupplierObservationCard = dynamic(
  () => import("@/components/observation-cards").then((m) => m.SupplierObservationCard),
  { ssr: false }
);
const PriceSamplesCard = dynamic(
  () => import("@/components/observation-cards").then((m) => m.PriceSamplesCard),
  { ssr: false }
);
const KeyProjectRadar = dynamic(
  () => import("@/components/key-project-radar").then((m) => m.KeyProjectRadar),
  { ssr: false }
);
const ProjectTable = dynamic(
  () => import("@/components/project-table").then((m) => m.ProjectTable),
  { ssr: false }
);
const ProjectDetailDrawer = dynamic(
  () => import("@/components/project-detail-drawer").then((m) => m.ProjectDetailDrawer),
  { ssr: false }
);
const DataDefinitionModal = dynamic(
  () => import("@/components/data-definition-modal").then((m) => m.DataDefinitionModal),
  { ssr: false }
);

const DOMAIN_OPTIONS = [
  "AI与智能化",
  "数据治理与数据平台",
  "财富管理与客户经营",
  "交易、柜台与核心系统",
  "APP与数字化渠道",
  "网络安全与监管科技",
  "云计算、算力与基础设施",
  "IT运维与技术服务",
  "投研资讯与金融数据",
  "非金融科技及其他",
];

export default function Dashboard() {
  const [allData, setAllData] = useState<ProcessedRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dataStatus, setDataStatus] = useState<"loading" | "empty" | "ready" | "error">("loading");
  const [dataMessage, setDataMessage] = useState<string | null>(null);
  const [selectedProject, setSelectedProject] =
    useState<ProcessedRecord | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [activeTab, setActiveTab] = useState<"ai" | "overview" | "table">("overview");
  const [showDashboard, setShowDashboard] = useState(false);
  const [dataVersion, setDataVersion] = useState(0);

  // Auth state
  const { isLoggedIn, isAdmin, username, logout, token, clearAuth } = useAuthStore();
  const restoreSession = useAuthStore((s) => s.restoreSession);

  useEffect(() => {
    restoreSession();
  }, [restoreSession]);

  // Header height measurement for sticky tab bar positioning
  const headerRef = useRef<HTMLElement>(null);
  const [headerHeight, setHeaderHeight] = useState(72);

  // Tab indicator refs and measurement
  const tabContainerRef = useRef<HTMLDivElement>(null);
  const aiTabRef = useRef<HTMLButtonElement>(null);
  const overviewTabRef = useRef<HTMLButtonElement>(null);
  const tableTabRef = useRef<HTMLButtonElement>(null);
  const [indicatorPos, setIndicatorPos] = useState({ left: "0px", width: "0px" });

  // Broker tags: limit to 2 rows, sorted by data volume
  const brokerTagsRef = useRef<HTMLDivElement>(null);
  const [visibleBrokerCount, setVisibleBrokerCount] = useState(999);
  const [showAllBrokers, setShowAllBrokers] = useState(false);

  const {
    search,
    timeRange,
    brokerNames,
    primaryDomain,
    announcementStage,
    procurementMethod,
    finTechOnly,
    detailFilter,
    setSearch,
    setTimeRange,
    setBrokerNames,
    toggleBrokerName,
    setPrimaryDomain,
    setAnnouncementStage,
    setProcurementMethod,
    setFinTechOnly,
    setDetailFilter,
    resetAll,
  } = useFilterStore();

  const refreshData = useCallback(() => {
    setDataVersion((version) => version + 1);
  }, []);

  // Only load data after login
  useEffect(() => {
    if (!isLoggedIn || !token) return;
    setIsLoading(true);
    setDataStatus("loading");
    setDataMessage(null);
    loadAndProcessData(token)
      .then((records) => {
        setAllData(records);
        setDataStatus(records.length === 0 ? "empty" : "ready");
        setDataMessage(
          records.length === 0
            ? "尚未生成看板数据，请先运行爬虫和 LLM。"
            : null
        );
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (err instanceof BackendApiError && err.status === 401) {
          clearAuth("登录已失效，请重新登录");
          return;
        }
        if (err instanceof DataNotGeneratedError) {
          setAllData([]);
          setDataStatus("empty");
          setDataMessage(err.message);
        } else {
          setAllData([]);
          setDataStatus("error");
          setDataMessage(err instanceof Error ? err.message : "数据加载失败");
        }
        setIsLoading(false);
      });
  }, [clearAuth, dataVersion, isLoggedIn, token]);

  const baseline = useMemo(() => getDataBaseline(allData), [allData]);

  // Options for dropdowns
  const brokerOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of allData) {
      if (r.validBrokerName !== "主体待识别") set.add(r.validBrokerName);
    }
    return Array.from(set).sort();
  }, [allData]);

  const methodOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of allData) {
      if (r.procurement_method) set.add(r.procurement_method);
    }
    return Array.from(set).sort();
  }, [allData]);

  // Filtered data
  const filteredData = useMemo(() => {
    let result = allData;

    // FinTech only
    if (finTechOnly) {
      result = result.filter((r) => r.isFinTech);
    }

    // Time range
    if (baseline && timeRange !== "all") {
      const now = baseline;
      let cutoff: Date | null = null;
      if (timeRange === "30d")
        cutoff = new Date(now.getTime() - 30 * 86400000);
      else if (timeRange === "90d")
        cutoff = new Date(now.getTime() - 90 * 86400000);
      else if (timeRange === "year")
        cutoff = new Date(now.getFullYear(), 0, 1);
      if (cutoff) {
        result = result.filter(
          (r) => r.validPublishDate && r.validPublishDate >= cutoff!
        );
      }
    }

    // Search
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (r) =>
          r.project_name_raw.toLowerCase().includes(q) ||
          r.validBrokerName.toLowerCase().includes(q) ||
          r.normalizedSupplier.toLowerCase().includes(q) ||
          r.procurement_method.toLowerCase().includes(q)
      );
    }

    if (brokerNames.length > 0)
      result = result.filter((r) => brokerNames.includes(r.validBrokerName));
    if (primaryDomain)
      result = result.filter((r) => r.primaryDomain === primaryDomain);
    if (announcementStage)
      result = result.filter((r) => r.announcement_stage === announcementStage);
    if (procurementMethod)
      result = result.filter((r) => r.procurement_method === procurementMethod);

    // Detail filter (from metric card clicks)
    if (detailFilter) {
      if (detailFilter.hasPrice === "true") {
        result = result.filter((r) => r.winning_amount_yuan !== null);
      }
    }

    return result;
  }, [
    allData,
    finTechOnly,
    timeRange,
    baseline,
    search,
    brokerNames,
    primaryDomain,
    announcementStage,
    procurementMethod,
    detailFilter,
  ]);

  // Sort brokers by data volume (most records first)
  const sortedBrokers = useMemo(() => {
    const countMap = new Map<string, number>();
    allData.forEach((r) => {
      if (r.validBrokerName && r.validBrokerName !== "主体待识别") {
        countMap.set(r.validBrokerName, (countMap.get(r.validBrokerName) || 0) + 1);
      }
    });
    return [...brokerOptions].sort((a, b) => (countMap.get(b) || 0) - (countMap.get(a) || 0));
  }, [allData, brokerOptions]);

  // Measure header height for sticky tab bar positioning
  useLayoutEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const update = () => setHeaderHeight(header.offsetHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(header);
    return () => ro.disconnect();
  }, []);

  // Measure broker tags container and calculate visible count (max 2 rows)
  useLayoutEffect(() => {
    const container = brokerTagsRef.current;
    if (!container || sortedBrokers.length === 0) return;

    const measure = () => {
      const containerWidth = container.offsetWidth;
      // Estimate tag width: ~12px per char + 20px padding + 6px gap
      const avgTagWidth = 80; // average tag width in px
      const gap = 6;
      const tagsPerRow = Math.max(1, Math.floor((containerWidth + gap) / (avgTagWidth + gap)));
      setVisibleBrokerCount(showAllBrokers ? sortedBrokers.length : tagsPerRow * 2);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [sortedBrokers, showAllBrokers]);

  // Measure tab indicator position after render
  useLayoutEffect(() => {
    const container = tabContainerRef.current;
    const activeBtn = activeTab === "ai" ? aiTabRef.current : activeTab === "overview" ? overviewTabRef.current : tableTabRef.current;
    if (container && activeBtn) {
      const containerRect = container.getBoundingClientRect();
      const btnRect = activeBtn.getBoundingClientRect();
      setIndicatorPos({
        left: `${btnRect.left - containerRect.left}px`,
        width: `${btnRect.width}px`,
      });
    }
  }, [activeTab, filteredData.length]);

  const hasFilters =
    search ||
    brokerNames.length > 0 ||
    primaryDomain ||
    announcementStage ||
    procurementMethod ||
    timeRange !== "90d" ||
    !finTechOnly ||
    detailFilter;

  const totalBrokers = useMemo(
    () =>
      uniqueCount(
        allData
          .filter((r) => r.validBrokerName !== "主体待识别")
          .map((r) => r.validBrokerName)
      ),
    [allData]
  );

  // Show login page if not logged in
  if (!isLoggedIn) {
    return <LoginPage />;
  }

  // Show admin dashboard if admin requested it
  if (showDashboard && isAdmin) {
    return (
      <AdminDashboard
        onBack={() => setShowDashboard(false)}
        onDataRefresh={refreshData}
      />
    );
  }

  return (
    <div className="min-h-screen bg-[#F5F7FA]">
      {/* ─── Top Navigation ─── */}
      <header ref={headerRef} className="bg-[#162B49] flex flex-col sm:flex-row sm:h-[72px] sm:items-center px-4 sm:px-8 py-3 sm:py-0 sticky top-0 z-40 gap-2 sm:gap-0">
        <div className="flex-1 min-w-0">
          <h1 className="text-[16px] sm:text-[18px] font-semibold text-white leading-tight truncate">
            券商金融科技招采情报平台
          </h1>
          <p className="text-[11px] sm:text-[12px] text-white/60 truncate">
            同行建设方向、公开招采动态、供应商与价格信息
          </p>
        </div>
        <div className="flex items-center gap-3 sm:gap-5 text-[11px] sm:text-[12px] text-white/70 flex-wrap">
          <span className="whitespace-nowrap">
            数据最新:{" "}
            <span className="text-white font-medium">
              {formatDate(baseline)}
            </span>
          </span>
          <span className="whitespace-nowrap">
            覆盖主体:{" "}
            <span className="text-white font-medium">{totalBrokers}</span>
          </span>
          <button
            onClick={() => setShowModal(true)}
            className="px-2.5 sm:px-3 py-1 sm:py-1.5 rounded border border-white/20 text-white/80 hover:bg-white/10 transition-colors"
          >
            数据口径
          </button>
          <button
            onClick={() => exportCsv(filteredData)}
            className="group relative inline-flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg bg-gradient-to-r from-[#2563EB] to-[#1D4ED8] text-white text-[12px] sm:text-[13px] font-medium shadow-[0_2px_8px_rgba(37,99,235,0.35)] hover:shadow-[0_4px_16px_rgba(37,99,235,0.45)] hover:from-[#3B82F6] hover:to-[#2563EB] active:scale-[0.97] transition-all duration-200"
          >
            <Download className="w-3.5 h-3.5 sm:w-4 sm:h-4 transition-transform group-hover:-translate-y-0.5" />
            <span>导出当前数据</span>
            <span className="hidden sm:inline-flex items-center px-1.5 py-0.5 rounded bg-white/20 text-[10px] font-normal ml-0.5">
              {filteredData.length}
            </span>
          </button>
          {/* Admin Dashboard Button */}
          {isAdmin && (
            <button
              onClick={() => setShowDashboard(true)}
              className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded border border-amber-400/40 text-amber-300 hover:bg-amber-400/10 transition-colors"
            >
              <Settings className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">管理控制台</span>
            </button>
          )}
          {/* User Info & Logout */}
          <div className="flex items-center gap-2">
            <span className="text-white/60 hidden sm:inline">{username}</span>
            <button
              onClick={logout}
              className="flex items-center gap-1 px-2 py-1 rounded text-white/60 hover:text-white hover:bg-white/10 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </header>

      {/* ─── Main Content ─── */}
      <main className="max-w-[1600px] mx-auto px-3 sm:px-8 py-4 sm:py-5 space-y-3 sm:space-y-4">
        {(isLoading || dataStatus === "empty" || dataStatus === "error") && (
          <div
            className={`rounded-[10px] border px-4 py-3 text-[13px] ${
              dataStatus === "error"
                ? "border-red-100 bg-red-50 text-red-600"
                : "border-amber-100 bg-amber-50 text-amber-700"
            }`}
          >
            {isLoading
              ? "正在加载看板数据..."
              : dataMessage || "尚未生成看板数据，请先运行爬虫和 LLM。"}
          </div>
        )}

        {/* Global Filter Bar */}
        <div className="bg-white rounded-[10px] border border-[#E4E9F0] shadow-[0_1px_2px_rgba(0,0,0,0.04)] px-3 sm:px-5 py-3">
          <div className="flex items-center gap-3 sm:gap-4 flex-wrap">
            {/* Search */}
            <div className="relative w-full sm:w-[30%] sm:min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#98A2B3]" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索项目、券商、供应商或采购方式..."
                className="w-full pl-9 pr-3 py-2 text-[13px] border border-[#E4E9F0] rounded-md bg-[#F8FAFC] text-[#172033] placeholder:text-[#98A2B3] focus:outline-none focus:ring-1 focus:ring-[#2563EB]/30 focus:border-[#2563EB]/30 transition-colors"
              />
            </div>

            {/* Time Range */}
            <HoverSelect
              value={timeRange}
              onChange={(v) => setTimeRange(v as TimeRange)}
              options={[
                { value: "30d", label: "近30日" },
                { value: "90d", label: "近90日" },
                { value: "year", label: "本年度" },
                { value: "all", label: "全部时间" },
              ]}
              placeholder="时间范围"
            />

            {/* Broker - Multi Select */}
            <MultiHoverSelect
              values={brokerNames}
              onChange={setBrokerNames}
              onToggle={toggleBrokerName}
              options={brokerOptions.map((b) => ({ value: b, label: b }))}
              placeholder="全部券商"
              maxHeight={240}
            />

            {/* Domain */}
            <HoverSelect
              value={primaryDomain}
              onChange={setPrimaryDomain}
              options={[
                { value: "", label: "全部方向" },
                ...DOMAIN_OPTIONS.map((d) => ({ value: d, label: d })),
              ]}
              placeholder="全部方向"
              maxHeight={280}
            />

            {/* Stage */}
            <HoverSelect
              value={announcementStage}
              onChange={setAnnouncementStage}
              options={[
                { value: "", label: "全部阶段" },
                { value: "采购招标", label: "采购招标" },
                { value: "结果公示", label: "结果公示" },
                { value: "流标废标", label: "流标废标" },
              ]}
              placeholder="全部阶段"
            />

            {/* Method */}
            <HoverSelect
              value={procurementMethod}
              onChange={setProcurementMethod}
              options={[
                { value: "", label: "全部方式" },
                ...methodOptions.map((m) => ({ value: m, label: m })),
              ]}
              placeholder="全部方式"
              maxHeight={240}
            />

            {/* FinTech Toggle */}
            <label className="flex items-center gap-2 text-[12px] text-[#667085] cursor-pointer select-none whitespace-nowrap">
              <input
                type="checkbox"
                checked={finTechOnly}
                onChange={(e) => setFinTechOnly(e.target.checked)}
                className="w-3.5 h-3.5 rounded border-[#E4E9F0] text-[#2563EB] focus:ring-[#2563EB]/30"
              />
              仅看金融科技
            </label>

            {/* Reset */}
            {hasFilters && (
              <button
                onClick={resetAll}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[12px] text-[#667085] hover:text-[#172033] hover:bg-gray-100 rounded-md transition-colors"
              >
                <RotateCcw className="w-3 h-3" />
                重置
              </button>
            )}
          </div>

          {/* All Broker Tags - max 2 rows */}
          <div className="flex items-start gap-2 mt-2.5 pt-2.5 border-t border-[#F0F2F5]">
            <span className="text-[11px] text-[#98A2B3] shrink-0 mt-1">券商</span>
            {brokerNames.length > 0 && (
              <button
                onClick={() => setBrokerNames([])}
                className="px-2 py-0.5 text-[11px] text-[#667085] hover:text-[#D64545] transition-colors mt-0.5"
              >
                清除
              </button>
            )}
            <div ref={brokerTagsRef} className="flex items-center gap-1.5 flex-wrap overflow-hidden" style={{ maxHeight: showAllBrokers ? "none" : "56px" }}>
              {sortedBrokers.slice(0, visibleBrokerCount).map((broker) => {
                const isSelected = brokerNames.includes(broker);
                return (
                  <button
                    key={broker}
                    onClick={() => toggleBrokerName(broker)}
                    className={`
                      px-2.5 py-1 text-[12px] rounded-md transition-all duration-150 whitespace-nowrap
                      ${isSelected
                        ? "bg-[#2563EB] text-white shadow-sm"
                        : "bg-[#F5F7FA] text-[#475467] hover:bg-[#EBF0F7] hover:text-[#172033]"
                      }
                    `}
                  >
                    {broker}
                  </button>
                );
              })}
              {visibleBrokerCount < sortedBrokers.length && (
                <button
                  onClick={() => setShowAllBrokers(true)}
                  className="px-2.5 py-1 text-[12px] rounded-md bg-[#EBF0F7] text-[#2563EB] hover:bg-[#DBEAFE] transition-colors whitespace-nowrap"
                >
                  +{sortedBrokers.length - visibleBrokerCount} 更多
                </button>
              )}
              {showAllBrokers && visibleBrokerCount >= sortedBrokers.length && (
                <button
                  onClick={() => setShowAllBrokers(false)}
                  className="px-2.5 py-1 text-[12px] rounded-md bg-[#EBF0F7] text-[#667085] hover:bg-gray-200 transition-colors whitespace-nowrap"
                >
                  收起
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Tab Bar - Sticky below header */}
        <div className="sticky z-30 bg-[#F5F7FA] -mx-3 sm:-mx-8 px-3 sm:px-8 py-2.5 sm:py-3 border-b border-[#E4E9F0]" style={{ top: `${headerHeight}px` }}>
          <div className="relative flex items-center gap-1" ref={tabContainerRef}>
            {/* Liquid Glass Indicator */}
            <div
              className="absolute top-1/2 -translate-y-1/2 pointer-events-none"
              style={{
                left: indicatorPos.left,
                width: indicatorPos.width,
                height: "38px",
                transition: "left 0.4s cubic-bezier(0.25, 1, 0.3, 1), width 0.35s cubic-bezier(0.25, 1, 0.3, 1)",
              }}
            >
              <div className="absolute inset-0 rounded-lg bg-[#162B49] shadow-[0_2px_16px_rgba(22,43,73,0.3)]" />
              <div className="absolute inset-0 rounded-lg bg-gradient-to-b from-white/[0.18] via-white/[0.05] to-transparent" />
              <div className="absolute inset-[1px] rounded-[7px] bg-gradient-to-b from-white/[0.08] to-transparent" />
            </div>

            <button
              ref={aiTabRef}
              onClick={() => setActiveTab("ai")}
              className={`
                relative z-10 px-5 py-2 text-[14px] font-medium rounded-lg transition-colors duration-300
                ${activeTab === "ai" ? "text-white" : "text-[#667085] hover:text-[#172033]"}
              `}
            >
              AI 分析
            </button>
            <button
              ref={overviewTabRef}
              onClick={() => setActiveTab("overview")}
              className={`
                relative z-10 px-5 py-2 text-[14px] font-medium rounded-lg transition-colors duration-300
                ${activeTab === "overview" ? "text-white" : "text-[#667085] hover:text-[#172033]"}
              `}
            >
              情报总览
            </button>
            <button
              ref={tableTabRef}
              onClick={() => setActiveTab("table")}
              className={`
                relative z-10 px-5 py-2 text-[14px] font-medium rounded-lg transition-colors duration-300
                ${activeTab === "table" ? "text-white" : "text-[#667085] hover:text-[#172033]"}
              `}
            >
              项目明细
              <span className={`ml-1.5 text-[11px] transition-opacity duration-300 ${activeTab === "table" ? "opacity-70" : "opacity-50"}`}>
                ({filteredData.length})
              </span>
            </button>
          </div>
        </div>

        {/* Tab Content */}
        {activeTab === "ai" ? (
          <AiSummary />
        ) : activeTab === "overview" ? (
          <>
            {/* Metric Cards */}
            <MetricCards data={filteredData} allData={allData} />

            {/* Executive Summary */}
            <ExecutiveSummary data={filteredData} allData={allData} />

            {/* Charts */}
            <div className="grid grid-cols-1 md:grid-cols-6 lg:grid-cols-12 gap-3 sm:gap-4">
              <ProcurementTrendChart data={filteredData} allData={allData} />
              <DomainDistributionChart data={filteredData} allData={allData} />
              <StageDistributionChart data={filteredData} allData={allData} />
            </div>

            {/* Observation Cards */}
            <div className="grid grid-cols-1 md:grid-cols-6 lg:grid-cols-12 gap-3 sm:gap-4">
              <BrokerActivityCard data={filteredData} allData={allData} />
              <SupplierObservationCard data={filteredData} allData={allData} />
              <PriceSamplesCard data={filteredData} allData={allData} />
            </div>

            {/* Key Project Radar */}
            <KeyProjectRadar
              data={filteredData}
              allData={allData}
              onSelectProject={setSelectedProject}
            />
          </>
        ) : (
          /* Project Table Tab */
          <ProjectTable
            data={filteredData}
            onSelectProject={setSelectedProject}
          />
        )}
      </main>

      {/* Drawer */}
      <ProjectDetailDrawer
        record={selectedProject}
        onClose={() => setSelectedProject(null)}
      />

      {/* Modal */}
      <DataDefinitionModal
        open={showModal}
        onClose={() => setShowModal(false)}
      />
    </div>
  );
}
