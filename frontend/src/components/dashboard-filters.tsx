"use client";

import { ChevronDown, RotateCcw, Search, SlidersHorizontal, X } from "lucide-react";
import { useState } from "react";
import { HoverSelect } from "./hover-select";
import { MultiHoverSelect } from "./multi-hover-select";
import type { TimeRange } from "@/store/filter-store";

interface DashboardFiltersProps {
  search: string;
  setSearch: (v: string) => void;
  timeRange: TimeRange;
  setTimeRange: (v: TimeRange) => void;
  brokerNames: string[];
  setBrokerNames: (v: string[]) => void;
  toggleBrokerName: (v: string) => void;
  primaryDomain: string;
  setPrimaryDomain: (v: string) => void;
  announcementStage: string;
  setAnnouncementStage: (v: string) => void;
  procurementMethod: string;
  setProcurementMethod: (v: string) => void;
  finTechOnly: boolean;
  setFinTechOnly: (v: boolean) => void;
  hasFilters: boolean;
  resetAll: () => void;
  brokerOptions: string[];
  allBrokerOptions: string[];
  onMissingBrokerSearch?: (name: string) => void;
  methodOptions: string[];
  sortedBrokers: string[];
  showAllBrokers: boolean;
  setShowAllBrokers: (v: boolean) => void;
  domainOptions?: string[];
  stageOptions?: string[];
}

const DEFAULT_VISIBLE_BROKER_COUNT = 12;

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

export function DashboardFilters({
  search,
  setSearch,
  timeRange,
  setTimeRange,
  brokerNames,
  setBrokerNames,
  toggleBrokerName,
  primaryDomain,
  setPrimaryDomain,
  announcementStage,
  setAnnouncementStage,
  procurementMethod,
  setProcurementMethod,
  finTechOnly,
  setFinTechOnly,
  hasFilters,
  resetAll,
  brokerOptions,
  allBrokerOptions,
  onMissingBrokerSearch,
  methodOptions,
  sortedBrokers,
  showAllBrokers,
  setShowAllBrokers,
  domainOptions,
  stageOptions,
}: DashboardFiltersProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const visibleBrokerCount = showAllBrokers
    ? sortedBrokers.length
    : Math.min(DEFAULT_VISIBLE_BROKER_COUNT, sortedBrokers.length);
  const advancedFilterCount = [
    announcementStage,
    procurementMethod,
    !finTechOnly ? "非金融科技" : "",
  ].filter(Boolean).length;
  const activeFilterCount = [
    search.trim(),
    timeRange !== "90d" ? timeRange : "",
    brokerNames.length ? "券商" : "",
    primaryDomain,
    announcementStage,
    procurementMethod,
    !finTechOnly ? "非金融科技" : "",
  ].filter(Boolean).length;

  const clearBroker = (broker: string) => {
    setBrokerNames(brokerNames.filter((name) => name !== broker));
  };

  const activeSummary = (
    <div className="flex flex-wrap items-center gap-1.5 border-t border-[#EEF2F6] pt-2.5 text-[11px] text-[#667085]">
      <span className="mr-1 font-semibold text-[#475467]">当前筛选</span>
      {search.trim() && (
        <button
          type="button"
          onClick={() => setSearch("")}
          className="inline-flex max-w-[220px] items-center gap-1 rounded-md bg-[#F2F6FC] px-2 py-1 text-[#315EA8] hover:bg-[#E7EFFB]"
          title="清除搜索词"
        >
          <span className="truncate">搜索：{search.trim()}</span>
          <X className="size-3 shrink-0" />
        </button>
      )}
      {timeRange !== "90d" && (
        <button type="button" onClick={() => setTimeRange("90d")} className="inline-flex items-center gap-1 rounded-md bg-[#F2F6FC] px-2 py-1 text-[#315EA8]">
          时间：{timeRange === "30d" ? "近30日" : timeRange === "year" ? "本年度" : "全部时间"}<X className="size-3" />
        </button>
      )}
      {primaryDomain && (
        <button type="button" onClick={() => setPrimaryDomain("")} className="inline-flex max-w-[190px] items-center gap-1 rounded-md bg-[#F2F6FC] px-2 py-1 text-[#315EA8]">
          <span className="truncate">方向：{primaryDomain}</span><X className="size-3 shrink-0" />
        </button>
      )}
      {announcementStage && (
        <button type="button" onClick={() => setAnnouncementStage("")} className="inline-flex items-center gap-1 rounded-md bg-[#F2F6FC] px-2 py-1 text-[#315EA8]">
          阶段：{announcementStage}<X className="size-3" />
        </button>
      )}
      {procurementMethod && (
        <button type="button" onClick={() => setProcurementMethod("")} className="inline-flex max-w-[180px] items-center gap-1 rounded-md bg-[#F2F6FC] px-2 py-1 text-[#315EA8]">
          <span className="truncate">方式：{procurementMethod}</span><X className="size-3 shrink-0" />
        </button>
      )}
      {brokerNames.length > 0 && (
        <button type="button" onClick={() => setBrokerNames([])} className="inline-flex items-center gap-1 rounded-md bg-[#F2F6FC] px-2 py-1 text-[#315EA8]">
          券商：{brokerNames.length} 家<X className="size-3" />
        </button>
      )}
      {!finTechOnly && (
        <button type="button" onClick={() => setFinTechOnly(true)} className="inline-flex items-center gap-1 rounded-md bg-[#F2F6FC] px-2 py-1 text-[#315EA8]">
          全部项目<X className="size-3" />
        </button>
      )}
      <button
        type="button"
        onClick={resetAll}
        className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 font-semibold text-[#667085] hover:bg-rose-50 hover:text-rose-600"
      >
        <RotateCcw className="size-3" />清除全部
      </button>
    </div>
  );

  return (
    <div className="rounded-xl border border-[#E4EAF2] bg-white p-3.5 shadow-[0_1px_2px_rgba(16,40,71,0.03)] sm:p-4">
      <div className="grid grid-cols-2 items-center gap-2 sm:flex sm:flex-wrap sm:gap-2.5">
        {/* Search */}
        <div className="group relative col-span-2 w-full sm:w-[31%] sm:min-w-[240px] sm:flex-1 lg:max-w-[420px]">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#98A2B3] group-focus-within:text-[#2563EB] transition-colors" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索项目、券商、供应商或方式..."
            aria-label="搜索项目、券商、供应商或采购方式"
            className="h-9 w-full rounded-md border border-[#E4EAF2] bg-[#F8FAFC] pl-10 pr-3 text-[13px] text-[#172033] placeholder:text-[#98A2B3] transition-colors focus:border-[#2563EB] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#2563EB]/15"
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
          className="w-full sm:w-[104px]"
        />

        {/* Broker - Multi Select */}
        <MultiHoverSelect
          values={brokerNames}
          onChange={setBrokerNames}
          onToggle={toggleBrokerName}
          options={brokerOptions.map((b) => ({ value: b, label: b }))}
          knownOptions={allBrokerOptions.map((b) => ({ value: b, label: b }))}
          placeholder="全部券商"
          maxHeight={240}
          searchable
          searchPlaceholder="搜索券商名称"
          onMissingSearch={onMissingBrokerSearch}
          className="w-full sm:w-[120px]"
        />

        {/* Domain */}
        <HoverSelect
          value={primaryDomain}
          onChange={setPrimaryDomain}
          options={[
            { value: "", label: "全部方向" },
            ...(domainOptions?.length ? domainOptions : DOMAIN_OPTIONS).map((d) => ({ value: d, label: d })),
          ]}
          placeholder="全部方向"
          maxHeight={280}
          className="w-full sm:w-auto"
        />

        <button
          type="button"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((open) => !open)}
          className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-md border px-3 text-[12px] font-semibold transition-colors ${moreOpen || advancedFilterCount > 0 ? "border-[#B9D0F5] bg-[#F2F6FC] text-[#315EA8]" : "border-[#E4EAF2] bg-[#F8FAFC] text-[#475467] hover:bg-white"}`}
        >
          <SlidersHorizontal className="size-3.5" />
          更多筛选
          {advancedFilterCount > 0 && <span className="rounded-full bg-[#315EA8] px-1.5 py-0.5 text-[10px] text-white">{advancedFilterCount}</span>}
          <ChevronDown className={`size-3.5 transition-transform motion-reduce:transition-none ${moreOpen ? "rotate-180" : ""}`} />
        </button>

        <button
          type="button"
          aria-expanded={showAllBrokers}
          onClick={() => setShowAllBrokers(!showAllBrokers)}
          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-transparent px-2.5 text-[12px] font-semibold text-[#667085] hover:bg-[#F8FAFC] hover:text-[#315EA8]"
        >
          券商列表
          <ChevronDown className={`size-3.5 transition-transform motion-reduce:transition-none ${showAllBrokers ? "rotate-180" : ""}`} />
        </button>
      </div>

      {moreOpen && (
        <div className="mt-3 grid gap-2.5 border-t border-[#EEF2F6] pt-3 sm:grid-cols-3 sm:items-center">
          <HoverSelect
            value={announcementStage}
            onChange={setAnnouncementStage}
            options={[
              { value: "", label: "全部阶段" },
              ...(stageOptions?.length ? stageOptions : ["采购招标", "结果公示", "流标废标", "其他"]).map((stage) => ({ value: stage, label: stage })),
            ]}
            placeholder="全部阶段"
            className="w-full"
          />
          <HoverSelect
            value={procurementMethod}
            onChange={setProcurementMethod}
            options={[
              { value: "", label: "全部方式" },
              ...methodOptions.map((m) => ({ value: m, label: m })),
            ]}
            placeholder="全部方式"
            maxHeight={240}
            className="w-full"
          />
          <label className="flex min-w-0 items-center gap-2 text-[12px] font-medium text-[#475467]">
            <input
              type="checkbox"
              checked={finTechOnly}
              onChange={(e) => setFinTechOnly(e.target.checked)}
              className="size-4 rounded border-[#CBD5E1] text-[#2563EB] focus:ring-[#2563EB]/15"
            />
            仅看金融科技项目
          </label>
        </div>
      )}

      {showAllBrokers && sortedBrokers.length > 0 && (
        <div className="mt-3 flex flex-col gap-2 border-t border-[#EEF2F6] pt-3 sm:flex-row sm:items-start sm:gap-3">
          <span className="mt-1 shrink-0 text-[11px] font-semibold text-[#667085]">券商标签</span>
          <div className="relative min-w-0 flex-1">
            <div className="flex max-h-16 flex-wrap gap-1.5 overflow-y-auto pr-1">
              {sortedBrokers.slice(0, visibleBrokerCount).map((broker) => {
                const isSelected = brokerNames.includes(broker);
                return (
                  <button
                    type="button"
                    key={broker}
                    onClick={() => toggleBrokerName(broker)}
                    className={`
                      rounded-md border px-2 py-1 text-[11px] font-medium whitespace-nowrap transition-colors
                      ${isSelected
                        ? "border-[#315EA8] bg-[#315EA8] text-white"
                        : "border-[#E4EAF2] bg-[#F8FAFC] text-[#475467] hover:border-[#B9D0F5] hover:bg-[#F2F6FC] hover:text-[#315EA8]"
                      }
                    `}
                  >
                    {broker}
                  </button>
                );
              })}
            </div>
          </div>
          {brokerNames.length > 0 && (
            <button type="button" onClick={() => setBrokerNames([])} className="mt-0.5 shrink-0 text-[11px] font-semibold text-[#667085] hover:text-rose-600">
              清除已选
            </button>
          )}
        </div>
      )}

      {brokerNames.length > 0 && !showAllBrokers && (
        <div className="mt-3 flex min-w-0 items-center gap-2 border-t border-[#EEF2F6] pt-2.5 text-[11px]">
          <span className="shrink-0 font-semibold text-[#667085]">已选券商</span>
          <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
            {brokerNames.slice(0, 4).map((broker) => (
              <button type="button" key={broker} onClick={() => clearBroker(broker)} className="inline-flex max-w-[150px] shrink-0 items-center gap-1 rounded-md bg-[#EEF4FF] px-2 py-1 text-[#315EA8] hover:bg-[#E3EDFF]" title={`移除${broker}`}>
                <span className="truncate">{broker}</span><X className="size-3" />
              </button>
            ))}
            {brokerNames.length > 4 && <span className="shrink-0 text-[#667085]">+{brokerNames.length - 4} 家</span>}
          </div>
          <button type="button" onClick={() => setBrokerNames([])} className="shrink-0 font-semibold text-[#667085] hover:text-rose-600">清除</button>
        </div>
      )}

      {hasFilters && activeFilterCount > 0 && activeSummary}
    </div>
  );
}
