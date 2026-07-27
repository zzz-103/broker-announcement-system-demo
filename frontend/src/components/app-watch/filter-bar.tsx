"use client";

import { Search } from "lucide-react";

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

export function FilterBar({
  filters,
  setFilters,
  brokerOptions,
  appOptions,
  updateTypeOptions,
  tagOptions,
}: FilterBarProps) {
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFilters({ ...filters, search: e.target.value });
  };

  const toggleBroker = (broker: string) => {
    const next = filters.brokerNames.includes(broker)
      ? filters.brokerNames.filter((b) => b !== broker)
      : [...filters.brokerNames, broker];
    setFilters({ ...filters, brokerNames: next });
  };

  const toggleApp = (app: string) => {
    const next = filters.appNames.includes(app)
      ? filters.appNames.filter((a) => a !== app)
      : [...filters.appNames, app];
    setFilters({ ...filters, appNames: next });
  };

  const resetFilters = () => {
    setFilters({
      search: "",
      timeRange: "90d",
      brokerNames: [],
      appNames: [],
      updateTypes: [],
      featureTags: [],
    });
  };

  return (
    <div className="rounded-xl border border-[#E4E9F0] bg-white p-4 space-y-4">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#98A2B3]" />
        <input
          value={filters.search}
          onChange={handleSearchChange}
          placeholder="搜索券商、App、版本或更新内容"
          className="w-full rounded-lg border border-[#E4EAF2] bg-white py-2 pl-9 pr-3 text-[13px] text-[#172033] outline-none transition-colors focus:border-[#2563EB]"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {/* Time range */}
        <select
          value={filters.timeRange}
          onChange={(e) =>
            setFilters({ ...filters, timeRange: e.target.value as FilterState["timeRange"] })
          }
          className="rounded-lg border border-[#E4EAF2] bg-white px-3 py-2 text-[13px] text-[#172033] outline-none focus:border-[#2563EB]"
        >
          <option value="30d">近 30 日</option>
          <option value="90d">近 90 日</option>
          <option value="year">近一年</option>
          <option value="all">全部</option>
        </select>

        {/* Broker filter */}
        {brokerOptions.length > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-[#667085]">券商:</span>
            <div className="flex flex-wrap gap-1">
              {brokerOptions.slice(0, 5).map((broker) => (
                <button
                  key={broker}
                  onClick={() => toggleBroker(broker)}
                  className={`rounded-full px-2.5 py-1 text-xs font-medium transition-all ${
                    filters.brokerNames.includes(broker)
                      ? "bg-blue-100 text-blue-700 border border-blue-200"
                      : "bg-slate-50 text-[#667085] border border-[#E4E9F0] hover:bg-slate-100"
                  }`}
                >
                  {broker}
                </button>
              ))}
              {brokerOptions.length > 5 && (
                <span className="text-xs text-[#98A2B3]">+{brokerOptions.length - 5}更多</span>
              )}
            </div>
          </div>
        )}

        {/* App filter */}
        {appOptions.length > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-[#667085]">App:</span>
            <div className="flex flex-wrap gap-1">
              {appOptions.slice(0, 3).map((app) => (
                <button
                  key={app}
                  onClick={() => toggleApp(app)}
                  className={`rounded-full px-2.5 py-1 text-xs font-medium transition-all ${
                    filters.appNames.includes(app)
                      ? "bg-blue-100 text-blue-700 border border-blue-200"
                      : "bg-slate-50 text-[#667085] border border-[#E4E9F0] hover:bg-slate-100"
                  }`}
                >
                  {app}
                </button>
              ))}
              {appOptions.length > 3 && (
                <span className="text-xs text-[#98A2B3]">+{appOptions.length - 3}更多</span>
              )}
            </div>
          </div>
        )}

        {/* Reset button */}
        {(filters.search || filters.brokerNames.length > 0 || filters.appNames.length > 0 || filters.timeRange !== "90d") && (
          <button
            onClick={resetFilters}
            className="ml-auto text-xs text-[#2563EB] hover:text-blue-700 underline"
          >
            重置筛选
          </button>
        )}
      </div>
    </div>
  );
}
