"use client";

import React from "react";
import { MessageSquarePlus, Search, RotateCcw } from "lucide-react";
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
  onOpenFeedback: () => void;
  methodOptions: string[];
  sortedBrokers: string[];
  visibleBrokerCount: number;
  showAllBrokers: boolean;
  setShowAllBrokers: (v: boolean) => void;
  brokerTagsRef: React.RefObject<HTMLDivElement | null>;
}

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
  onOpenFeedback,
  methodOptions,
  sortedBrokers,
  visibleBrokerCount,
  showAllBrokers,
  setShowAllBrokers,
  brokerTagsRef,
}: DashboardFiltersProps) {
  return (
    <div className="bg-white rounded-2xl border border-[#E4EAF2] shadow-[0_1px_3px_rgba(0,0,0,0.02)] p-4 sm:p-5">
      <div className="grid grid-cols-2 items-center gap-2.5 sm:flex sm:flex-wrap sm:gap-4">
        {/* Search */}
        <div className="relative col-span-2 w-full group sm:w-[32%] sm:min-w-[240px]">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#98A2B3] group-focus-within:text-[#2563EB] transition-colors" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索项目、券商、供应商或方式..."
            className="w-full h-[38px] pl-10 pr-11 text-[13px] border border-[#E4EAF2] rounded-lg bg-[#F8FAFC] text-[#172033] placeholder:text-[#98A2B3] focus:outline-none focus:ring-4 focus:ring-[#2563EB]/10 focus:border-[#2563EB] focus:bg-white transition-all"
          />
          <button
            type="button"
            onClick={onOpenFeedback}
            title="提交反馈"
            aria-label="提交反馈"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 flex size-7 items-center justify-center rounded-md text-[#667085] transition-colors hover:bg-blue-50 hover:text-[#2563EB]"
          >
            <MessageSquarePlus className="size-4" />
          </button>
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
          className="w-full sm:w-auto"
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
          className="w-full sm:w-auto"
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
          className="w-full sm:w-auto"
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
          className="w-full sm:w-auto"
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
          className="w-full sm:w-auto"
        />

        {/* FinTech Toggle */}
        <label className="flex min-w-0 items-center gap-2 text-[12px] text-[#475467] hover:text-[#172033] cursor-pointer select-none whitespace-nowrap transition-colors">
          <input
            type="checkbox"
            checked={finTechOnly}
            onChange={(e) => setFinTechOnly(e.target.checked)}
            className="w-4 h-4 rounded border-[#E4EAF2] text-[#2563EB] focus:ring-[#2563EB]/10 transition-colors"
          />
          <span className="font-medium">仅看金融科技</span>
        </label>

        {/* Reset */}
        {hasFilters && (
          <button
            onClick={resetAll}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-[12px] text-[#667085] hover:text-red-600 hover:bg-red-50 rounded-lg active:scale-[0.97] transition-all"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>重置</span>
          </button>
        )}
      </div>

      {/* All Broker Tags - max 2 rows */}
      {sortedBrokers.length > 0 && (
        <div className="mt-4 flex flex-col gap-2 border-t border-[#F0F2F5] pt-4 sm:flex-row sm:items-start sm:gap-3">
          <span className="text-[12px] font-semibold text-[#475467] shrink-0 mt-1">券商标签</span>
          {brokerNames.length > 0 && (
            <button
              onClick={() => setBrokerNames([])}
              className="px-2 py-0.5 text-[11px] font-semibold text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100 rounded transition-colors mt-0.5"
            >
              清除已选
            </button>
          )}
          <div
            ref={brokerTagsRef}
            className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-hidden sm:pb-0"
            style={{ maxHeight: showAllBrokers ? "none" : "76px" }}
          >
            {sortedBrokers.slice(0, visibleBrokerCount).map((broker) => {
              const isSelected = brokerNames.includes(broker);
              return (
                <button
                  key={broker}
                  onClick={() => toggleBrokerName(broker)}
                  className={`
                    px-2.5 py-1 text-[12px] font-medium rounded-lg transition-all duration-150 whitespace-nowrap border
                    ${isSelected
                      ? "bg-blue-600 border-blue-600 text-white shadow-sm"
                      : "bg-[#F8FAFC] border-[#E4EAF2] text-[#475467] hover:border-blue-500/30 hover:bg-blue-50/20 hover:text-[#172033]"
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
                className="px-2.5 py-1 text-[12px] font-semibold rounded-lg bg-[#EBF0F7] text-blue-600 hover:bg-blue-100/50 hover:text-blue-700 transition-colors whitespace-nowrap"
              >
                +{sortedBrokers.length - visibleBrokerCount} 更多
              </button>
            )}
            {showAllBrokers && visibleBrokerCount >= sortedBrokers.length && (
              <button
                onClick={() => setShowAllBrokers(false)}
                className="px-2.5 py-1 text-[12px] font-semibold rounded-lg bg-[#EBF0F7] text-[#667085] hover:bg-gray-200 transition-colors whitespace-nowrap"
              >
                收起
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
