"use client";

import { useState, useMemo } from "react";
import { ChevronDown } from "lucide-react";
import type { AppReleaseRecord } from "@/lib/app-release-data";
import { UPDATE_TYPE_COLORS, formatReleaseDate } from "@/lib/app-release-data";

interface ReleaseTableProps {
  releases: AppReleaseRecord[];
  onSelect: (record: AppReleaseRecord) => void;
}

export function ReleaseTable({ releases, onSelect }: ReleaseTableProps) {
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: "asc" | "desc" } | null>(null);
  const [displayLimit, setDisplayLimit] = useState(50);

  const handleSort = (key: string) => {
    setSortConfig((prev) => ({
      key,
      direction: prev?.key === key && prev.direction === "desc" ? "asc" : "desc",
    }));
  };

  const sortedReleases = useMemo(() => {
    if (!sortConfig) return releases;
    const { key, direction } = sortConfig;
    return [...releases].sort((a, b) => {
      const aVal = (a as unknown as Record<string, unknown>)[key];
      const bVal = (b as unknown as Record<string, unknown>)[key];

      if (typeof aVal === "string" && typeof bVal === "string") {
        const result = aVal.localeCompare(bVal, "zh-Hans-CN");
        return direction === "asc" ? result : -result;
      }

      if (aVal instanceof Date && bVal instanceof Date) {
        const result = aVal.getTime() - bVal.getTime();
        return direction === "asc" ? result : -result;
      }

      return 0;
    });
  }, [releases, sortConfig]);

  const displayedReleases = sortedReleases.slice(0, displayLimit);

  if (releases.length === 0) {
    return (
      <div className="rounded-xl border border-[#E4E9F0] bg-white p-12 text-center">
        <div className="mx-auto mb-4 size-16 rounded-full bg-slate-50 flex items-center justify-center">
          <svg className="size-8 text-[#98A2B3]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </div>
        <h3 className="text-base font-semibold text-[#172033]">暂无更新明细</h3>
        <p className="mt-1 text-sm text-[#667085]">当前筛选条件下没有数据</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[#E4E9F0] bg-white overflow-hidden">
      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-[#F8FAFC] border-b border-[#E4E9F0]">
            <tr>
              <Th label="更新时间" sortKey="publishDate" currentSort={sortConfig} onSort={handleSort} />
              <Th label="券商" sortKey="brokerName" currentSort={sortConfig} onSort={handleSort} />
              <Th label="App 名称" currentSort={sortConfig} onSort={handleSort} />
              <Th label="版本号" sortKey="appVersion" currentSort={sortConfig} onSort={handleSort} />
              <Th label="更新类型" currentSort={sortConfig} onSort={handleSort} />
              <Th label="更新摘要" currentSort={sortConfig} onSort={handleSort} />
              <Th label="操作" currentSort={sortConfig} onSort={handleSort} />
            </tr>
          </thead>
          <tbody>
            {displayedReleases.map((record, idx) => (
              <ReleaseRow
                key={`${record.contentSha256 || "release"}-${record.brokerCode}-${record.appName}-${idx}`}
                record={record}
                onClick={() => onSelect(record)}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Load More */}
      {sortedReleases.length > displayLimit && (
        <div className="border-t border-[#E4E9F0] p-4 text-center">
          <button
            onClick={() => setDisplayLimit((n) => n + 50)}
            className="text-sm font-medium text-[#2563EB] hover:text-blue-700"
          >
            加载更多（剩余{sortedReleases.length - displayLimit}条）
          </button>
        </div>
      )}
    </div>
  );
}

function Th({
  label,
  sortKey,
  currentSort,
  onSort,
}: {
  label: string;
  sortKey?: string;
  currentSort: { key: string; direction: "asc" | "desc" } | null;
  onSort: (key: string) => void;
}) {
  if (!sortKey) {
    return <th className="px-3 py-2 text-left text-xs font-semibold text-[#667085]">{label}</th>;
  }

  const isActive = currentSort?.key === sortKey;
  const isDesc = currentSort?.direction === "desc";

  return (
    <th className="px-3 py-2 text-left text-xs font-semibold text-[#667085] group cursor-pointer select-none" onClick={() => onSort(sortKey)}>
      <div className="flex items-center gap-1">
        {label}
        <ChevronDown className={`size-3 transition-transform ${isActive && isDesc ? "rotate-180" : ""} text-[#98A2B3] group-hover:text-[#667085]`} />
      </div>
    </th>
  );
}

function ReleaseRow({
  record,
  onClick,
}: {
  record: AppReleaseRecord;
  onClick: () => void;
}) {
  const updateTypeColor = UPDATE_TYPE_COLORS[record.updateType] || "#98A2B3";

  return (
    <tr
      onClick={onClick}
      className="border-b border-[#E4E9F0] hover:bg-blue-50/30 cursor-pointer transition-colors"
    >
      <td className="px-3 py-3 text-xs text-[#667085] whitespace-nowrap">
        {formatReleaseDate(record.publishDate)}
      </td>
      <td className="px-3 py-3 text-xs text-[#172033] font-medium truncate max-w-[120px]">
        {record.brokerName || "未知"}
      </td>
      <td className="px-3 py-3 text-xs text-[#172033] truncate max-w-[140px]">
        {record.appName || "未知"}
      </td>
      <td className="px-3 py-3 text-xs text-[#667085] whitespace-nowrap">
        {record.appVersion || "-"}
      </td>
      <td className="px-3 py-3 text-xs whitespace-nowrap">
        <span
          className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border"
          style={{
            backgroundColor: `${updateTypeColor}15`,
            color: updateTypeColor,
            borderColor: `${updateTypeColor}30`,
          }}
        >
          {record.updateType || "其他"}
        </span>
      </td>
      <td className="px-3 py-3 text-xs text-[#667085] max-w-[200px] truncate">
        {record.updateSummary || "暂无摘要"}
      </td>
      <td className="px-3 py-3 text-xs whitespace-nowrap">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClick();
          }}
          className="inline-flex items-center gap-1 text-[#2563EB] hover:text-blue-700 font-medium"
        >
          查看详情
        </button>
      </td>
    </tr>
  );
}
