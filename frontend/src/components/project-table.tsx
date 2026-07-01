"use client";

import { useState, useMemo } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getPaginationRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import {
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  ChevronLeft,
  ChevronRight,
  Eye,
} from "lucide-react";
import type { ProcessedRecord } from "@/lib/announcement-data";
import { formatDate, formatAmount } from "@/lib/announcement-data";

interface ProjectTableProps {
  data: ProcessedRecord[];
  onSelectProject: (r: ProcessedRecord) => void;
}

const STAGE_STYLES: Record<string, string> = {
  采购招标: "bg-blue-50 text-blue-700",
  结果公示: "bg-emerald-50 text-emerald-700",
  流标废标: "bg-orange-50 text-orange-700",
};

export function ProjectTable({ data, onSelectProject }: ProjectTableProps) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [pageSize, setPageSize] = useState(20);
  const [sortMode, setSortMode] = useState<"date" | "amount">("date");

  // Apply sort mode
  const sortedData = useMemo(() => {
    if (sortMode === "amount") {
      // 有金额优先：先按是否有金额降序，再按日期降序
      return [...data].sort((a, b) => {
        const aHasAmount = a.winning_amount_yuan !== null ? 1 : 0;
        const bHasAmount = b.winning_amount_yuan !== null ? 1 : 0;
        if (aHasAmount !== bHasAmount) return bHasAmount - aHasAmount;
        // 同组内按日期降序
        const aTime = a.validPublishDate?.getTime() || 0;
        const bTime = b.validPublishDate?.getTime() || 0;
        return bTime - aTime;
      });
    }
    return data;
  }, [data, sortMode]);

  const columns: ColumnDef<ProcessedRecord>[] = useMemo(
    () => [
      {
        accessorKey: "validBrokerName",
        header: "主体",
        size: 100,
        cell: ({ getValue }) => (
          <span className="text-[13px] text-[#172033] font-medium">
            {getValue<string>()}
          </span>
        ),
      },
      {
        accessorKey: "normalizedProjectName",
        header: "项目名称",
        size: 260,
        cell: ({ getValue }) => (
          <span
            className="text-[13px] text-[#172033] line-clamp-2 leading-relaxed"
            title={getValue<string>()}
          >
            {getValue<string>()}
          </span>
        ),
      },
      {
        accessorKey: "primaryDomain",
        header: "金融科技方向",
        size: 130,
        meta: { hideOnMobile: true },
        cell: ({ getValue }) => (
          <span className="text-[12px] text-[#667085]">{getValue<string>()}</span>
        ),
      },
      {
        id: "topicTags",
        header: "主题标签",
        size: 140,
        meta: { hideOnMobile: true },
        accessorFn: (r) => r.topicTags.join(", "),
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1">
            {row.original.topicTags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="text-[10px] px-1.5 py-0.5 rounded bg-[#F0F2F5] text-[#667085]"
              >
                {tag}
              </span>
            ))}
          </div>
        ),
      },
      {
        accessorKey: "announcement_stage",
        header: "公告阶段",
        size: 90,
        cell: ({ getValue }) => {
          const stage = getValue<string>() || "待确认";
          const style = STAGE_STYLES[stage] || "bg-gray-100 text-gray-600";
          return (
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${style}`}
            >
              {stage}
            </span>
          );
        },
      },
      {
        accessorKey: "procurement_method",
        header: "采购方式",
        size: 90,
        meta: { hideOnMobile: true },
        cell: ({ getValue }) => (
          <span className="text-[12px] text-[#667085]">
            {getValue<string>() || "方式未识别"}
          </span>
        ),
      },
      {
        accessorKey: "normalizedSupplier",
        header: "结果披露供应商",
        size: 140,
        cell: ({ getValue }) => {
          const v = getValue<string>();
          return (
            <span className="text-[12px] text-[#667085] truncate block">
              {v || "未披露"}
            </span>
          );
        },
      },
      {
        accessorKey: "winning_amount_yuan",
        header: "公开成交金额",
        size: 120,
        enableSorting: true,
        cell: ({ getValue }) => {
          const v = getValue<number | null>();
          return (
            <span
              className={`text-[13px] font-medium text-right block tabular-nums ${
                v !== null ? "text-[#0F9F8F]" : "text-[#98A2B3]"
              }`}
            >
              {v !== null ? formatAmount(v) : "未披露"}
            </span>
          );
        },
      },
      {
        id: "publish_date",
        header: "公告日期",
        size: 100,
        accessorFn: (r) => r.validPublishDate?.getTime() || 0,
        enableSorting: true,
        cell: ({ row }) => (
          <span className="text-[12px] text-[#98A2B3] tabular-nums">
            {formatDate(row.original.validPublishDate)}
          </span>
        ),
      },
      {
        id: "actions",
        header: "",
        size: 50,
        cell: ({ row }) => (
          <button
            onClick={() => onSelectProject(row.original)}
            className="p-1 rounded hover:bg-gray-100 transition-colors"
          >
            <Eye className="w-3.5 h-3.5 text-[#667085]" />
          </button>
        ),
      },
    ],
    [onSelectProject]
  );

  const table = useReactTable({
    data: sortedData,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize } },
  });

  const pageCount = table.getPageCount();
  const currentPage = table.getState().pagination.pageIndex + 1;

  return (
    <div className="bg-white rounded-[10px] border border-[#E4E9F0] shadow-[0_1px_2px_rgba(0,0,0,0.04)] overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-[#E4E9F0]">
        <h3 className="text-[16px] font-semibold text-[#172033]">
          项目情报明细
        </h3>
        <div className="flex items-center gap-3">
          {/* Sort Mode Selector with Sliding Indicator */}
          <div className="relative inline-flex bg-[#F0F2F5] rounded-lg p-1">
            {/* Sliding Indicator */}
            <div
              className="absolute top-1 bottom-1 rounded-md bg-[#2563EB] shadow-sm transition-all duration-300 ease-[cubic-bezier(0.25,1,0.3,1)]"
              style={{
                left: sortMode === "date" ? "4px" : "50%",
                width: "calc(50% - 4px)",
              }}
            />
            <button
              onClick={() => setSortMode("date")}
              className={`relative z-10 min-w-[72px] px-3 py-1.5 text-[12px] rounded-md text-center whitespace-nowrap transition-colors duration-200 ${
                sortMode === "date"
                  ? "text-white font-semibold"
                  : "text-[#667085] hover:text-[#172033]"
              }`}
            >
              按日期
            </button>
            <button
              onClick={() => setSortMode("amount")}
              className={`relative z-10 min-w-[72px] px-3 py-1.5 text-[12px] rounded-md text-center whitespace-nowrap transition-colors duration-200 ${
                sortMode === "amount"
                  ? "text-white font-semibold"
                  : "text-[#667085] hover:text-[#172033]"
              }`}
            >
              有金额优先
            </button>
          </div>
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              table.setPageSize(Number(e.target.value));
            }}
            className="text-[12px] border border-[#E4E9F0] rounded px-2 py-1 text-[#667085]"
          >
            <option value={20}>20条/页</option>
            <option value={50}>50条/页</option>
            <option value={100}>100条/页</option>
          </select>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="border-b border-[#F0F2F5]">
                {hg.headers.map((header) => {
                  const hideOnMobile = (header.column.columnDef.meta as { hideOnMobile?: boolean })?.hideOnMobile;
                  return (
                  <th
                    key={header.id}
                    className={`px-3 py-2.5 text-left text-[11px] font-medium text-[#667085] uppercase tracking-wider whitespace-nowrap ${hideOnMobile ? "hidden md:table-cell" : ""}`}
                    style={{ width: header.getSize() }}
                  >
                    {header.column.getCanSort() ? (
                      <button
                        onClick={header.column.getToggleSortingHandler()}
                        className="inline-flex items-center gap-1 hover:text-[#172033] transition-colors"
                      >
                        {flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                        {header.column.getIsSorted() === "asc" ? (
                          <ChevronUp className="w-3 h-3" />
                        ) : header.column.getIsSorted() === "desc" ? (
                          <ChevronDown className="w-3 h-3" />
                        ) : (
                          <ChevronsUpDown className="w-3 h-3 text-[#CBD5E1]" />
                        )}
                      </button>
                    ) : (
                      flexRender(
                        header.column.columnDef.header,
                        header.getContext()
                      )
                    )}
                  </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody className="divide-y divide-[#F0F2F5]">
            {table.getRowModel().rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-12 text-center text-[13px] text-[#98A2B3]"
                >
                  暂无匹配数据，请调整筛选条件
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  className="hover:bg-[#F8FAFC] transition-colors duration-150"
                >
                  {row.getVisibleCells().map((cell) => {
                    const hideOnMobile = (cell.column.columnDef.meta as { hideOnMobile?: boolean })?.hideOnMobile;
                    return (
                    <td key={cell.id} className={`px-3 py-2.5 align-top ${hideOnMobile ? "hidden md:table-cell" : ""}`}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between px-5 py-3 border-t border-[#F0F2F5]">
        <span className="text-[12px] text-[#98A2B3]">
          共 {sortedData.length} 条，第 {currentPage}/{pageCount} 页
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
            className="p-1.5 rounded text-[#98A2B3] hover:text-[#172033] hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          {Array.from(
            { length: Math.min(5, pageCount) },
            (_, i) => {
              const start = Math.max(0, currentPage - 3);
              return start + i;
            }
          )
            .filter((p) => p < pageCount)
            .map((pageIndex) => (
              <button
                key={pageIndex}
                onClick={() => table.setPageIndex(pageIndex)}
                className={`min-w-[28px] h-7 rounded text-[12px] font-medium transition-colors ${
                  pageIndex === currentPage - 1
                    ? "bg-[#162B49] text-white"
                    : "text-[#667085] hover:bg-gray-100"
                }`}
              >
                {pageIndex + 1}
              </button>
            ))}
          <button
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
            className="p-1.5 rounded text-[#98A2B3] hover:text-[#172033] hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
