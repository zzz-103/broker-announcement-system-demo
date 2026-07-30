"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, RotateCcw, Search } from "lucide-react";
import { HoverSelect } from "@/components/hover-select";

interface FilterState {
  search: string;
  timeRange: "30d" | "90d" | "year" | "all";
  brokerNames: string[];
  appNames: string[];
  updateTypes: string[];
  featureTags: string[];
}

interface FilterBarProps {
  filters: FilterState;
  setFilters: (filters: FilterState) => void;
  brokerOptions: string[];
  appOptions: string[];
  updateTypeOptions: string[];
  tagOptions: string[];
}

interface FilterOptionGroupProps {
  label: string;
  options: string[];
  selected: string[];
  visibleLimit: number;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onToggle: (option: string) => void;
}

function FilterOptionGroup({
  label,
  options,
  selected,
  visibleLimit,
  expanded,
  onExpandedChange,
  onToggle,
}: FilterOptionGroupProps) {
  const visibleOptions = useMemo(() => {
    if (expanded || options.length <= visibleLimit) return options;
    const selectedSet = new Set(selected);
    return [
      ...options.filter((option) => selectedSet.has(option)),
      ...options.filter((option) => !selectedSet.has(option)),
    ].slice(0, visibleLimit);
  }, [expanded, options, selected, visibleLimit]);
  const hiddenCount = Math.max(0, options.length - visibleOptions.length);

  if (options.length === 0) return null;

  return (
    <div className="grid min-w-0 gap-2 sm:grid-cols-[64px_minmax(0,1fr)] sm:items-start">
      <span className="pt-1.5 text-[12px] font-semibold text-[#475467]">{label}</span>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        {visibleOptions.map((option) => {
          const isSelected = selected.includes(option);
          return (
            <button
              key={option}
              type="button"
              aria-pressed={isSelected}
              onClick={() => onToggle(option)}
              className={`whitespace-nowrap rounded-lg border px-2.5 py-1 text-[12px] font-medium transition-[border-color,background-color,color,box-shadow,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/25 active:scale-[0.97] ${
                isSelected
                  ? "border-blue-600 bg-blue-600 text-white shadow-sm"
                  : "border-[#E4EAF2] bg-[#F8FAFC] text-[#475467] hover:border-blue-300 hover:bg-blue-50/50 hover:text-[#1D4ED8] hover:shadow-[0_2px_7px_rgba(37,99,235,0.10)]"
              }`}
            >
              {option}
            </button>
          );
        })}
        {hiddenCount > 0 && (
          <button
            type="button"
            aria-expanded={false}
            onClick={() => onExpandedChange(true)}
            className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg bg-[#EBF0F7] px-2.5 py-1 text-[12px] font-semibold text-[#2563EB] transition-colors hover:bg-blue-100 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/25"
          >
            +{hiddenCount} 更多
            <ChevronDown className="size-3" />
          </button>
        )}
        {expanded && options.length > visibleLimit && (
          <button
            type="button"
            aria-expanded={true}
            onClick={() => onExpandedChange(false)}
            className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg bg-[#EBF0F7] px-2.5 py-1 text-[12px] font-semibold text-[#667085] transition-colors hover:bg-slate-200 hover:text-[#344054] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/25"
          >
            收起
            <ChevronUp className="size-3" />
          </button>
        )}
      </div>
    </div>
  );
}

export function FilterBar({
  filters,
  setFilters,
  brokerOptions,
  appOptions,
  updateTypeOptions,
  tagOptions,
}: FilterBarProps) {
  const [expandedGroups, setExpandedGroups] = useState({
    brokers: false,
    apps: false,
    updateTypes: false,
    tags: false,
  });

  const toggleValue = (
    key: "brokerNames" | "appNames" | "updateTypes" | "featureTags",
    value: string
  ) => {
    const current = filters[key];
    const next = current.includes(value)
      ? current.filter((item) => item !== value)
      : [...current, value];
    setFilters({ ...filters, [key]: next });
  };

  const hasFilters = Boolean(
    filters.search ||
      filters.brokerNames.length ||
      filters.appNames.length ||
      filters.updateTypes.length ||
      filters.featureTags.length ||
      filters.timeRange !== "90d"
  );

  const resetFilters = () => {
    setFilters({
      search: "",
      timeRange: "90d",
      brokerNames: [],
      appNames: [],
      updateTypes: [],
      featureTags: [],
    });
    setExpandedGroups({
      brokers: false,
      apps: false,
      updateTypes: false,
      tags: false,
    });
  };

  return (
    <div className="space-y-4 rounded-2xl border border-[#E4EAF2] bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.02)] sm:p-5">
      <div className="relative group">
        <Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[#98A2B3] transition-colors group-focus-within:text-[#2563EB]" />
        <input
          type="text"
          value={filters.search}
          onChange={(event) => setFilters({ ...filters, search: event.target.value })}
          placeholder="搜索券商、App、版本或更新内容"
          className="h-[38px] w-full rounded-lg border border-[#E4EAF2] bg-[#F8FAFC] py-2 pr-3 pl-10 text-[13px] text-[#172033] outline-none transition-all placeholder:text-[#98A2B3] focus:border-[#2563EB] focus:bg-white focus:ring-4 focus:ring-[#2563EB]/10"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2.5 border-t border-[#F0F2F5] pt-4">
        <span className="text-[12px] font-semibold text-[#475467]">时间范围</span>
        <HoverSelect
          value={filters.timeRange}
          onChange={(value) =>
            setFilters({ ...filters, timeRange: value as FilterState["timeRange"] })
          }
          options={[
            { value: "30d", label: "近30日" },
            { value: "90d", label: "近90日" },
            { value: "year", label: "本年度" },
            { value: "all", label: "全部时间" },
          ]}
          placeholder="时间范围"
          className="w-[120px]"
        />
        {hasFilters && (
          <button
            type="button"
            onClick={resetFilters}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12px] text-[#667085] transition-all hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/20 active:scale-[0.97]"
          >
            <RotateCcw className="size-3.5" />
            重置
          </button>
        )}
      </div>

      <div className="grid gap-x-8 gap-y-3 border-t border-[#F0F2F5] pt-4 xl:grid-cols-2">
        <FilterOptionGroup
          label="券商"
          options={brokerOptions}
          selected={filters.brokerNames}
          visibleLimit={6}
          expanded={expandedGroups.brokers}
          onExpandedChange={(brokers) => setExpandedGroups((state) => ({ ...state, brokers }))}
          onToggle={(broker) => toggleValue("brokerNames", broker)}
        />
        <FilterOptionGroup
          label="App"
          options={appOptions}
          selected={filters.appNames}
          visibleLimit={5}
          expanded={expandedGroups.apps}
          onExpandedChange={(apps) => setExpandedGroups((state) => ({ ...state, apps }))}
          onToggle={(app) => toggleValue("appNames", app)}
        />
        <FilterOptionGroup
          label="更新类型"
          options={updateTypeOptions}
          selected={filters.updateTypes}
          visibleLimit={6}
          expanded={expandedGroups.updateTypes}
          onExpandedChange={(updateTypes) =>
            setExpandedGroups((state) => ({ ...state, updateTypes }))
          }
          onToggle={(updateType) => toggleValue("updateTypes", updateType)}
        />
        <FilterOptionGroup
          label="功能标签"
          options={tagOptions}
          selected={filters.featureTags}
          visibleLimit={8}
          expanded={expandedGroups.tags}
          onExpandedChange={(tags) => setExpandedGroups((state) => ({ ...state, tags }))}
          onToggle={(tag) => toggleValue("featureTags", tag)}
        />
      </div>
    </div>
  );
}
