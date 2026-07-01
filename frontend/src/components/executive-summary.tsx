"use client";

import { useMemo } from "react";
import type { ProcessedRecord } from "@/lib/announcement-data";
import {
  getDataBaseline,
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
  return (
    <div>
      <div className="flex justify-between items-center mb-1">
        <span className="text-[12px] text-[#667085]">{label}</span>
        <span
          className="text-[13px] font-semibold tabular-nums"
          style={{ color }}
        >
          {value.toFixed(1)}%
        </span>
      </div>
      <div className="h-2 bg-[#F0F2F5] rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700 ease-out"
          style={{
            width: `${Math.min(value, 100)}%`,
            backgroundColor: color,
          }}
        />
      </div>
    </div>
  );
}

interface ExecutiveSummaryProps {
  data: ProcessedRecord[];
  allData: ProcessedRecord[];
}

export function ExecutiveSummary({ data, allData }: ExecutiveSummaryProps) {
  const baseline = useMemo(() => getDataBaseline(allData), [allData]);

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

    // Summary 4: Price disclosure rate
    const priceSamples = uniqueCount(
      data.filter((r) => r.priceSampleKey).map((r) => r.priceSampleKey!)
    );
    const totalProjects = uniqueCount(data.map((r) => r.projectKey));
    const priceRate =
      totalProjects > 0 ? ((priceSamples / totalProjects) * 100).toFixed(1) : "0";

    return { topDomains, topBrokers, topSuppliers, priceSamples, priceRate };
  }, [data, baseline]);

  // Coverage quality
  const coverage = useMemo(() => {
    const total = allData.length;
    const validDates = allData.filter((r) => r.validPublishDate).length;
    const validSuppliers = allData.filter(
      (r) => r.normalizedSupplier !== ""
    ).length;
    const validPrices = allData.filter(
      (r) => r.winning_amount_yuan !== null
    ).length;

    // Duplicate sha1 detection
    const shaMap: Record<string, Set<string>> = {};
    for (const r of allData) {
      if (!r.document_sha1) continue;
      if (!shaMap[r.document_sha1]) shaMap[r.document_sha1] = new Set();
      shaMap[r.document_sha1].add(r.markdown_file);
    }
    const dupCount = Object.values(shaMap).filter((s) => s.size > 1).length;

    return {
      latestDate: formatDate(getDataBaseline(allData)),
      dateRate: total > 0 ? ((validDates / total) * 100).toFixed(1) : "0",
      supplierRate: total > 0 ? ((validSuppliers / total) * 100).toFixed(1) : "0",
      priceRate: total > 0 ? ((validPrices / total) * 100).toFixed(1) : "0",
      dupCount,
      totalBrokers: uniqueCount(
        allData.filter((r) => r.validBrokerName !== "主体待识别").map((r) => r.validBrokerName)
      ),
    };
  }, [allData]);

  return (
    <div className="grid grid-cols-12 gap-4">
      {/* Left: Intelligence Summary */}
      <div className="col-span-12 lg:col-span-8 bg-white rounded-[10px] border border-[#E4E9F0] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4 sm:p-5">
        <h3 className="text-[16px] font-semibold text-[#172033] mb-4">
          本期情报摘要
        </h3>
        <div className="space-y-3 text-[13px] text-[#172033] leading-relaxed">
          {summary.topDomains.length > 0 && (
            <p>
              当前公开项目线索主要集中在
              <span className="font-medium text-[#2563EB]">
                {summary.topDomains.join("、")}
              </span>
              。
            </p>
          )}
          {summary.topBrokers.length > 0 && (
            <p>
              <span className="font-medium">{summary.topBrokers.join("、")}</span>
              近期公开招采线索相对较多。
            </p>
          )}
          {summary.topSuppliers.length > 0 && (
            <p>
              结果公示中披露项目次数较多的供应商包括
              <span className="font-medium">{summary.topSuppliers.join("、")}</span>
              。
            </p>
          )}
          <p>
            当前有效公开价格样本
            <span className="font-medium text-[#0F9F8F]">
              {summary.priceSamples}
            </span>
            条，价格披露率{summary.priceRate}%。
          </p>
        </div>
        <p className="text-[11px] text-[#98A2B3] mt-4">
          公开项目数量同时受到各主体信息披露程度和采集覆盖范围影响。
        </p>
      </div>

      {/* Right: Coverage & Quality */}
      <div className="col-span-12 lg:col-span-4 bg-white rounded-[10px] border border-[#E4E9F0] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4 sm:p-5">
        <h3 className="text-[16px] font-semibold text-[#172033] mb-4">
          数据覆盖与可信度
        </h3>

        {/* Top stats row */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="bg-[#F8FAFC] rounded-lg p-3 text-center">
            <p className="text-[11px] text-[#98A2B3] mb-1">数据最新日期</p>
            <p className="text-[14px] font-semibold text-[#172033]">
              {coverage.latestDate}
            </p>
          </div>
          <div className="bg-[#F8FAFC] rounded-lg p-3 text-center">
            <p className="text-[11px] text-[#98A2B3] mb-1">覆盖主体数</p>
            <p className="text-[20px] font-bold text-[#2563EB] tabular-nums">
              {coverage.totalBrokers}
            </p>
          </div>
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
            label="价格字段完整率"
            value={parseFloat(coverage.priceRate)}
            color="#F59E0B"
          />
        </div>

        {/* Duplicate warning */}
        {coverage.dupCount > 0 && (
          <div className="mt-3 flex items-center gap-2 text-[12px] text-[#F59E0B] bg-[#FFFBEB] rounded-lg px-3 py-2">
            <span className="w-1.5 h-1.5 rounded-full bg-[#F59E0B] shrink-0" />
            疑似重复源文件 {coverage.dupCount} 组
          </div>
        )}
      </div>
    </div>
  );
}
