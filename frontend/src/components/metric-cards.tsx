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
  const { setDetailFilter } = useFilterStore();

  const baseline = useMemo(() => getDataBaseline(allData), [allData]);

  const metrics = useMemo(() => {
    const totalRecords = data.length;
    const coveredBrokers = uniqueCount(
      data
        .filter((r) => r.validBrokerName !== "主体待识别")
        .map((r) => r.validBrokerName)
    );
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
        color: "#2563EB",
      },
      {
        label: "已采集券商",
        value: `${coveredBrokers.toLocaleString()} 家`,
        hint: "按当前筛选后的标准化券商去重",
        onClick: null,
        color: "#0F9F8F",
      },
      {
        label: "去重项目线索",
        value: uniqueProjects.toLocaleString(),
        hint: "按主体+标准化项目名去重",
        onClick: null,
        color: "#6366F1",
      },
      {
        label: "近30日新增线索",
        value: recentProjects.toLocaleString(),
        hint: "以数据最新日期为基准",
        onClick: null,
        color: "#7C3AED",
      },
      {
        label: "结果公示项目",
        value: resultProjects.toLocaleString(),
        hint: "公告阶段为结果公示的去重线索",
        onClick: null,
        color: "#0F9F8F",
      },
      {
        label: "披露供应商项目",
        value: supplierProjects.toLocaleString(),
        hint: "结果公示且供应商非空的去重线索",
        onClick: null,
        color: "#16A36A",
      },
      {
        label: "公开价格样本",
        value: priceSamples.toLocaleString(),
        hint: "有效金额且去重后的样本数",
        onClick: () => setDetailFilter({ hasPrice: "true" }),
        color: "#F59E0B",
      },
    ];
  }, [data, baseline, setDetailFilter]);

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-3.5 sm:gap-4">
      {metrics.map((m) => {
        const content = (
          <>
            <div 
              className="absolute top-0 left-0 right-0 h-[3px] pointer-events-none"
              style={{ backgroundColor: m.color }}
            />
            <div className="text-[12px] text-[#718096] font-medium leading-none">
              {m.label}
            </div>
            <div className="text-[26px] sm:text-[28px] font-bold text-[#172033] tabular-nums leading-none mt-1 py-1 flex-grow flex items-center">
              {m.value}
            </div>
            <div className="text-[11px] text-[#98A2B3] leading-none">
              {m.hint}
            </div>
          </>
        );

        return m.onClick ? (
          <button
            key={m.label}
            onClick={m.onClick}
            className="relative overflow-hidden bg-white rounded-xl border border-[#E4EAF2] p-4 text-left transition-all duration-200 shadow-[0_1px_3px_rgba(0,0,0,0.02)] motion-reduce:transition-none motion-reduce:transform-none hover:border-blue-500/35 hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(37,99,235,0.05)] h-[108px] flex flex-col justify-between group cursor-pointer"
          >
            {content}
          </button>
        ) : (
          <div
            key={m.label}
            className="relative overflow-hidden bg-white rounded-xl border border-[#E4EAF2] p-4 text-left shadow-[0_1px_3px_rgba(0,0,0,0.02)] h-[108px] flex flex-col justify-between select-none"
          >
            {content}
          </div>
        );
      })}
    </div>
  );
}
