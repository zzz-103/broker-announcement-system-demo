"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AiSummary } from "@/components/ai-summary";
import { CozeAdminPanel } from "@/components/coze-admin-panel";
import { CozeFeedbackDialog } from "@/components/coze-feedback-dialog";
import { CozeHeader } from "@/components/coze-header";
import { CozeLoginPanel } from "@/components/coze-login-panel";
import { DataDefinitionModal } from "@/components/data-definition-modal";
import { DashboardFilters } from "@/components/dashboard-filters";
import { DashboardTabs } from "@/components/dashboard-tabs";
import { ExecutiveSummary } from "@/components/executive-summary";
import { MetricCards } from "@/components/metric-cards";
import { ProcurementTrendChart, DomainDistributionChart, StageDistributionChart } from "@/components/charts";
import { BrokerActivityCard, SupplierObservationCard, PriceSamplesCard } from "@/components/observation-cards";
import { KeyProjectRadar } from "@/components/key-project-radar";
import { ProjectDetailDrawer } from "@/components/project-detail-drawer";
import { ProjectTable } from "@/components/project-table";
import { DataNotGeneratedError, getDashboardStatistics, getDataBaseline, getValidBrokerName, loadAndProcessData, type ProcessedRecord } from "@/lib/announcement-data";
import { useAuthStore } from "@/store/auth-store";
import { useFilterStore } from "@/store/filter-store";

export default function Page() {
  const { user, restoreSession } = useAuthStore();
  useEffect(() => restoreSession(), [restoreSession]);
  return user ? <AuthenticatedApp /> : <CozeLoginPanel />;
}

function AuthenticatedApp() {
  const { user, logout } = useAuthStore();
  const [records, setRecords] = useState<ProcessedRecord[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [dataVersion, setDataVersion] = useState("");
  const [dataMessage, setDataMessage] = useState("正在加载看板数据...");
  const [definitionOpen, setDefinitionOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"ai" | "overview" | "table">("overview");
  const [selectedProject, setSelectedProject] = useState<ProcessedRecord | null>(null);
  const brokerTagsRef = useRef<HTMLDivElement>(null);
  const [visibleBrokerCount, setVisibleBrokerCount] = useState(999);
  const [showAllBrokers, setShowAllBrokers] = useState(false);
  const filters = useFilterStore();

  useEffect(() => {
    Promise.all([
      loadAndProcessData(),
      fetch("/data/manifest.json", { cache: "no-store" }).then((response): Promise<{ version?: string }> => response.ok ? response.json() as Promise<{ version?: string }> : Promise.resolve({})),
    ])
      .then(([loaded, manifest]) => {
        setRecords(loaded.records);
        setUpdatedAt(loaded.updatedAt);
        setDataVersion(manifest.version || "未标记");
        setDataMessage(loaded.records.length ? "" : "当前没有可展示数据，请替换 public/data 中的测试文件。");
      })
      .catch((reason: unknown) => setDataMessage(reason instanceof DataNotGeneratedError ? reason.message : "看板数据加载失败"));
  }, []);

  const baseline = useMemo(() => getDataBaseline(records), [records]);
  const statistics = useMemo(() => getDashboardStatistics(records), [records]);
  const methodOptions = useMemo(() => Array.from(new Set(records.map((record) => record.procurement_method).filter(Boolean))).sort(), [records]);
  const baseFiltered = useMemo(() => {
    let result = records;
    if (filters.finTechOnly) result = result.filter((record) => record.isFinTech);
    if (baseline && filters.timeRange !== "all") {
      const days = filters.timeRange === "30d" ? 30 : 90;
      const cutoff = filters.timeRange === "year" ? new Date(baseline.getFullYear(), 0, 1) : new Date(baseline.getTime() - days * 86400000);
      result = result.filter((record) => record.validPublishDate && record.validPublishDate >= cutoff);
    }
    const query = filters.search.trim().toLowerCase();
    if (query) result = result.filter((record) => record.searchText.includes(query));
    if (filters.primaryDomain) result = result.filter((record) => record.primaryDomain === filters.primaryDomain);
    if (filters.announcementStage) result = result.filter((record) => record.announcement_stage === filters.announcementStage);
    if (filters.procurementMethod) result = result.filter((record) => record.procurement_method === filters.procurementMethod);
    if (filters.detailFilter?.hasPrice === "true") result = result.filter((record) => record.display_amount_yuan !== null);
    return result;
  }, [baseline, filters.announcementStage, filters.detailFilter, filters.finTechOnly, filters.primaryDomain, filters.procurementMethod, filters.search, filters.timeRange, records]);
  const brokerOptions = useMemo(() => Array.from(new Set(baseFiltered.map(getValidBrokerName).filter((name): name is string => Boolean(name)))).sort(), [baseFiltered]);
  const allBrokerOptions = useMemo(() => statistics.brokerNames.slice().sort(), [statistics.brokerNames]);
  const filteredData = useMemo(() => filters.brokerNames.length ? baseFiltered.filter((record) => { const name = getValidBrokerName(record); return name ? filters.brokerNames.includes(name) : false; }) : baseFiltered, [baseFiltered, filters.brokerNames]);
  const sortedBrokers = useMemo(() => statistics.brokerNames.slice().sort((a, b) => a.localeCompare(b, "zh-Hans-CN")), [statistics.brokerNames]);
  const hasFilters = Boolean(filters.search || filters.brokerNames.length || filters.primaryDomain || filters.announcementStage || filters.procurementMethod || filters.timeRange !== "90d" || !filters.finTechOnly || filters.detailFilter);

  useEffect(() => {
    if (!brokerTagsRef.current) return;
    const update = () => setVisibleBrokerCount(showAllBrokers ? sortedBrokers.length : Math.max(1, Math.floor((brokerTagsRef.current?.offsetWidth || 600) / 120)) * 2);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(brokerTagsRef.current);
    return () => observer.disconnect();
  }, [showAllBrokers, sortedBrokers.length]);

  if (!user) return <CozeLoginPanel />;
  if (adminOpen && user.isAdmin) return <CozeAdminPanel currentUserId={user.id} onBack={() => setAdminOpen(false)} />;

  return <div className="min-h-screen min-w-0 overflow-x-hidden bg-[#F4F7FB]">
    <CozeHeader user={user} baseline={baseline} brokerCount={statistics.brokerCount} data={filteredData} onDefinition={() => setDefinitionOpen(true)} onFeedback={() => setFeedbackOpen(true)} onAdmin={() => setAdminOpen(true)} onLogout={logout} />
    <main className="mx-auto max-w-[1600px] space-y-4 px-3 py-4 sm:px-8 sm:py-5">
      {dataMessage && <div className="rounded-lg border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-700">{dataMessage}</div>}
      {dataVersion && <div className="text-right text-[11px] text-[#98A2B3]">数据版本：{dataVersion}{updatedAt ? " · 更新于 " + new Date(updatedAt).toLocaleString("zh-CN") : ""}</div>}
      <DashboardFilters search={filters.search} setSearch={filters.setSearch} timeRange={filters.timeRange} setTimeRange={filters.setTimeRange} brokerNames={filters.brokerNames} setBrokerNames={filters.setBrokerNames} toggleBrokerName={filters.toggleBrokerName} primaryDomain={filters.primaryDomain} setPrimaryDomain={filters.setPrimaryDomain} announcementStage={filters.announcementStage} setAnnouncementStage={filters.setAnnouncementStage} procurementMethod={filters.procurementMethod} setProcurementMethod={filters.setProcurementMethod} finTechOnly={filters.finTechOnly} setFinTechOnly={filters.setFinTechOnly} hasFilters={hasFilters} resetAll={filters.resetAll} brokerOptions={brokerOptions} allBrokerOptions={allBrokerOptions} methodOptions={methodOptions} sortedBrokers={sortedBrokers} visibleBrokerCount={visibleBrokerCount} showAllBrokers={showAllBrokers} setShowAllBrokers={setShowAllBrokers} brokerTagsRef={brokerTagsRef} />
      <DashboardTabs activeTab={activeTab} setActiveTab={setActiveTab} filteredCount={filteredData.length} headerHeight={72} />
      {activeTab === "ai" ? <AiSummary /> : activeTab === "table" ? <ProjectTable data={filteredData} onSelectProject={setSelectedProject} /> : <><MetricCards data={filteredData} baseline={baseline} statistics={statistics} updatedAt={updatedAt} /><ExecutiveSummary data={filteredData} allData={records} baseline={baseline} /><div className="grid grid-cols-1 gap-3 md:grid-cols-6 lg:grid-cols-12 sm:gap-4"><ProcurementTrendChart data={filteredData} /><DomainDistributionChart data={filteredData} /><StageDistributionChart data={filteredData} /></div><div className="grid grid-cols-1 gap-3 md:grid-cols-6 lg:grid-cols-12 sm:gap-4"><BrokerActivityCard data={filteredData} baseline={baseline} /><SupplierObservationCard data={filteredData} /><PriceSamplesCard data={filteredData} /></div><KeyProjectRadar data={filteredData} baseline={baseline} onSelectProject={setSelectedProject} /></>}
    </main>
    <ProjectDetailDrawer record={selectedProject} onClose={() => setSelectedProject(null)} />
    <DataDefinitionModal open={definitionOpen} onClose={() => setDefinitionOpen(false)} />
    <CozeFeedbackDialog user={user} open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
  </div>;
}
