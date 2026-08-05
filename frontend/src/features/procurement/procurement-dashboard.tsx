"use client";

import { useCallback, useDeferredValue, useEffect, useState, useMemo } from "react";
import dynamic from "next/dynamic";
import { HelpCircle, MessageSquarePlus, RefreshCw } from "lucide-react";
import {
  DataNotGeneratedError,
  loadAndProcessData,
  getDataBaseline,
  getDashboardStatistics,
  getValidBrokerName,
  recordMatchesSearch,
  formatDate,
  exportCsv,
  type ProcessedRecord,
} from "@/lib/announcement-data";
import { useFilterStore } from "@/store/filter-store";
import { useAuthStore } from "@/store/auth-store";
import { BackendApiError, recordDashboardView } from "@/lib/api/backend-client";
import { getAuditContext } from "@/lib/audit-context";
import { DashboardHeader } from "@/components/dashboard-header";
import { DashboardFilters } from "@/components/dashboard-filters";
import { ProcurementTabs } from "@/components/procurement/procurement-tabs";
import { LoginPageWithApply } from "@/components/login-page-with-apply";
import { MetricCards } from "@/components/metric-cards";
import { ExecutiveSummary } from "@/components/executive-summary";
import { FeedbackDialog } from "@/components/feedback-dialog";
import type { FeedbackCategory } from "@/lib/api/backend-client";
import type { DashboardFilters as DashboardFiltersData } from "@dashboard-data/contracts";

// Dynamic imports for heavy components (code splitting)
const AdminDashboard = dynamic(
  () => import("@/features/admin/admin-dashboard").then((m) => m.AdminDashboard),
  { ssr: false }
);
const AiSummary = dynamic(
  () => import("@/components/ai-summary").then((m) => m.AiSummary),
  { ssr: false, loading: () => <div className="surface-panel h-48 motion-reduce:animate-none" /> }
);
const ProcurementTrendChart = dynamic(
  () => import("@/components/charts").then((m) => m.ProcurementTrendChart),
  { ssr: false, loading: () => <div className="surface-panel h-64 motion-reduce:animate-none" /> }
);
const DomainDistributionChart = dynamic(
  () => import("@/components/charts").then((m) => m.DomainDistributionChart),
  { ssr: false, loading: () => <div className="surface-panel h-64 motion-reduce:animate-none" /> }
);
const StageDistributionChart = dynamic(
  () => import("@/components/charts").then((m) => m.StageDistributionChart),
  { ssr: false, loading: () => <div className="surface-panel h-64 motion-reduce:animate-none" /> }
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
  const [dataFilters, setDataFilters] = useState<DashboardFiltersData | null>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackCategory, setFeedbackCategory] = useState<FeedbackCategory | undefined>();
  const [feedbackBrokerName, setFeedbackBrokerName] = useState("");
  const [landingResolved, setLandingResolved] = useState(false);

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
    setShowDashboard(false);
    setLandingResolved(true);
  }, [isLoggedIn]);

  useEffect(() => {
    if (!isLoggedIn || !token || showDashboard || !landingResolved) return;
    void recordDashboardView(token, getAuditContext()).catch((error: unknown) => {
      if (error instanceof BackendApiError && error.status === 401) {
        clearAuth("登录已失效，请重新登录");
      }
    });
  }, [clearAuth, isLoggedIn, landingResolved, showDashboard, token]);

  // Broker tags: show a compact subset until explicitly expanded.
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
      .then(({ records, updatedAt, filters }) => {
        setAllData(records);
        setDataUpdatedAt(updatedAt);
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
          setDataFilters(null);
          setDataStatus("empty");
          setDataMessage(err.message);
        } else {
          setAllData([]);
          setDataUpdatedAt(null);
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
        isAdmin={isAdmin}
        activeModule="procurement"
        statusText={
          dataStatus === "ready"
            ? formatDate(baseline)
            : dataStatus === "loading"
              ? "加载中"
              : dataStatus === "empty"
                ? "待生成"
                : "不可用"
        }
        statusTone={dataStatus === "ready" ? "ready" : dataStatus === "loading" ? "loading" : dataStatus === "empty" ? "stale" : "unavailable"}
        statusDescription={dataUpdatedAt ? `标准化数据更新时间：${dataUpdatedAt}` : dataMessage || undefined}
        exportOptions={[
          {
            id: "filtered-csv",
            label: "当前筛选 · CSV",
            description: `${filteredData.length} 条记录`,
            disabled: filteredData.length === 0,
            onSelect: () => exportCsv(filteredData),
          },
          {
            id: "all-csv",
            label: "全部数据 · CSV",
            description: `${allData.length} 条记录`,
            disabled: allData.length === 0,
            onSelect: () => exportCsv(allData),
          },
        ]}
        onOpenAdmin={() => setShowDashboard(true)}
        onLogout={logout}
      />

      {/* ─── Main Content ─── */}
      <main className="mx-auto max-w-[1600px] min-w-0 px-3 py-4 space-y-4 sm:px-8 sm:py-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-[#172033] sm:text-2xl">招采情报</h2>
            <p className="mt-1 text-xs text-[#667085]">跟踪公开招采动态，辅助项目研判与业务跟进。</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={refreshData}
              disabled={isLoading}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[#D0D5DD] bg-white px-3 text-xs font-semibold text-[#475467] transition-colors hover:bg-[#F8FAFD] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw className={`size-3.5 ${isLoading ? "animate-spin" : ""}`} />
              刷新数据
            </button>
            <button
              type="button"
              onClick={() => setShowModal(true)}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[#D0D5DD] bg-white px-3 text-xs font-semibold text-[#475467] transition-colors hover:bg-[#F8FAFD]"
            >
              <HelpCircle className="size-3.5" />
              数据口径
            </button>
            <button
              type="button"
              onClick={() => openFeedback()}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[#C8D7F0] bg-[#F8FAFD] px-3 text-xs font-semibold text-[#315EA8] transition-colors hover:bg-[#EEF4FF]"
              title="补充券商、反馈数据问题或提出产品建议"
            >
              <MessageSquarePlus className="size-3.5" />
              提交反馈
            </button>
          </div>
        </div>
        {(isLoading || dataStatus === "empty" || dataStatus === "error") && (
          <div
            className={`rounded-lg border px-4 py-3 text-[13px] ${
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
        <ProcurementTabs
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          filteredCount={filteredData.length}
          headerHeight={68}
        />

        {/* Tab Content */}
        {activeTab === "ai" ? (
          <div id="procurement-panel-ai" role="tabpanel" aria-labelledby="procurement-tab-ai"><AiSummary /></div>
        ) : activeTab === "overview" ? (
          <div id="procurement-panel-overview" role="tabpanel" aria-labelledby="procurement-tab-overview" className="space-y-4">
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
          </div>
        ) : (
          /* Project Table Tab */
          <div id="procurement-panel-table" role="tabpanel" aria-labelledby="procurement-tab-table"><ProjectTable data={filteredData} onSelectProject={setSelectedProject} /></div>
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
