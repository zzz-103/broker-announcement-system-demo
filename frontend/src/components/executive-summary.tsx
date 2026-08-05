"use client";

import { useMemo } from "react";
import type { ProcessedRecord } from "@/lib/announcement-data";
import {
  formatDate,
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
      <div className="h-2 bg-[#F0F2F5] rounded-full overflow-hidden">
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

function OverviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-3">
      <p className="text-[11px] font-semibold text-[#7A8699]">{label}</p>
      <p className="mt-1 text-[13px] font-medium leading-6 text-[#344054]">{value}</p>
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

    // Summary 2: Top 3 brokers in recent 30 days
    const thirtyDaysAgo = baseline
      ? new Date(baseline.getTime() - 30 * 86400000)
      : null;
    const recentRecords = thirtyDaysAgo
      ? data.filter(
          (r) => r.validPublishDate && r.validPublishDate >= thirtyDaysAgo
        )
      : [];
    const brokerKeys: Record<string, Set<string>> = {};
    for (const r of recentRecords) {
      if (r.validBrokerName === "主体待识别") continue;
      if (!brokerKeys[r.validBrokerName]) brokerKeys[r.validBrokerName] = new Set();
      brokerKeys[r.validBrokerName].add(r.projectKey);
    }
    const topBrokers = Object.entries(brokerKeys)
      .sort((a, b) => b[1].size - a[1].size)
      .slice(0, 3)
      .map(([b]) => b);

    // Summary 3: Top 3 suppliers in result announcements
    const resultRecords = data.filter(
      (r) => r.announcement_stage === "结果公示" && r.normalizedSupplier
    );
    const supplierKeys: Record<string, Set<string>> = {};
    for (const r of resultRecords) {
      if (!supplierKeys[r.normalizedSupplier])
        supplierKeys[r.normalizedSupplier] = new Set();
      supplierKeys[r.normalizedSupplier].add(r.projectKey);
    }
    const topSuppliers = Object.entries(supplierKeys)
      .sort((a, b) => b[1].size - a[1].size)
      .slice(0, 3)
      .map(([s]) => s);

    return { topDomains, topBrokers, topSuppliers };
  }, [data, baseline]);

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

    // Duplicate sha1 detection
    const shaMap: Record<string, Set<string>> = {};
    for (const r of allData) {
      if (!r.document_sha1) continue;
      if (!shaMap[r.document_sha1]) shaMap[r.document_sha1] = new Set();
      shaMap[r.document_sha1].add(r.markdown_file);
    }
    const dupCount = Object.values(shaMap).filter((s) => s.size > 1).length;
    const sourceCount = new Set(allData.map((record) => record.sourceName).filter(Boolean)).size;
    const activeBrokers = uniqueCount(
      data.filter((record) => record.validBrokerName !== "主体待识别").map((record) => record.validBrokerName),
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
      dupCount,
      sourceCount,
      activeBrokers,
      supplierProjects,
      amountSamples,
      totalBrokers: uniqueCount(
        allData.filter((r) => r.validBrokerName !== "主体待识别").map((r) => r.validBrokerName)
      ),
    };
  }, [allData, baseline, data]);

  return (
    <div className="surface-panel p-4 sm:p-5">
      {/* Panel header */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[15px] font-bold text-[#172033]">本期概览</h3>
        <span className="text-[11px] text-[#7A8699]">按去重项目线索统计</span>
      </div>

      <div className="grid grid-cols-1 items-start lg:grid-cols-[minmax(0,7fr)_minmax(0,3fr)]">
        {/* Left: business overview */}
        <div className="min-w-0 lg:border-r lg:border-[#EEF2F6] lg:pr-5">
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
            <div>
              {/* 核心方向结论 */}
              {summary.topDomains.length > 0 && (
                <div className="border-l-2 border-[#2563EB] bg-[#F8FAFD] px-3.5 py-3 text-[13px] font-semibold leading-relaxed text-[#243B61]">
                  核心方向：公开项目线索主要集中于 <span className="font-bold text-[#2563EB]">{summary.topDomains.join("、")}</span>。
                </div>
              )}

              {/* 辅助概览信息 */}
              <div className="mt-3 border-t border-[#EEF2F6] pt-1">
                <OverviewRow label="活跃主体" value={summary.topBrokers.join("、") || "暂无"} />
                <OverviewRow label="活跃供应商" value={summary.topSuppliers.slice(0, 2).join("、") || "暂无"} />
                <OverviewRow label="方向热点" value={summary.topDomains.slice(0, 2).join("、") || "暂无"} />
              </div>
            </div>
          )}
        </div>

        {/* Right: data quality */}
        <div className="min-w-0 border-t border-[#EEF2F6] pt-4 lg:border-t-0 lg:pl-5 lg:pt-0">
          {/* 基础信息 */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            <div><p className="text-[10px] text-[#7A8699]">数据最新日期</p><p className="mt-0.5 text-[12px] font-semibold text-[#172033]">{coverage.latestDate}</p></div>
            <div><p className="text-[10px] text-[#7A8699]">已接入数据源</p><p className="mt-0.5 text-[16px] font-bold tabular-nums text-[#172033]">{coverage.sourceCount}</p></div>
            <div><p className="text-[10px] text-[#7A8699]">当前覆盖主体</p><p className="mt-0.5 text-[16px] font-bold tabular-nums text-[#172033]">{coverage.activeBrokers}</p></div>
            <div><p className="text-[10px] text-[#7A8699]">披露供应商项目</p><p className="mt-0.5 text-[16px] font-bold tabular-nums text-[#172033]">{coverage.supplierProjects}</p></div>
            <div><p className="text-[10px] text-[#7A8699]">公开金额样本</p><p className="mt-0.5 text-[16px] font-bold tabular-nums text-[#172033]">{coverage.amountSamples}</p></div>
          </div>

          {/* 质量指标 */}
          <div className="mt-4 space-y-3 border-t border-[#EEF2F6] pt-3">
            <CoverageBar label="有效日期覆盖率" value={parseFloat(coverage.dateRate)} />
            <CoverageBar label="供应商字段完整率" value={parseFloat(coverage.supplierRate)} />
            <CoverageBar label="金额字段完整率" value={parseFloat(coverage.amountRate)} />
          </div>

          {/* 异常提示 */}
          {coverage.dupCount > 0 && (
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-[#FDE68A] bg-[#FFFBEB] px-3 py-2 text-[12px] text-[#B45309]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#F59E0B] shrink-0" />
              疑似重复源文件 {coverage.dupCount} 组
            </div>
          )}

          {/* 数据口径说明 */}
          <p className="mt-3 border-t border-[#EEF2F6] pt-2 text-[11px] text-[#7A8699]">
            数据受到公开披露程度及采集覆盖范围影响。
          </p>
        </div>
      </div>
    </div>
  );
}
