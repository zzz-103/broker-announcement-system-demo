"use client";

import { useMemo } from "react";
import type { ProcessedRecord } from "@/lib/announcement-data";
import {
  getDataBaseline,
  uniqueCount,
  formatDate,
} from "@/lib/announcement-data";
import { useFilterStore } from "@/store/filter-store";

interface MetricCardsProps {
  data: ProcessedRecord[];
  allData: ProcessedRecord[];
}

export function MetricCards({ data, allData }: MetricCardsProps) {
  const { setAnnouncementStage, setDetailFilter } = useFilterStore();

  const baseline = useMemo(() => getDataBaseline(allData), [allData]);

  const metrics = useMemo(() => {
    const totalRecords = data.length;
    const uniqueProjects = uniqueCount(data.map((r) => r.projectKey));

    // Recent 30 days
    const thirtyDaysAgo = baseline
      ? new Date(baseline.getTime() - 30 * 86400000)
      : null;
    const recentRecords = thirtyDaysAgo
      ? data.filter(
          (r) => r.validPublishDate && r.validPublishDate >= thirtyDaysAgo
        )
      : [];
    const recentProjects = uniqueCount(recentRecords.map((r) => r.projectKey));

    // Result announced projects
    const resultRecords = data.filter(
      (r) => r.announcement_stage === "结果公示"
    );
    const resultProjects = uniqueCount(resultRecords.map((r) => r.projectKey));

    // Supplier disclosed
    const supplierRecords = data.filter(
      (r) =>
        r.announcement_stage === "结果公示" && r.normalizedSupplier !== ""
    );
    const supplierProjects = uniqueCount(
      supplierRecords.map((r) => r.projectKey)
    );

    // Price samples
    const priceRecords = data.filter((r) => r.priceSampleKey !== null);
    const priceSamples = uniqueCount(
      priceRecords.map((r) => r.priceSampleKey!)
    );

    return [
      {
        label: "公告结构化记录",
        value: totalRecords.toLocaleString(),
        hint: "当前筛选后的CSV行数",
        onClick: null,
      },
      {
        label: "去重项目线索",
        value: uniqueProjects.toLocaleString(),
        hint: "按主体+标准化项目名去重",
        onClick: null,
      },
      {
        label: "近30日新增线索",
        value: recentProjects.toLocaleString(),
        hint: "以数据最新日期为基准",
        onClick: null,
      },
      {
        label: "结果公示项目",
        value: resultProjects.toLocaleString(),
        hint: "公告阶段为结果公示的去重线索",
        onClick: () => setAnnouncementStage("结果公示"),
      },
      {
        label: "披露供应商项目",
        value: supplierProjects.toLocaleString(),
        hint: "结果公示且供应商非空的去重线索",
        onClick: null,
      },
      {
        label: "公开价格样本",
        value: priceSamples.toLocaleString(),
        hint: "有效金额且去重后的样本数",
        onClick: () => setDetailFilter({ hasPrice: "true" }),
      },
    ];
  }, [data, baseline, setAnnouncementStage, setDetailFilter]);

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
      {metrics.map((m) => (
        <button
          key={m.label}
          onClick={m.onClick ?? undefined}
          disabled={!m.onClick}
          className="bg-white rounded-[10px] border border-[#E4E9F0] shadow-[0_1px_2px_rgba(0,0,0,0.04)] px-4 py-4 text-left transition-colors hover:border-[#2563EB]/30 disabled:hover:border-[#E4E9F0] cursor-pointer disabled:cursor-default h-[104px] flex flex-col justify-between"
        >
          <div className="text-[12px] text-[#667085] font-medium">
            {m.label}
          </div>
          <div className="text-[28px] font-semibold text-[#172033] tabular-nums leading-tight">
            {m.value}
          </div>
          <div className="text-[11px] text-[#98A2B3]">{m.hint}</div>
        </button>
      ))}
    </div>
  );
}
