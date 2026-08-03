"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import {
  DataNotGeneratedError,
  exportCsv,
  getDashboardStatistics,
  getDataBaseline,
  getValidBrokerName,
  loadAndProcessData,
  recordMatchesSearch,
  type ProcessedRecord,
} from "@/lib/announcement-data";
import { useFilterStore } from "@/store/filter-store";
import { DashboardHeader } from "@/components/dashboard-header";
import { DashboardFilters } from "@/components/dashboard-filters";
import { DashboardTabs } from "@/components/dashboard-tabs";
import { MetricCards } from "@/components/metric-cards";
import { ExecutiveSummary } from "@/components/executive-summary";
import { DataDefinitionModal } from "@/components/data-definition-modal";
import { StaticDataConsole } from "@/components/static-data-console";
import { invalidateStaticPackageCache } from "@/lib/static-dashboard-data";
import type { ActiveModule } from "@/components/app-watch/module-switcher";
import type { DashboardFilters as DashboardFiltersData, DashboardOverview } from "@dashboard-data/contracts";

const AppUpdatesPage = dynamic(() => import("@/features/app-watch/app-watch-page"), { ssr: false, loading: () => <div className="min-h-screen bg-[#F4F7FB] p-8 text-sm text-[#667085]">正在加载 App 更新看板...</div> });
const AiSummary = dynamic(() => import("@/components/ai-summary").then((module) => module.AiSummary), { ssr: false, loading: () => <div className="h-48 animate-pulse rounded-xl border border-[#E4E9F0] bg-white" /> });
const ProcurementTrendChart = dynamic(() => import("@/components/charts").then((module) => module.ProcurementTrendChart), { ssr: false, loading: () => <div className="h-64 animate-pulse rounded-xl border border-[#E4E9F0] bg-white" /> });
const DomainDistributionChart = dynamic(() => import("@/components/charts").then((module) => module.DomainDistributionChart), { ssr: false, loading: () => <div className="h-64 animate-pulse rounded-xl border border-[#E4E9F0] bg-white" /> });
const StageDistributionChart = dynamic(() => import("@/components/charts").then((module) => module.StageDistributionChart), { ssr: false, loading: () => <div className="h-64 animate-pulse rounded-xl border border-[#E4E9F0] bg-white" /> });
const BrokerActivityCard = dynamic(() => import("@/components/observation-cards").then((module) => module.BrokerActivityCard), { ssr: false });
const SupplierObservationCard = dynamic(() => import("@/components/observation-cards").then((module) => module.SupplierObservationCard), { ssr: false });
const PriceSamplesCard = dynamic(() => import("@/components/observation-cards").then((module) => module.PriceSamplesCard), { ssr: false });
const KeyProjectRadar = dynamic(() => import("@/components/key-project-radar").then((module) => module.KeyProjectRadar), { ssr: false });
const ProjectTable = dynamic(() => import("@/components/project-table").then((module) => module.ProjectTable), { ssr: false });
const ProjectDetailDrawer = dynamic(() => import("@/components/project-detail-drawer").then((module) => module.ProjectDetailDrawer), { ssr: false });

type Panel = "procurement" | "app-watch" | "data";

export default function Dashboard() {
  const [panel, setPanelState] = useState<Panel>("procurement");
  const [allData, setAllData] = useState<ProcessedRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dataStatus, setDataStatus] = useState<"loading" | "empty" | "ready" | "error">("loading");
  const [dataMessage, setDataMessage] = useState<string | null>(null);
  const [dataUpdatedAt, setDataUpdatedAt] = useState<string | null>(null);
  const [dataOverview, setDataOverview] = useState<DashboardOverview | null>(null);
  const [dataFilters, setDataFilters] = useState<DashboardFiltersData | null>(null);
  const [dataVersion, setDataVersion] = useState(0);
  const [selectedProject, setSelectedProject] = useState<ProcessedRecord | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [activeTab, setActiveTab] = useState<"ai" | "overview" | "table">("overview");
  const headerHeight = 72;
  const [showAllBrokers, setShowAllBrokers] = useState(false);

  const setPanel = useCallback((next: Panel) => {
    setPanelState(next);
    if (typeof window !== "undefined") window.location.hash = next;
  }, []);

  useEffect(() => {
    const readHash = () => {
      const value = window.location.hash.slice(1);
      setPanelState(value === "app-watch" || value === "data" ? value : "procurement");
    };
    readHash();
    window.addEventListener("hashchange", readHash);
    return () => window.removeEventListener("hashchange", readHash);
  }, []);

  const {
    search, timeRange, brokerNames, primaryDomain, announcementStage, procurementMethod, finTechOnly, detailFilter,
    setSearch, setTimeRange, setBrokerNames, toggleBrokerName, setPrimaryDomain, setAnnouncementStage, setProcurementMethod, setFinTechOnly, setDetailFilter, resetAll,
  } = useFilterStore();

  const refreshData = useCallback(() => {
    invalidateStaticPackageCache();
    setDataVersion((value) => value + 1);
  }, []);
  useEffect(() => {
    // Keep the large tender dataset out of App Watch and the data console's
    // first paint. It is loaded only when the procurement panel is visible;
    // returning to that panel still picks up an imported or refreshed package.
    if (panel !== "procurement") return;
    let cancelled = false;
    setIsLoading(true); setDataStatus("loading"); setDataMessage(null);
    loadAndProcessData()
      .then(({ records, updatedAt, overview, filters }) => {
        if (cancelled) return;
        setAllData(records); setDataUpdatedAt(updatedAt); setDataOverview(overview); setDataFilters(filters); setDataStatus(records.length ? "ready" : "empty"); setDataMessage(records.length ? null : "当前数据包中没有招采记录。");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setAllData([]); setDataUpdatedAt(null); setDataOverview(null); setDataFilters(null); setDataStatus(error instanceof DataNotGeneratedError ? "empty" : "error"); setDataMessage(error instanceof Error ? error.message : "数据加载失败");
      })
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, [dataVersion, panel]);

  const baseline = useMemo(() => getDataBaseline(allData), [allData]);
  const statistics = useMemo(() => getDashboardStatistics(allData), [allData]);
  const deferredSearch = useDeferredValue(search.trim().toLowerCase());
  const dataBeforeBrokerFilter = useMemo(() => {
    let cutoff: Date | null = null;
    if (baseline && timeRange !== "all") cutoff = timeRange === "30d" ? new Date(baseline.getTime() - 30 * 86400000) : timeRange === "90d" ? new Date(baseline.getTime() - 90 * 86400000) : new Date(baseline.getFullYear(), 0, 1);
    return allData.filter((record) => {
      if (finTechOnly && !record.isFinTech) return false;
      if (cutoff && (!record.validPublishDate || record.validPublishDate < cutoff)) return false;
      if (deferredSearch && !recordMatchesSearch(record, deferredSearch)) return false;
      if (primaryDomain && record.primaryDomain !== primaryDomain) return false;
      if (announcementStage && record.announcement_stage !== announcementStage) return false;
      if (procurementMethod && record.procurement_method !== procurementMethod) return false;
      if (detailFilter?.hasPrice === "true" && record.display_amount_yuan === null) return false;
      return true;
    });
  }, [allData, announcementStage, deferredSearch, detailFilter, finTechOnly, primaryDomain, procurementMethod, timeRange, baseline]);
  const filteredData = useMemo(() => {
    if (!brokerNames.length) return dataBeforeBrokerFilter;
    const selected = new Set(brokerNames);
    return dataBeforeBrokerFilter.filter((record) => { const broker = getValidBrokerName(record); return broker !== null && selected.has(broker); });
  }, [brokerNames, dataBeforeBrokerFilter]);
  const brokerOptions = useMemo(() => [...new Set(dataBeforeBrokerFilter.map(getValidBrokerName).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b, "zh-Hans-CN")), [dataBeforeBrokerFilter]);
  const allBrokerOptions = useMemo(() => dataFilters?.procurement.brokers ?? [...statistics.brokerNames].sort((a, b) => a.localeCompare(b, "zh-Hans-CN")), [dataFilters, statistics.brokerNames]);
  const methodOptions = useMemo(() => dataFilters?.procurement.procurement_methods ?? [...new Set(allData.map((record) => record.procurement_method).filter(Boolean))].sort(), [allData, dataFilters]);
  useEffect(() => {
    if (!brokerNames.length) return;
    const validOptions = new Set(brokerOptions);
    const nextBrokerNames = brokerNames.filter((name) => validOptions.has(name));
    if (nextBrokerNames.length !== brokerNames.length) setBrokerNames(nextBrokerNames);
  }, [brokerNames, brokerOptions, setBrokerNames]);
  const sortedBrokers = useMemo(() => {
    const counts = new Map<string, number>();
    for (const record of dataBeforeBrokerFilter) {
      const broker = getValidBrokerName(record);
      if (broker) counts.set(broker, (counts.get(broker) || 0) + 1);
    }
    return [...counts.keys()].sort((a, b) => (counts.get(b) || 0) - (counts.get(a) || 0) || a.localeCompare(b, "zh-Hans-CN"));
  }, [dataBeforeBrokerFilter]);
  const hasFilters = Boolean(search || brokerNames.length || primaryDomain || announcementStage || procurementMethod || timeRange !== "90d" || !finTechOnly || detailFilter);

  if (panel === "app-watch") return <AppUpdatesPage onBack={() => setPanel("procurement")} />;
  if (panel === "data") return <StaticDataConsole onBack={() => setPanel("procurement")} onDataRefresh={refreshData} />;

  return (
    <div className="min-h-screen min-w-0 max-w-full overflow-x-hidden bg-[#F4F7FB]">
      <DashboardHeader totalBrokers={dataOverview?.tender_projects.broker_count ?? statistics.brokerCount} baseline={baseline} filteredData={filteredData} onShowModal={() => setShowModal(true)} onExport={() => exportCsv(filteredData)} onShowDataConsole={() => setPanel("data")} activeModule="procurement" onModuleChange={(module: ActiveModule) => setPanel(module === "app-watch" ? "app-watch" : "procurement")} />
      <main className="mx-auto max-w-[1600px] min-w-0 space-y-4 px-3 py-4 sm:px-8 sm:py-5">
        {(isLoading || dataStatus === "empty" || dataStatus === "error") && <div className={`rounded-[10px] border px-4 py-3 text-[13px] ${dataStatus === "error" ? "border-red-100 bg-red-50 text-red-600" : "border-amber-100 bg-amber-50 text-amber-700"}`}>{isLoading ? "正在加载标准化看板数据..." : dataMessage || "当前没有可展示数据。"}</div>}
        <DashboardFilters search={search} setSearch={setSearch} timeRange={timeRange} setTimeRange={setTimeRange} brokerNames={brokerNames} setBrokerNames={setBrokerNames} toggleBrokerName={toggleBrokerName} primaryDomain={primaryDomain} setPrimaryDomain={setPrimaryDomain} announcementStage={announcementStage} setAnnouncementStage={setAnnouncementStage} procurementMethod={procurementMethod} setProcurementMethod={setProcurementMethod} finTechOnly={finTechOnly} setFinTechOnly={setFinTechOnly} hasFilters={hasFilters} resetAll={() => { resetAll(); setDetailFilter(null); }} brokerOptions={brokerOptions} allBrokerOptions={allBrokerOptions} methodOptions={methodOptions} sortedBrokers={sortedBrokers} showAllBrokers={showAllBrokers} setShowAllBrokers={setShowAllBrokers} domainOptions={dataFilters?.procurement.domains} stageOptions={dataFilters?.procurement.stages} />
        <DashboardTabs activeTab={activeTab} setActiveTab={setActiveTab} filteredCount={filteredData.length} headerHeight={headerHeight} />
        {activeTab === "ai" ? <AiSummary /> : activeTab === "overview" ? <>
          <MetricCards data={filteredData} baseline={baseline} statistics={statistics} updatedAt={dataUpdatedAt} />
          <ExecutiveSummary data={filteredData} allData={allData} baseline={baseline} />
          <div className="grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-6 lg:grid-cols-12"><ProcurementTrendChart data={filteredData} /><DomainDistributionChart data={filteredData} /><StageDistributionChart data={filteredData} /></div>
          <div className="grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-6 lg:grid-cols-12"><BrokerActivityCard data={filteredData} baseline={baseline} /><SupplierObservationCard data={filteredData} /><PriceSamplesCard data={filteredData} onSelectProject={setSelectedProject} /></div>
          <KeyProjectRadar data={filteredData} baseline={baseline} onSelectProject={setSelectedProject} />
        </> : <ProjectTable data={filteredData} onSelectProject={setSelectedProject} />}
      </main>
      <ProjectDetailDrawer record={selectedProject} onClose={() => setSelectedProject(null)} />
      <DataDefinitionModal open={showModal} onClose={() => setShowModal(false)} />
    </div>
  );
}
