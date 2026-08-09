"use client";

import { useMemo } from "react";
import type { ProcessedRecord } from "@/lib/announcement-data";
import {
  formatDate,
  getDashboardStatistics,
  getValidBrokerName,
  uniqueCount,
} from "@/lib/announcement-data";

function CoverageBar({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  // 蓝色用于正常主指标，低完整率（<30%）使用琥珀色提醒。
  const displayColor = value < 30 ? "#F59E0B" : "#2563EB";
  return (
    <div>
      <div className="flex justify-between items-center mb-1">
        <span className="text-[12px] text-[#667085]">{label}</span>
        <span
          className="text-[13px] font-semibold tabular-nums"
          style={{ color: displayColor }}
        >
          {value.toFixed(1)}%
        </span>
      </div>
      <div
        className="h-2 bg-[#F0F2F5] rounded-full overflow-hidden"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Number(value.toFixed(1))}
      >
        <div
          className="h-full rounded-full transition-all duration-700 ease-out"
          style={{
            width: `${Math.min(value, 100)}%`,
            backgroundColor: displayColor,
          }}
        />
      </div>
    </div>
  );
}

interface ExecutiveSummaryProps {
  data: ProcessedRecord[];
  allData: ProcessedRecord[];
  baseline: Date | null;
}

export function ExecutiveSummary({ data, allData, baseline }: ExecutiveSummaryProps) {
  const summary = useMemo(() => {
    // Summary 1: Top 3 domains by project keys
    const domainCounts: Record<string, number> = {};
    const domainKeys: Record<string, Set<string>> = {};
    for (const r of data) {
      if (!domainKeys[r.primaryDomain]) {
        domainKeys[r.primaryDomain] = new Set();
      }
      domainKeys[r.primaryDomain].add(r.projectKey);
    }
    for (const [d, keys] of Object.entries(domainKeys)) {
      domainCounts[d] = keys.size;
    }
    const topDomains = Object.entries(domainCounts)
      .filter(([d]) => d !== "非金融科技及其他")
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([d]) => d);

    return { topDomains };
  }, [data]);

  // Coverage quality
  const coverage = useMemo(() => {
    const total = allData.length;
    const validDates = allData.filter((r) => r.validPublishDate).length;
    const validSuppliers = allData.filter(
      (r) => r.normalizedSupplier !== ""
    ).length;
    const validAmounts = allData.filter(
      (r) => r.display_amount_yuan !== null
    ).length;

    const sourceCount = getDashboardStatistics(allData).sourceCount;
    const activeBrokers = uniqueCount(
      data.map(getValidBrokerName).filter((name): name is string => Boolean(name)),
    );
    const supplierProjects = uniqueCount(
      data
        .filter((record) => record.announcement_stage === "结果公示" && record.normalizedSupplier)
        .map((record) => record.projectKey),
    );
    const amountSamples = uniqueCount(
      data.filter((record) => record.amountSampleKey).map((record) => record.amountSampleKey!),
    );

    return {
      latestDate: formatDate(baseline),
      dateRate: total > 0 ? ((validDates / total) * 100).toFixed(1) : "0",
      supplierRate: total > 0 ? ((validSuppliers / total) * 100).toFixed(1) : "0",
      amountRate: total > 0 ? ((validAmounts / total) * 100).toFixed(1) : "0",
      sourceCount,
      activeBrokers,
      supplierProjects,
      amountSamples,
      totalBrokers: uniqueCount(
        allData.map(getValidBrokerName).filter((name): name is string => Boolean(name))
      ),
    };
  }, [allData, baseline, data]);

  return (
    <div className="surface-panel p-4 sm:p-5">
      {/* Panel header */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[15px] font-bold text-[#172033]">本期概览</h3>
        <span className="text-[11px] text-[#7A8699]">按项目线索统计</span>
      </div>

      <div>
        <div className="min-w-0">
          {data.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <p className="mb-1 text-[13px] font-semibold text-[#475467]">
                当前筛选条件下暂无公开招采项目数据
              </p>
              <p className="max-w-sm text-[11px] text-[#98A2B3]">
                请调整时间范围、业务方向或券商主体后重试。
              </p>
            </div>
          ) : (
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
              {summary.topDomains.length > 0 ? (
                <div className="border-l-2 border-[#2563EB] bg-[#F8FAFD] px-3.5 py-3 text-[13px] font-semibold leading-relaxed text-[#243B61]">
                  重点方向：公开项目线索主要集中于 <span className="font-bold text-[#2563EB]">{summary.topDomains.join("、")}</span>。
                </div>
              ) : (
                <div className="border-l-2 border-[#98A2B3] bg-[#F8FAFD] px-3.5 py-3 text-[13px] font-semibold leading-relaxed text-[#475467]">
                  当前范围以非金融科技或未分类项目为主。
                </div>
              )}
              <div className="flex flex-wrap gap-x-5 gap-y-2 rounded-lg border border-[#E9EEF4] bg-white px-3.5 py-3 text-xs text-[#667085]">
                <span>活跃券商 <strong className="ml-1 text-[#172033]">{coverage.activeBrokers}</strong></span>
                <span>供应商项目 <strong className="ml-1 text-[#172033]">{coverage.supplierProjects}</strong></span>
                <span>金额项目 <strong className="ml-1 text-[#172033]">{coverage.amountSamples}</strong></span>
              </div>
            </div>
          )}
        </div>

        <details className="mt-4 border-t border-[#EEF2F6] pt-3">
          <summary className="cursor-pointer list-none text-xs font-semibold text-[#475467] marker:hidden">
            全量数据质量
            <span className="ml-2 font-normal text-[#98A2B3]">最新 {coverage.latestDate} · {coverage.sourceCount} 类公开数据源 · 覆盖 {coverage.totalBrokers} 家券商</span>
          </summary>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <CoverageBar label="日期完整率" value={parseFloat(coverage.dateRate)} />
            <CoverageBar label="供应商完整率" value={parseFloat(coverage.supplierRate)} />
            <CoverageBar label="金额完整率" value={parseFloat(coverage.amountRate)} />
          </div>
          <p className="mt-3 text-[11px] text-[#7A8699]">以上质量指标按全量数据统计，不随当前筛选变化。</p>
        </details>
      </div>
    </div>
  );
}
