"use client";

import { useCallback, useDeferredValue, useEffect, useState, useMemo, useRef, useLayoutEffect } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  DataNotGeneratedError,
  loadAndProcessData,
  getDataBaseline,
  getDashboardStatistics,
  getValidBrokerName,
  recordMatchesSearch,
  exportCsv,
  type ProcessedRecord,
} from "@/lib/announcement-data";
import { useFilterStore, type TimeRange } from "@/store/filter-store";
import { useAuthStore } from "@/store/auth-store";
import { BackendApiError, recordDashboardView } from "@/lib/api/backend-client";
import { getAuditContext } from "@/lib/audit-context";
import { DashboardHeader } from "@/components/dashboard-header";
import { DashboardFilters } from "@/components/dashboard-filters";
import { DashboardTabs } from "@/components/dashboard-tabs";
import { LoginPageWithApply } from "@/components/login-page-with-apply";
import { MetricCards } from "@/components/metric-cards";
import { ExecutiveSummary } from "@/components/executive-summary";
import { FeedbackDialog } from "@/components/feedback-dialog";
import type { FeedbackCategory } from "@/lib/api/backend-client";
import type { ActiveModule } from "@/components/app-watch/module-switcher";
import type { DashboardFilters as DashboardFiltersData, DashboardOverview } from "@dashboard-data/contracts";

const DOMAIN_OPTIONS = [
  "AI 与智能化",
  "数据治理与数据平台",
  "财富管理与客户经营",
  "交易、柜台与核心系统",
  "APP 与数字化渠道",
  "网络安全与监管科技",
  "云计算、算力与基础设施",
  "IT 运维与技术服务",
  "投研资讯与金融数据",
  "非金融科技及其他",
];

// Dynamic imports for heavy components (code splitting)
const AdminDashboard = dynamic(
  () => import("@/features/admin/admin-dashboard").then((m) => m.AdminDashboard),
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

export default function Dashboard() {
  const router = useRouter();
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
  const [dataUpdatedAt, setDataUpdatedAt] = useState<string | null>(null);
  const [dataOverview, setDataOverview] = useState<DashboardOverview | null>(null);
  const [dataFilters, setDataFilters] = useState<DashboardFiltersData | null>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackCategory, setFeedbackCategory] = useState<FeedbackCategory | undefined>();
  const [feedbackBrokerName, setFeedbackBrokerName] = useState("");
  const [activeModule, setActiveModule] = useState<ActiveModule>("procurement");
  const [landingResolved, setLandingResolved] = useState(false);
  const [requestedProcurementView, setRequestedProcurementView] = useState(false);

  // App Watch returns here with an explicit view marker. Admin users normally
  // land in the admin console at "/", but this navigation must show the
  // procurement dashboard instead.
  useEffect(() => {
    setRequestedProcurementView(
      new URLSearchParams(window.location.search).get("view") === "procurement",
    );
  }, []);

  // Detect path changes and update activeModule accordingly
  useEffect(() => {
    const handleLocationChange = () => {
      const path = window.location.pathname;
      if (path === "/app-updates") {
        setActiveModule("app-watch");
      } else {
        setActiveModule("procurement");
      }
    };

    // Initial check
    handleLocationChange();

    // Listen to popstate events (browser back/forward)
    const handlePopState = () => {
      handleLocationChange();
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  // Auth state
  const { isLoggedIn, isAdmin, username, logout, token, clearAuth } = useAuthStore();
  const restoreSession = useAuthStore((s) => s.restoreSession);

  useEffect(() => {
    restoreSession();
  }, [restoreSession]);

  useEffect(() => {
    if (!isLoggedIn) {
      setLandingResolved(false);
      return;
    }
    setShowDashboard(isAdmin && !requestedProcurementView);
    setLandingResolved(true);
  }, [isAdmin, isLoggedIn, requestedProcurementView]);

  useEffect(() => {
    if (!isLoggedIn || !token || showDashboard || !landingResolved) return;
    void recordDashboardView(token, getAuditContext()).catch((error: unknown) => {
      if (error instanceof BackendApiError && error.status === 401) {
        clearAuth("登录已失效，请重新登录");
      }
    });
  }, [clearAuth, isLoggedIn, landingResolved, showDashboard, token]);

  // Header height measurement for sticky tab bar positioning
  const headerRef = useRef<HTMLElement>(null);
  const [headerHeight, setHeaderHeight] = useState(72);

  // Broker tags: show the 20 most active brokers until explicitly expanded.
  const [showAllBrokers, setShowAllBrokers] = useState(false);

  const {
    search,
    timeRange,
    brokerNames,
    primaryDomain,
    announcementStage,
    procurementMethod,
    finTechOnly,
    setSearch,
    setTimeRange,
    setBrokerNames,
    toggleBrokerName,
    setPrimaryDomain,
    setAnnouncementStage,
    setProcurementMethod,
    setFinTechOnly,
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
      .then(({ records, updatedAt, overview, filters }) => {
        setAllData(records);
        setDataUpdatedAt(updatedAt);
        setDataOverview(overview);
        setDataFilters(filters);
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
          setDataUpdatedAt(null);
          setDataOverview(null);
          setDataFilters(null);
          setDataStatus("empty");
          setDataMessage(err.message);
        } else {
          setAllData([]);
          setDataUpdatedAt(null);
          setDataOverview(null);
          setDataFilters(null);
          setDataStatus("error");
          setDataMessage(err instanceof Error ? err.message : "数据加载失败");
        }
        setIsLoading(false);
      });
  }, [clearAuth, dataVersion, isLoggedIn, token]);

  const baseline = useMemo(() => getDataBaseline(allData), [allData]);
  const dashboardStatistics = useMemo(() => getDashboardStatistics(allData), [allData]);
  const deferredSearch = useDeferredValue(search.toLowerCase());

  const derivedMethodOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of allData) {
      if (r.procurement_method) set.add(r.procurement_method);
    }
    return Array.from(set).sort();
  }, [allData]);
  const methodOptions = dataFilters?.procurement.procurement_methods ?? derivedMethodOptions;

  // Apply all filters except broker multi-select so broker options do not disappear
  // because of their own selection.
  const dataBeforeBrokerFilter = useMemo(() => {
    let cutoff: Date | null = null;
    if (baseline && timeRange !== "all") {
      if (timeRange === "30d")
        cutoff = new Date(baseline.getTime() - 30 * 86400000);
      else if (timeRange === "90d")
        cutoff = new Date(baseline.getTime() - 90 * 86400000);
      else if (timeRange === "year")
        cutoff = new Date(baseline.getFullYear(), 0, 1);
    }
    // Keep all dashboard derivation in the visitor's browser and scan the
    // projected records once per filter change instead of allocating a new
    // full array for every individual condition.
    return allData.filter((record) => {
      if (finTechOnly && !record.isFinTech) return false;
      if (cutoff && (!record.validPublishDate || record.validPublishDate < cutoff)) return false;
      if (deferredSearch && !recordMatchesSearch(record, deferredSearch)) return false;
      if (primaryDomain && record.primaryDomain !== primaryDomain) return false;
      if (announcementStage && record.announcement_stage !== announcementStage) return false;
      if (procurementMethod && record.procurement_method !== procurementMethod) return false;
      return true;
    });
  }, [
    allData,
    finTechOnly,
    timeRange,
    baseline,
    deferredSearch,
    primaryDomain,
    announcementStage,
    procurementMethod,
  ]);

  // Options for dropdowns: derived from real data after other filters only.
  const brokerOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of dataBeforeBrokerFilter) {
      const brokerName = getValidBrokerName(r);
      if (brokerName) set.add(brokerName);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  }, [dataBeforeBrokerFilter]);

  const allBrokerOptions = useMemo(
    () => dataFilters?.procurement.brokers ?? [...dashboardStatistics.brokerNames].sort((a, b) => a.localeCompare(b, "zh-Hans-CN")),
    [dataFilters, dashboardStatistics.brokerNames]
  );

  useEffect(() => {
    if (brokerNames.length === 0) return;
    const validOptions = new Set(brokerOptions);
    const nextBrokerNames = brokerNames.filter((name) => validOptions.has(name));
    if (nextBrokerNames.length !== brokerNames.length) {
      setBrokerNames(nextBrokerNames);
    }
  }, [brokerNames, brokerOptions, setBrokerNames]);

  // Final filtered data
  const filteredData = useMemo(() => {
    if (brokerNames.length === 0) return dataBeforeBrokerFilter;
    const selectedBrokers = new Set(brokerNames);
    return dataBeforeBrokerFilter.filter((r) => {
      const brokerName = getValidBrokerName(r);
      return brokerName !== null && selectedBrokers.has(brokerName);
    });
  }, [brokerNames, dataBeforeBrokerFilter]);

  // Sort brokers by data volume (most records first)
  const sortedBrokers = useMemo(() => {
    const countMap = new Map<string, number>();
    dataBeforeBrokerFilter.forEach((r) => {
      const brokerName = getValidBrokerName(r);
      if (brokerName) {
        countMap.set(brokerName, (countMap.get(brokerName) || 0) + 1);
      }
    });
    return [...countMap.keys()].sort((a, b) => {
      const countDiff = (countMap.get(b) || 0) - (countMap.get(a) || 0);
      return countDiff || a.localeCompare(b, "zh-Hans-CN");
    });
  }, [dataBeforeBrokerFilter]);

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

  const hasFilters = Boolean(
    search ||
    brokerNames.length > 0 ||
    primaryDomain ||
    announcementStage ||
    procurementMethod ||
    timeRange !== "90d" ||
    !finTechOnly
  );

  const openFeedback = useCallback((category?: FeedbackCategory, brokerName = "") => {
    setFeedbackCategory(category);
    setFeedbackBrokerName(brokerName);
    setFeedbackOpen(true);
  }, []);

  // Show login page if not logged in
  if (!isLoggedIn) {
    return <LoginPageWithApply />;
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
    <div className="min-h-screen min-w-0 max-w-full overflow-x-hidden bg-[#F4F7FB]">
      {/* ─── Top Navigation ─── */}
            <DashboardHeader
        username={username}
              totalBrokers={dataOverview?.tender_projects.broker_count ?? dashboardStatistics.brokerCount}
        baseline={baseline}
        filteredData={filteredData}
        isAdmin={isAdmin}
        showDashboard={showDashboard}
        activeModule={activeModule}
        onShowModal={() => setShowModal(true)}
        onExport={() => exportCsv(filteredData)}
        onOpenFeedback={() => openFeedback()}
        onShowDashboard={setShowDashboard}
        onLogout={logout}
      />

      {/* ─── Main Content ─── */}
      <main className="mx-auto max-w-[1600px] min-w-0 px-3 py-4 space-y-4 sm:px-8 sm:py-5">
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
          allBrokerOptions={allBrokerOptions}
          onMissingBrokerSearch={dataStatus === "ready" && !search.trim() ? (brokerName) => openFeedback("broker_request", brokerName) : undefined}
              methodOptions={methodOptions}
              domainOptions={dataFilters?.procurement.domains}
              stageOptions={dataFilters?.procurement.stages}
          sortedBrokers={sortedBrokers}
          showAllBrokers={showAllBrokers}
          setShowAllBrokers={setShowAllBrokers}
        />

        {/* Tab Bar - Sticky below header */}
        <DashboardTabs
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          filteredCount={filteredData.length}
          headerHeight={headerHeight}
        />

        {/* Tab Content */}
        {activeTab === "ai" ? (
          <AiSummary />
        ) : activeTab === "overview" ? (
          <>
            {/* Metric Cards */}
            <MetricCards data={filteredData} baseline={baseline} statistics={dashboardStatistics} updatedAt={dataUpdatedAt} />

            {/* Executive Summary */}
            <ExecutiveSummary data={filteredData} allData={allData} baseline={baseline} />

            {/* Charts */}
            <div className="grid grid-cols-1 md:grid-cols-6 lg:grid-cols-12 gap-3 sm:gap-4">
              <ProcurementTrendChart data={filteredData} />
              <DomainDistributionChart data={filteredData} />
              <StageDistributionChart data={filteredData} />
            </div>

            {/* Observation Cards */}
            <div className="grid grid-cols-1 md:grid-cols-6 lg:grid-cols-12 gap-3 sm:gap-4">
              <BrokerActivityCard data={filteredData} baseline={baseline} />
              <SupplierObservationCard data={filteredData} />
              <PriceSamplesCard
                data={filteredData}
                onSelectProject={setSelectedProject}
              />
            </div>

            {/* Key Project Radar */}
            <KeyProjectRadar
              data={filteredData}
              baseline={baseline}
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

      <FeedbackDialog
        open={feedbackOpen}
        onOpenChange={setFeedbackOpen}
        initialCategory={feedbackCategory}
        initialBrokerName={feedbackBrokerName}
      />
    </div>
  );
}
