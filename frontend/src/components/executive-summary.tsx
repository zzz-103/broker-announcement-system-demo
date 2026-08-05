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
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  const displayColor = value < 30 ? "#F59E0B" : color;
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
    <div className="grid grid-cols-12 gap-4 md:gap-5">
      {/* Left: concise business summary */}
      <div className="col-span-12 flex min-h-[190px] flex-col justify-between rounded-xl border border-[#E4EAF2] bg-white p-4 shadow-[0_1px_2px_rgba(16,40,71,0.03)] sm:p-5 lg:col-span-8">
        {data.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center py-8 h-full">
            <p className="text-[13px] text-[#475467] font-semibold mb-1">
              当前筛选条件下暂无公开招采项目数据
            </p>
            <p className="text-[11px] text-[#98A2B3] max-w-sm">
              请调整时间范围、业务方向或券商主体后重试。
            </p>
          </div>
        ) : (
          <>
            <div>
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="text-[15px] font-bold text-[#172033]">当前筛选摘要</h3>
                <span className="text-[11px] text-[#7A8699]">按去重项目线索统计</span>
              </div>
              
              {/* 1. 顶部核心结论 */}
              {summary.topDomains.length > 0 && (
                <div className="border-l-2 border-[#2563EB] bg-[#F8FAFD] px-3.5 py-3 text-[13px] font-semibold leading-relaxed text-[#243B61]">
                  核心方向：公开项目线索主要集中于 <span className="font-bold text-[#2563EB]">{summary.topDomains.join("、")}</span>。
                </div>
              )}

              {/* 2. Inline findings keep the scan path compact. */}
              <div className="mt-4 grid grid-cols-1 gap-3 border-t border-[#EEF2F6] pt-3 text-[12px] leading-5 text-[#475467] md:grid-cols-3 md:gap-4">
                <p><span className="font-semibold text-[#667085]">方向热点：</span>{summary.topDomains.slice(0, 2).join("、") || "暂无"}</p>
                <p><span className="font-semibold text-[#667085]">活跃主体：</span>{summary.topBrokers.join("、") || "暂无"}</p>
                <p><span className="font-semibold text-[#667085]">活跃供应商：</span>{summary.topSuppliers.slice(0, 2).join("、") || "暂无"}</p>
              </div>
            </div>

            <div className="mt-3 border-t border-[#EEF2F6] pt-2 text-[11px] text-[#7A8699]">
              数据受到公开披露程度及采集覆盖范围影响。
            </div>
          </>
        )}
      </div>

      {/* Right: data quality and secondary metrics */}
      <div className="col-span-12 flex flex-col justify-between rounded-xl border border-[#E4EAF2] bg-white p-4 shadow-[0_1px_2px_rgba(16,40,71,0.03)] sm:p-5 lg:col-span-4">
        <div>
          <h3 className="text-[15px] font-bold text-[#172033] mb-3">
            数据质量与覆盖
          </h3>

          <div className="mb-4 grid grid-cols-2 gap-x-4 gap-y-2 border-b border-[#EEF2F6] pb-3 sm:grid-cols-3 lg:grid-cols-2">
            <div><p className="text-[10px] text-[#7A8699]">数据最新日期</p><p className="mt-0.5 text-[12px] font-semibold text-[#172033]">{coverage.latestDate}</p></div>
            <div><p className="text-[10px] text-[#7A8699]">已接入数据源</p><p className="mt-0.5 text-[16px] font-bold tabular-nums text-[#172033]">{coverage.sourceCount}</p></div>
            <div><p className="text-[10px] text-[#7A8699]">当前覆盖主体</p><p className="mt-0.5 text-[16px] font-bold tabular-nums text-[#172033]">{coverage.activeBrokers}</p></div>
            <div><p className="text-[10px] text-[#7A8699]">披露供应商项目</p><p className="mt-0.5 text-[16px] font-bold tabular-nums text-[#172033]">{coverage.supplierProjects}</p></div>
            <div><p className="text-[10px] text-[#7A8699]">公开金额样本</p><p className="mt-0.5 text-[16px] font-bold tabular-nums text-[#172033]">{coverage.amountSamples}</p></div>
          </div>

          {/* Progress bars */}
          <div className="space-y-3">
            <CoverageBar
              label="有效日期覆盖率"
              value={parseFloat(coverage.dateRate)}
              color="#2563EB"
            />
            <CoverageBar
              label="供应商字段完整率"
              value={parseFloat(coverage.supplierRate)}
              color="#0F9F8F"
            />
            <CoverageBar
              label="金额字段完整率"
              value={parseFloat(coverage.amountRate)}
              color="#F59E0B"
            />
          </div>
        </div>

        {/* Duplicate warning */}
        {coverage.dupCount > 0 && (
          <div className="mt-4 flex items-center gap-2 rounded-lg border border-[#FDE68A] bg-[#FFFBEB] px-3 py-2 text-[12px] text-[#B45309]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#F59E0B] shrink-0" />
            疑似重复源文件 {coverage.dupCount} 组
          </div>
        )}
      </div>
    </div>
  );
}
