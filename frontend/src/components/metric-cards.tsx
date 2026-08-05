"use client";

import { useMemo } from "react";
import type { DashboardStatistics, ProcessedRecord } from "@/lib/announcement-data";
import { uniqueCount } from "@/lib/announcement-data";

interface MetricCardsProps {
  data: ProcessedRecord[];
  baseline: Date | null;
  statistics: DashboardStatistics;
  updatedAt: string | null;
}

interface MetricItem {
  label: string;
  value: string;
  hint: string;
}

export function MetricCards({ data, baseline }: MetricCardsProps) {
  const metrics = useMemo<MetricItem[]>(() => {
    const totalRecords = data.length;
    const uniqueProjects = uniqueCount(data.map((record) => record.projectKey));
    const thirtyDaysAgo = baseline ? new Date(baseline.getTime() - 30 * 86400000) : null;
    const recentProjects = uniqueCount(
      (thirtyDaysAgo
        ? data.filter((record) => record.validPublishDate && record.validPublishDate >= thirtyDaysAgo)
        : []
      ).map((record) => record.projectKey)
    );
    const resultProjects = uniqueCount(
      data.filter((record) => record.announcement_stage === "结果公示").map((record) => record.projectKey)
    );
    return [
      {
        label: "公告结构化记录",
        value: totalRecords.toLocaleString(),
        hint: "当前筛选后的记录数",
      },
      {
        label: "去重项目线索",
        value: uniqueProjects.toLocaleString(),
        hint: "按主体+标准化项目名去重",
      },
      {
        label: "近30日新增线索",
        value: recentProjects.toLocaleString(),
        hint: "以数据最新日期为基准",
      },
      {
        label: "结果公示项目",
        value: resultProjects.toLocaleString(),
        hint: "公告阶段为结果公示的去重线索",
      },
    ];
  }, [data, baseline]);

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 sm:gap-4" aria-label="核心指标">
      {metrics.map((metric) => (
        <div key={metric.label} className="flex min-h-[96px] flex-col justify-between rounded-xl border border-[#E4EAF2] bg-white p-4 shadow-[0_1px_2px_rgba(16,40,71,0.03)] md:min-h-[104px]">
          <div className="text-[12px] font-semibold text-[#667085]">{metric.label}</div>
          <div className="mt-1 text-[27px] font-bold leading-none tabular-nums text-[#172033]">{metric.value}</div>
          <div className="mt-2 truncate text-[11px] text-[#7A8699]" title={metric.hint}>{metric.hint}</div>
        </div>
      ))}
    </div>
  );
}
