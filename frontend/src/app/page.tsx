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
import { DashboardHeader } from "@/components/dashboard-header";
import { DashboardFilters } from "@/components/dashboard-filters";
import { DashboardTabs } from "@/components/dashboard-tabs";
import { LoginPage } from "@/components/login-page";
import { MetricCards } from "@/components/metric-cards";
import { ExecutiveSummary } from "@/components/executive-summary";
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
      const avgTagWidth = 110; // average tag width in px
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
    <div className="min-h-screen bg-[#F4F7FB]">
      {/* ─── Top Navigation ─── */}
      <DashboardHeader
        username={username}
        totalBrokers={totalBrokers}
        baseline={baseline}
        filteredData={filteredData}
        isAdmin={isAdmin}
        showDashboard={showDashboard}
        onShowModal={() => setShowModal(true)}
        onExport={() => exportCsv(filteredData)}
        onShowDashboard={setShowDashboard}
        onLogout={logout}
      />

      {/* ─── Main Content ─── */}
      <main className="max-w-[1600px] mx-auto px-3 sm:px-8 py-4 sm:py-5 space-y-4">
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
        <DashboardFilters
          search={search}
          setSearch={setSearch}
          timeRange={timeRange}
          setTimeRange={setTimeRange}
          brokerNames={brokerNames}
          setBrokerNames={setBrokerNames}
          toggleBrokerName={toggleBrokerName}
          primaryDomain={primaryDomain}
          setPrimaryDomain={setPrimaryDomain}
          announcementStage={announcementStage}
          setAnnouncementStage={setAnnouncementStage}
          procurementMethod={procurementMethod}
          setProcurementMethod={setProcurementMethod}
          finTechOnly={finTechOnly}
          setFinTechOnly={setFinTechOnly}
          hasFilters={hasFilters}
          resetAll={resetAll}
          brokerOptions={brokerOptions}
          methodOptions={methodOptions}
          sortedBrokers={sortedBrokers}
          visibleBrokerCount={visibleBrokerCount}
          showAllBrokers={showAllBrokers}
          setShowAllBrokers={setShowAllBrokers}
          brokerTagsRef={brokerTagsRef}
        />

        {/* Tab Bar - Sticky below header */}
        <DashboardTabs
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          filteredCount={filteredData.length}
          headerHeight={headerHeight}
          tabContainerRef={tabContainerRef}
          aiTabRef={aiTabRef}
          overviewTabRef={overviewTabRef}
          tableTabRef={tableTabRef}
          indicatorPos={indicatorPos}
        />

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
