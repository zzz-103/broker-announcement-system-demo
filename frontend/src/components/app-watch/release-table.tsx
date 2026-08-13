"use client";

import { useMemo, useState, type KeyboardEvent } from "react";
import { ChevronDown, ExternalLink } from "lucide-react";
import type { AppReleaseRecord } from "@/lib/app-release-data";
import { UPDATE_TYPE_COLORS, formatReleaseDate } from "@/lib/app-release-data";
import { formatCount } from "@/lib/display";

type SortKey = "publishDate" | "brokerName" | "appName" | "appVersion" | "updateType";
type SortConfig = { key: SortKey; direction: "asc" | "desc" } | null;

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "publishDate", label: "更新时间" },
  { key: "brokerName", label: "券商" },
  { key: "appName", label: "App 名称" },
  { key: "appVersion", label: "版本号" },
  { key: "updateType", label: "更新类型" },
];

interface ReleaseTableProps {
  releases: AppReleaseRecord[];
  onSelect: (record: AppReleaseRecord) => void;
}

export function ReleaseTable({ releases, onSelect }: ReleaseTableProps) {
  const [sortConfig, setSortConfig] = useState<SortConfig>(null);
  const [displayLimit, setDisplayLimit] = useState(50);

  const handleSort = (key: SortKey) => {
    setSortConfig((previous) => ({
      key,
      direction: previous?.key === key && previous.direction === "desc" ? "asc" : "desc",
    }));
  };

  const sortedReleases = useMemo(() => {
    if (!sortConfig) return releases;
    const { key, direction } = sortConfig;
    return [...releases].sort((a, b) => {
      const aValue = key === "publishDate"
        ? a.publishDate?.getTime() ?? 0
        : String(a[key] ?? "");
      const bValue = key === "publishDate"
        ? b.publishDate?.getTime() ?? 0
        : String(b[key] ?? "");
      const result = typeof aValue === "number" && typeof bValue === "number"
        ? aValue - bValue
        : String(aValue).localeCompare(String(bValue), "zh-Hans-CN");
      return direction === "asc" ? result : -result;
    });
  }, [releases, sortConfig]);

  const displayedReleases = sortedReleases.slice(0, displayLimit);

  if (releases.length === 0) {
    return (
      <div className="surface-panel p-10 text-center" role="status">
        <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-slate-50">
          <svg className="size-7 text-[#98A2B3]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </div>
        <h3 className="text-sm font-semibold text-[#172033]">暂无更新明细</h3>
        <p className="mt-1 text-xs text-[#667085]">当前筛选条件下没有数据</p>
      </div>
    );
  }

  return (
    <div className="surface-panel overflow-hidden">
      <div className="flex items-center gap-2 border-b border-[#E4EAF2] px-3 py-3 md:hidden">
        <label htmlFor="app-release-mobile-sort" className="shrink-0 text-xs font-semibold text-[#475467]">
          排序
        </label>
        <select
          id="app-release-mobile-sort"
          value={sortConfig?.key ?? ""}
          onChange={(event) => {
            const key = event.target.value as SortKey | "";
            setSortConfig(key ? { key, direction: "desc" } : null);
          }}
          className="min-h-11 min-w-0 flex-1 rounded-md border border-[#E4EAF2] bg-[#F8FAFC] px-3 text-xs font-medium text-[#344054] outline-none focus:border-[#2563EB] focus:bg-white focus:ring-4 focus:ring-[#2563EB]/10"
          aria-label="移动端排序字段"
        >
          <option value="">默认顺序</option>
          {SORT_OPTIONS.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => sortConfig && handleSort(sortConfig.key)}
          disabled={!sortConfig}
          aria-label={sortConfig?.direction === "asc" ? "切换为降序" : "切换为升序"}
          className="inline-flex min-h-11 min-w-[72px] shrink-0 items-center justify-center gap-1 rounded-md border border-[#E4EAF2] bg-white px-2.5 text-xs font-semibold text-[#475467] transition-colors hover:border-blue-200 hover:bg-blue-50 hover:text-[#2563EB] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/25 disabled:cursor-not-allowed disabled:opacity-45"
        >
          <ChevronDown
            className={`size-3.5 transition-transform duration-150 motion-reduce:transition-none ${sortConfig?.direction === "asc" ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
          {sortConfig?.direction === "asc" ? "升序" : "降序"}
        </button>
      </div>

      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[1040px] table-fixed" aria-label="券商 App 更新明细">
          <colgroup>
            <col className="w-[112px]" />
            <col className="w-[132px]" />
            <col className="w-[150px]" />
            <col className="w-[110px]" />
            <col className="w-[120px]" />
            <col className="w-[300px]" />
            <col className="w-[116px]" />
          </colgroup>
          <thead className="border-b border-[#E4EAF2] bg-[#F8FAFC]">
            <tr>
              <Th label="更新时间" sortKey="publishDate" currentSort={sortConfig} onSort={handleSort} />
              <Th label="券商" sortKey="brokerName" currentSort={sortConfig} onSort={handleSort} />
              <Th label="App 名称" sortKey="appName" currentSort={sortConfig} onSort={handleSort} />
              <Th label="版本号" sortKey="appVersion" currentSort={sortConfig} onSort={handleSort} />
              <Th label="更新类型" sortKey="updateType" currentSort={sortConfig} onSort={handleSort} />
              <Th label="更新内容" currentSort={sortConfig} onSort={handleSort} />
              <Th label="操作" currentSort={sortConfig} onSort={handleSort} />
            </tr>
          </thead>
          <tbody>
            {displayedReleases.map((record, index) => (
              <ReleaseRow
                key={`${record.contentSha256 || "release"}-${record.brokerCode}-${record.appName}-${index}`}
                record={record}
                onClick={() => onSelect(record)}
              />
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-3 p-3 md:hidden" aria-label="券商 App 更新卡片列表">
        {displayedReleases.map((record, index) => (
          <ReleaseCard
            key={`${record.contentSha256 || "release"}-${record.brokerCode}-${record.appName}-${index}`}
            record={record}
            onClick={() => onSelect(record)}
          />
        ))}
      </div>

      {sortedReleases.length > displayLimit && (
        <div className="border-t border-[#E4EAF2] p-3 text-center">
          <button
            type="button"
            onClick={() => setDisplayLimit((count) => count + 50)}
            className="text-xs font-semibold text-[#2563EB] hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/25"
          >
            加载更多（剩余 {formatCount(sortedReleases.length - displayLimit)} 条）
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
  sortKey?: SortKey;
  currentSort: SortConfig;
  onSort: (key: SortKey) => void;
}) {
  if (!sortKey) {
    return <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-[#667085]">{label}</th>;
  }

  const isActive = currentSort?.key === sortKey;
  const direction = isActive && currentSort ? currentSort.direction : undefined;
  return (
    <th
      aria-sort={direction === "asc" ? "ascending" : direction === "desc" ? "descending" : "none"}
      className="px-2 py-1.5 text-left text-[11px] font-semibold text-[#667085]"
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        aria-label={`按${label}${direction === "desc" ? "升序" : "降序"}`}
        className="group inline-flex min-h-7 items-center gap-1 rounded px-1 py-1 text-left hover:bg-[#EEF4FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/25"
      >
        {label}
        <ChevronDown className={`size-3 text-[#98A2B3] transition-transform duration-150 motion-reduce:transition-none ${isActive && direction === "asc" ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
    </th>
  );
}

function ReleaseRow({ record, onClick }: { record: AppReleaseRecord; onClick: () => void }) {
  const updateTypeColor = UPDATE_TYPE_COLORS[record.updateType] || "#98A2B3";
  const date = formatReleaseDate(record.publishDate);
  const broker = record.brokerName || "未知";
  const app = record.appName || "未知";
  const version = record.appVersion || "-";
  const summary = record.updateSummary || "暂无内容";

  const handleKeyDown = (event: KeyboardEvent<HTMLTableRowElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onClick();
  };

  return (
    <tr
      tabIndex={0}
      aria-label={`查看 ${broker} ${app} 的更新详情`}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      className="cursor-pointer border-b border-[#E4EAF2] transition-colors hover:bg-blue-50/30 focus-visible:bg-blue-50/40 focus-visible:outline-none"
    >
      <td className="whitespace-nowrap px-3 py-2.5 text-xs text-[#667085]" title={date}>{date}</td>
      <td className="max-w-0 px-3 py-2.5 text-xs font-medium text-[#172033]" title={broker}><span className="block truncate">{broker}</span></td>
      <td className="max-w-0 px-3 py-2.5 text-xs text-[#172033]" title={app}><span className="block truncate">{app}</span></td>
      <td className="whitespace-nowrap px-3 py-2.5 text-xs text-[#667085]" title={version}>{version}</td>
      <td className="px-3 py-2.5 text-xs" title={record.updateType || "其他"}>
        <span className="inline-flex max-w-full items-center rounded border px-2 py-0.5 text-[10px] font-medium" style={{ backgroundColor: `${updateTypeColor}15`, color: updateTypeColor, borderColor: `${updateTypeColor}30` }}>
          <span className="truncate">{record.updateType || "其他"}</span>
        </span>
      </td>
      <td className="max-w-0 px-3 py-2.5 text-xs text-[#667085]" title={summary}><span className="block truncate">{summary}</span></td>
      <td className="whitespace-nowrap px-3 py-2.5 text-xs">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onClick();
          }}
          className="inline-flex items-center gap-1 font-medium text-[#2563EB] hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/25"
        >
          查看详情
          <ExternalLink className="size-3" aria-hidden="true" />
        </button>
      </td>
    </tr>
  );
}

function ReleaseCard({ record, onClick }: { record: AppReleaseRecord; onClick: () => void }) {
  const updateTypeColor = UPDATE_TYPE_COLORS[record.updateType] || "#98A2B3";
  const date = formatReleaseDate(record.publishDate);
  const broker = record.brokerName || "未知券商";
  const app = record.appName || "未知 App";
  const version = record.appVersion || "版本未识别";
  const summary = record.updateSummary || "暂无内容";
  const updateType = record.updateType || "其他";

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`查看 ${broker} ${app} 的更新详情`}
      className="group block min-h-11 w-full rounded-lg border border-[#E4EAF2] bg-white p-4 text-left shadow-sm transition-[border-color,background-color,box-shadow] duration-150 hover:border-blue-200 hover:bg-blue-50/20 hover:shadow-md focus-visible:border-blue-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/25"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] tabular-nums text-[#98A2B3]">{date}</p>
          <h3 className="mt-1 break-words text-sm font-semibold leading-relaxed text-[#172033] group-hover:text-[#2563EB]">
            {broker} · {app}
          </h3>
        </div>
        <span
          className="shrink-0 rounded border px-2 py-0.5 text-[10px] font-semibold"
          style={{ backgroundColor: `${updateTypeColor}15`, color: updateTypeColor, borderColor: `${updateTypeColor}30` }}
        >
          {updateType}
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-xs">
        <dt className="text-[#98A2B3]">版本</dt>
        <dd className="min-w-0 break-words font-medium text-[#475467]">{version}</dd>
        <dt className="text-[#98A2B3]">更新摘要</dt>
        <dd className="min-w-0 break-words text-[#667085]">{summary}</dd>
      </dl>
    </button>
  );
}
