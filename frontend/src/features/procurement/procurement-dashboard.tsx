"use client";

import { useCallback, useDeferredValue, useEffect, useState, useMemo } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { HelpCircle, MessageSquarePlus, RefreshCw } from "lucide-react";
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
import { formatCount, formatDateTime, formatMonthDay } from "@/lib/display";
import { useFilterStore } from "@/store/filter-store";
import { useAuthStore } from "@/store/auth-store";
import { BackendApiError, isAbortError, recordDashboardView } from "@/lib/api/backend-client";
import { getAuditContext } from "@/lib/audit-context";
import { DashboardHeader } from "@/components/dashboard-header";
import { DashboardFilters } from "@/components/dashboard-filters";
import { ProcurementTabs } from "@/components/procurement/procurement-tabs";
import { LoginPageWithApply } from "@/components/login-page-with-apply";
import { SessionLoading } from "@/components/session-loading";
import { MetricCards } from "@/components/metric-cards";
import { ExecutiveSummary } from "@/components/executive-summary";
import { FeedbackDialog } from "@/components/feedback-dialog";
import type { FeedbackCategory } from "@/lib/api/backend-client";
import type { DashboardFilters as DashboardFiltersData } from "@dashboard-data/contracts";

// Dynamic imports for heavy components (code splitting)
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
  const router = useRouter();
  const [allData, setAllData] = useState<ProcessedRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dataStatus, setDataStatus] = useState<"loading" | "empty" | "ready" | "error">("loading");
  const [dataMessage, setDataMessage] = useState<string | null>(null);
  const [selectedProject, setSelectedProject] =
    useState<ProcessedRecord | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [activeTab, setActiveTab] = useState<"ai" | "overview" | "table">("overview");
  const [dataVersion, setDataVersion] = useState(0);
  const [dataUpdatedAt, setDataUpdatedAt] = useState<string | null>(null);
  const [dataFilters, setDataFilters] = useState<DashboardFiltersData | null>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackCategory, setFeedbackCategory] = useState<FeedbackCategory | undefined>();
  const [feedbackBrokerName, setFeedbackBrokerName] = useState("");
  // Auth state
  const { isHydrated, isLoggedIn, isAdmin, username, logout, token, clearAuth } = useAuthStore();
  const restoreSession = useAuthStore((s) => s.restoreSession);

  useEffect(() => {
    restoreSession();
  }, [restoreSession]);

  useEffect(() => {
    if (!isHydrated || !isLoggedIn || !token) return;
    void recordDashboardView(token, getAuditContext()).catch((error: unknown) => {
      if (error instanceof BackendApiError && error.status === 401) {
        clearAuth("登录已失效，请重新登录");
      }
    });
  }, [clearAuth, isHydrated, isLoggedIn, token]);

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
    const controller = new AbortController();
    setIsLoading(true);
    setDataStatus("loading");
    setDataMessage(null);
    loadAndProcessData(token, controller.signal)
      .then(({ records, updatedAt, filters }) => {
        setAllData(records);
        setDataUpdatedAt(updatedAt);
        setDataFilters(filters);
        setDataStatus(records.length === 0 ? "empty" : "ready");
        setDataMessage(
          records.length === 0
            ? "尚未生成看板数据，请先运行公告采集与数据处理。"
            : null
        );
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) return;
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
    return () => controller.abort();
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
    timeRange !== "all" ||
    !finTechOnly
  );

  const openFeedback = useCallback((category?: FeedbackCategory, brokerName = "") => {
    setFeedbackCategory(category);
    setFeedbackBrokerName(brokerName);
    setFeedbackOpen(true);
  }, []);

  if (!isHydrated) {
    return <SessionLoading />;
  }

  // Show login page if not logged in
  if (!isLoggedIn) {
    return <LoginPageWithApply />;
  }

  return (
    <div className="min-h-screen min-w-0 max-w-full overflow-x-clip bg-[#F4F7FB]">
      {/* ─── Top Navigation ─── */}
      <DashboardHeader
        username={username}
        isAdmin={isAdmin}
        activeModule="procurement"
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
        statusDescription={dataUpdatedAt ? `标准化数据更新时间：${formatDateTime(dataUpdatedAt)}` : dataMessage || undefined}
        exportOptions={[
          {
            id: "filtered-csv",
            label: "当前筛选结果",
            description: `${formatCount(filteredData.length)} 条记录`,
            disabled: filteredData.length === 0,
            onSelect: () => exportCsv(filteredData),
          },
          {
            id: "all-csv",
            label: "全部数据",
            description: `${formatCount(allData.length)} 条记录`,
            disabled: allData.length === 0,
            onSelect: () => exportCsv(allData),
          },
        ]}
        onOpenAdmin={() => router.push("/admin")}
        onLogout={logout}
      />

      {/* ─── Main Content ─── */}
      <main className="mx-auto max-w-[1600px] min-w-0 px-3 py-4 space-y-4 sm:px-8 sm:py-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-[#172033] sm:text-2xl">招采情报</h2>
            <p className="mt-1 text-xs text-[#667085]">跟踪公开招采动态，辅助项目研判与业务跟进。</p>
            <div className="mt-2 flex flex-wrap gap-1.5" aria-label="当前统计范围">
              <span className="rounded bg-[#EEF4FF] px-2 py-0.5 text-[10px] font-semibold text-[#315EA8]">
                {timeRange === "30d" ? "最近 30 天" : timeRange === "90d" ? "最近 90 天" : timeRange === "year" ? "本年度" : "全部时间"}
              </span>
              {finTechOnly && <span className="rounded bg-[#EEF4FF] px-2 py-0.5 text-[10px] font-semibold text-[#315EA8]">仅金融科技项目</span>}
              {brokerNames.length > 0 && <span className="rounded bg-[#F2F4F7] px-2 py-0.5 text-[10px] font-semibold text-[#667085]">{brokerNames.length} 家券商</span>}
            </div>
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
            role={dataStatus === "error" ? "alert" : "status"}
            aria-live={dataStatus === "error" ? "assertive" : "polite"}
            className={`rounded-lg border px-4 py-3 text-[13px] ${
              dataStatus === "error"
                ? "border-red-100 bg-red-50 text-red-600"
                : "border-amber-100 bg-amber-50 text-amber-700"
            }`}
          >
            {isLoading
              ? "正在加载看板数据..."
              : dataMessage || "尚未生成看板数据，请先运行公告采集与数据处理。"}
          </div>
        )}

        {/* Global filters do not affect the fixed 30-day AI report. */}
        {activeTab !== "ai" && <DashboardFilters
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
        />}

        {/* Tab Bar - Sticky below header */}
        <ProcurementTabs
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          filteredCount={filteredData.length}
          headerHeight={68}
        />

        {/* Tab Content */}
        {activeTab === "ai" ? (
          <div id="procurement-panel-ai" role="tabpanel" aria-labelledby="procurement-tab-ai" className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-blue-100 bg-blue-50/60 px-3 py-2 text-xs text-blue-800">
              <span className="font-semibold">报告口径</span>
              <span>最近 30 天全量公开招采数据，不受总览筛选条件影响。</span>
            </div>
            <AiSummary />
          </div>
        ) : activeTab === "overview" ? (
          <div id="procurement-panel-overview" role="tabpanel" aria-labelledby="procurement-tab-overview" className="space-y-4">
            {/* Metric Cards */}
            <MetricCards data={filteredData} baseline={baseline} />

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
              <BrokerActivityCard data={filteredData} />
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
