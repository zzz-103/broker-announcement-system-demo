"use client";

import { useState, useMemo } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
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
  CalendarDays,
  BadgeDollarSign,
  Rows3,
} from "lucide-react";
import type { ProcessedRecord } from "@/lib/announcement-data";
import { displayAmountLabel, formatDate, formatAmount } from "@/lib/announcement-data";

interface ProjectTableProps {
  data: ProcessedRecord[];
  onSelectProject: (r: ProcessedRecord) => void;
}

const STAGE_STYLES: Record<string, string> = {
  采购招标: "bg-blue-50 border-blue-100 text-blue-700",
  结果公示: "bg-emerald-50 border-emerald-100 text-emerald-700",
  流标废标: "bg-orange-50 border-orange-100 text-orange-700",
  待确认: "bg-slate-50 border-slate-100 text-slate-600",
};

const getTagStyle = (tag: string) => {
  if (tag.includes("交易") || tag.includes("核心")) return "bg-red-50 border-red-100 text-red-600";
  if (tag.includes("云") || tag.includes("算力") || tag.includes("架构")) return "bg-purple-50 border-purple-100 text-purple-600";
  if (tag.includes("软件") || tag.includes("采购")) return "bg-slate-100 border-slate-200 text-[#475467]";
  if (tag.includes("服务") || tag.includes("运维")) return "bg-amber-50 border-amber-100 text-amber-600";
  return "bg-slate-50 border-slate-100 text-slate-600";
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
        const aHasAmount = a.display_amount_yuan !== null ? 1 : 0;
        const bHasAmount = b.display_amount_yuan !== null ? 1 : 0;
        if (aHasAmount !== bHasAmount) return bHasAmount - aHasAmount;
        // 同组内按日期降序
        const aTime = a.validPublishDate?.getTime() || 0;
        const bTime = b.validPublishDate?.getTime() || 0;
        return bTime - aTime;
      });
    }
    return [...data].sort((a, b) => {
      const aTime = a.validPublishDate?.getTime();
      const bTime = b.validPublishDate?.getTime();
      const aHasDate = typeof aTime === "number";
      const bHasDate = typeof bTime === "number";
      if (aHasDate && bHasDate) return bTime! - aTime!;
      if (aHasDate) return -1;
      if (bHasDate) return 1;
      return 0;
    });
  }, [data, sortMode]);

  const columns: ColumnDef<ProcessedRecord>[] = useMemo(
    () => [
      {
        accessorKey: "validBrokerName",
        header: "主体",
        size: 100,
        cell: ({ getValue }) => (
          <span className="text-[13px] text-[#172033] font-semibold">
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
            className="text-[13px] text-[#172033] font-bold line-clamp-2 leading-relaxed"
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
          <span className="text-[12px] text-[#475467] font-medium">{getValue<string>()}</span>
        ),
      },
      {
        id: "topicTags",
        header: "主题标签",
        size: 140,
        meta: { hideOnMobile: true },
        accessorFn: (r) => r.topicTags.join(", "),
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1.5">
            {row.original.topicTags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className={`text-[10px] px-1.5 py-0.5 rounded-[4px] border font-bold leading-none flex items-center h-[18px] ${getTagStyle(tag)}`}
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
        cell: ({ getValue, row }) => {
          const stage = getValue<string>() || "待确认";
          const style = STAGE_STYLES[stage] || "bg-slate-50 border-slate-100 text-slate-600";
          return (
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded-[4px] border text-[11px] font-bold leading-none h-[18px] ${style}`}
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
          <span className="text-[12px] text-[#667085] font-medium">
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
            <span className="text-[12px] text-[#475467] font-semibold truncate block" title={v || "未披露"}>
              {v || "未披露"}
            </span>
          );
        },
      },
      {
        accessorKey: "display_amount_yuan",
        header: "公开金额",
        size: 120,
        enableSorting: true,
        cell: ({ getValue, row }) => {
          const v = getValue<number | null>();
          return (
            <div className={`text-right ${v === null ? "text-[#98A2B3]" : row.original.display_amount_kind === "winning" ? "text-[#0F9F8F]" : "text-[#2563EB]"}`}>
              <span className="block text-[10px] font-medium">{v !== null ? displayAmountLabel(row.original) : "未披露"}</span>
              <span className={`block text-[13px] font-bold tabular-nums ${v === null ? "font-medium" : ""}`}>
                {v !== null ? formatAmount(v) : "-"}
              </span>
            </div>
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
          <span className="text-[12px] text-[#98A2B3] font-medium tabular-nums">
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
            aria-label="查看项目详情"
            title="查看项目详情"
            className="p-1.5 rounded-lg hover:bg-blue-50 text-[#667085] hover:text-[#2563EB] transition-colors"
          >
            <Eye className="w-4 h-4" />
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
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize } },
  });

  const pageCount = Math.max(1, table.getPageCount());
  const currentPage = table.getState().pagination.pageIndex + 1;

  return (
    <div className="bg-white rounded-2xl border border-[#E4EAF2] shadow-[0_1px_3px_rgba(0,0,0,0.02)] overflow-hidden">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between px-5 py-4 border-b border-[#E4EAF2] gap-3">
        <div>
          <h3 className="text-[15px] font-bold text-[#172033]">
            项目明细
          </h3>
          <p className="text-[11px] text-[#98A2B3] mt-0.5 font-medium">
            共 {sortedData.length} 条符合当前筛选条件
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <div className="inline-flex items-center rounded-xl border border-[#E4EAF2] bg-[#F8FAFC] p-1 shadow-[0_1px_2px_rgba(16,40,71,0.03)]">
            <button
              onClick={() => setSortMode("date")}
              className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12px] font-semibold whitespace-nowrap transition-all duration-200 ${
                sortMode === "date"
                  ? "bg-white text-[#172033] shadow-[0_1px_3px_rgba(16,40,71,0.12)]"
                  : "text-[#667085] hover:text-[#172033]"
              }`}
            >
              <CalendarDays className="h-3.5 w-3.5" />
              按日期
            </button>
            <button
              onClick={() => setSortMode("amount")}
              className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12px] font-semibold whitespace-nowrap transition-all duration-200 ${
                sortMode === "amount"
                  ? "bg-white text-[#172033] shadow-[0_1px_3px_rgba(16,40,71,0.12)]"
                  : "text-[#667085] hover:text-[#172033]"
              }`}
            >
              <BadgeDollarSign className="h-3.5 w-3.5" />
              有金额优先
            </button>
          </div>
          <label className="relative flex h-10 items-center gap-1.5 rounded-xl border border-[#E4EAF2] bg-white pl-3 pr-8 text-[12px] text-[#667085] shadow-[0_1px_2px_rgba(16,40,71,0.03)] transition-colors focus-within:border-[#2563EB] focus-within:ring-2 focus-within:ring-[#2563EB]/10">
            <Rows3 className="h-3.5 w-3.5 text-[#98A2B3]" />
            <span className="font-medium">每页</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                table.setPageSize(Number(e.target.value));
              }}
              aria-label="每页显示数量"
              className="appearance-none bg-transparent pr-1 font-semibold text-[#344054] outline-none"
            >
              <option value={20}>20 条</option>
              <option value={50}>50 条</option>
              <option value={100}>100 条</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 h-3.5 w-3.5 text-[#98A2B3]" />
          </label>
        </div>
      </div>

      <div className="space-y-3 p-3 md:hidden">
        {table.getRowModel().rows.length === 0 ? (
          <p className="py-10 text-center text-[13px] font-medium text-[#98A2B3]">暂无数据</p>
        ) : table.getRowModel().rows.map((row) => {
          const record = row.original;
          const stage = record.announcement_stage || "待确认";
          return (
            <article key={row.id} className="rounded-xl border border-[#E4EAF2] bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <h4 className="min-w-0 text-sm font-bold leading-relaxed text-[#172033]">{record.normalizedProjectName}</h4>
                <span className={`shrink-0 rounded border px-2 py-0.5 text-[11px] font-bold ${STAGE_STYLES[stage] || STAGE_STYLES["待确认"]}`}>{stage}</span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs text-[#667085]">
                <p><span className="text-[#98A2B3]">券商：</span>{record.validBrokerName}</p>
                <p><span className="text-[#98A2B3]">日期：</span>{formatDate(record.validPublishDate)}</p>
                <p className="col-span-2"><span className="text-[#98A2B3]">采购方式：</span>{record.procurement_method || "方式未识别"}</p>
                <p className="col-span-2"><span className="text-[#98A2B3]">中标信息：</span>{record.normalizedSupplier || "未披露"}</p>
                <p className="col-span-2"><span className="text-[#98A2B3]">公开金额：</span>{record.display_amount_yuan !== null ? <span className={record.display_amount_kind === "winning" ? "text-[#0F9F8F]" : "text-[#2563EB]"}>{displayAmountLabel(record)} · {formatAmount(record.display_amount_yuan)}</span> : "未披露"}</p>
              </div>
              <details className="mt-3 border-t border-[#F0F2F5] pt-3 text-xs text-[#667085]">
                <summary className="cursor-pointer font-medium text-[#2563EB]">展开次要字段</summary>
                <div className="mt-2 space-y-1.5"><p>方向：{record.primaryDomain || "未识别"}</p><p>标签：{record.topicTags.join("、") || "无"}</p></div>
              </details>
              <button type="button" onClick={() => onSelectProject(record)} className="mt-3 inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-blue-200 text-xs font-semibold text-[#2563EB] hover:bg-blue-50"><Eye className="size-3.5" />查看详情</button>
            </article>
          );
        })}
      </div>

      <div className="relative hidden overflow-x-auto md:block">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 z-10 bg-[#F4F7FB] border-b border-[#E4EAF2]">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((header) => {
                  const hideOnMobile = (header.column.columnDef.meta as { hideOnMobile?: boolean })?.hideOnMobile;
                  return (
                    <th
                      key={header.id}
                      className={`px-4 py-3 text-left text-[11px] font-bold text-[#475467] uppercase tracking-wider whitespace-nowrap bg-[#F4F7FB] ${hideOnMobile ? "hidden md:table-cell" : ""}`}
                      style={{ width: header.getSize() }}
                    >
                      {header.column.getCanSort() ? (
                        <button
                          onClick={header.column.getToggleSortingHandler()}
                          className="inline-flex items-center gap-1 hover:text-[#172033] transition-colors group"
                        >
                          <span>
                            {flexRender(
                              header.column.columnDef.header,
                              header.getContext()
                            )}
                          </span>
                          {header.column.getIsSorted() === "asc" ? (
                            <ChevronUp className="w-3 h-3 text-[#2563EB]" />
                          ) : header.column.getIsSorted() === "desc" ? (
                            <ChevronDown className="w-3 h-3 text-[#2563EB]" />
                          ) : (
                            <ChevronsUpDown className="w-3 h-3 text-[#CBD5E1] group-hover:text-[#98A2B3] transition-colors" />
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
          <tbody className="divide-y divide-[#F0F2F5] bg-white">
            {table.getRowModel().rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-12 text-center text-[13px] text-[#98A2B3] font-medium"
                >
                  暂无数据
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  className="hover:bg-blue-50/20 transition-colors duration-150 group/row"
                >
                  {row.getVisibleCells().map((cell) => {
                    const hideOnMobile = (cell.column.columnDef.meta as { hideOnMobile?: boolean })?.hideOnMobile;
                    return (
                      <td
                        key={cell.id}
                        className={`px-4 py-3.5 align-middle ${hideOnMobile ? "hidden md:table-cell" : ""}`}
                      >
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
      <div className="flex items-center justify-between gap-2 px-4 py-4 sm:px-5 border-t border-[#F0F2F5] bg-white">
        <span className="min-w-0 truncate text-[12px] text-[#98A2B3] font-semibold">
          共 {sortedData.length} 条，第 {currentPage}/{pageCount} 页
        </span>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
            aria-label="上一页"
            className="p-1.5 rounded-lg text-[#98A2B3] hover:text-[#102847] hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="hidden items-center gap-1.5 sm:flex">{Array.from(
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
                className={`min-w-[28px] h-7 rounded-lg text-[12px] font-bold transition-all ${
                  pageIndex === currentPage - 1
                    ? "bg-[#102847] text-white shadow-sm"
                    : "text-[#667085] hover:bg-blue-50 hover:text-blue-600"
                }`}
              >
                {pageIndex + 1}
              </button>
            ))}</div>
          <button
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
            aria-label="下一页"
            className="p-1.5 rounded-lg text-[#98A2B3] hover:text-[#102847] hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
