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
    <div className="grid grid-cols-12 gap-4 md:gap-5">
      {/* Left: Intelligence Summary */}
      <div className="col-span-12 lg:col-span-8 bg-white rounded-2xl border border-[#E4EAF2] shadow-[0_1px_3px_rgba(0,0,0,0.02)] p-4 sm:p-5 flex flex-col justify-between min-h-[220px]">
        {data.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center py-8 h-full">
            <p className="text-[13px] text-[#475467] font-semibold mb-1">
              当前筛选条件下暂无公开招采项目数据
            </p>
            <p className="text-[11px] text-[#98A2B3] max-w-sm">
              无法生成本期情报摘要。请尝试调整时间范围、取消“仅看金融科技”勾选或选择其他券商主体。
            </p>
          </div>
        ) : (
          <>
            <div>
              <h3 className="text-[15px] font-bold text-[#172033] mb-3">
                本期情报摘要
              </h3>
              
              {/* 1. 顶部核心结论 */}
              {summary.topDomains.length > 0 && (
                <div className="bg-blue-50/50 rounded-xl p-3.5 border border-blue-100/40 text-[13px] leading-relaxed mb-4 text-[#102847] font-semibold">
                  📌 核心发现：公开项目线索高度聚焦于金融科技的 <span className="text-[#2563EB] font-bold underline decoration-blue-300 decoration-2 underline-offset-2">{summary.topDomains.join("、")}</span> 建设方向。
                </div>
              )}

              {/* 2. 中部关键发现 (分块展示) */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
                <div className="bg-[#F8FAFC]/60 border border-[#E4EAF2] rounded-xl p-3.5">
                  <div className="text-[11px] text-[#718096] font-bold mb-1">方向热点</div>
                  <div className="text-[13px] text-[#172033] leading-relaxed">
                    当前科技采购主要集中于 <span className="font-semibold text-purple-600">{summary.topDomains.slice(0, 2).join("与")}</span> 等核心方向。
                  </div>
                </div>
                <div className="bg-[#F8FAFC]/60 border border-[#E4EAF2] rounded-xl p-3.5">
                  <div className="text-[11px] text-[#718096] font-bold mb-1">活跃机构</div>
                  <div className="text-[13px] text-[#172033] leading-relaxed">
                    近期 <span className="font-semibold text-blue-600">{summary.topBrokers.join("、") || "各大券商"}</span> 在公开渠道披露的建设动态较多。
                  </div>
                </div>
                <div className="bg-[#F8FAFC]/60 border border-[#E4EAF2] rounded-xl p-3.5">
                  <div className="text-[11px] text-[#718096] font-bold mb-1">活跃供应商</div>
                  <div className="text-[13px] text-[#172033] leading-relaxed">
                    项目中标结果中频繁出现 <span className="font-semibold text-teal-600">{summary.topSuppliers.slice(0, 2).join("与")}</span> 等行业供应商。
                  </div>
                </div>
              </div>
            </div>

            {/* 3. 底部辅助说明 */}
            <div className="border-t border-[#F0F2F5] pt-3 mt-3 flex items-center justify-between text-[12px] text-[#667085] flex-wrap gap-2">
              <div>
                当前拥有有效公开价格样本 <span className="font-bold text-[#0F9F8F] text-[13px]">{summary.priceSamples}</span> 条，价格披露率为 <span className="font-bold text-blue-600 text-[13px]">{summary.priceRate}%</span>。
              </div>
              <div className="text-[11px] text-[#98A2B3]">
                ℹ️ 数据受到各主体信息披露程度及采集覆盖范围影响。
              </div>
            </div>
          </>
        )}
      </div>

      {/* Right: Coverage & Quality */}
      <div className="col-span-12 lg:col-span-4 bg-white rounded-2xl border border-[#E4EAF2] shadow-[0_1px_3px_rgba(0,0,0,0.02)] p-4 sm:p-5 flex flex-col justify-between">
        <div>
          <h3 className="text-[15px] font-bold text-[#172033] mb-3">
            数据覆盖与可信度
          </h3>

          {/* Top stats row */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="bg-[#F8FAFC]/60 border border-[#E4EAF2] rounded-xl p-3 text-center">
              <p className="text-[11px] text-[#98A2B3] mb-0.5">数据最新日期</p>
              <p className="text-[13px] font-bold text-[#172033] tracking-wide">
                {coverage.latestDate}
              </p>
            </div>
            <div className="bg-[#F8FAFC]/60 border border-[#E4EAF2] rounded-xl p-3 text-center">
              <p className="text-[11px] text-[#98A2B3] mb-0.5">覆盖主体数</p>
              <p className="text-[18px] font-bold text-[#2563EB] tabular-nums leading-none mt-0.5">
                {coverage.totalBrokers}
              </p>
            </div>
          </div>

          {/* Progress bars */}
          <div className="space-y-3.5">
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
        </div>

        {/* Duplicate warning */}
        {coverage.dupCount > 0 && (
          <div className="mt-4 flex items-center gap-2 text-[12px] text-[#B45309] bg-[#FFFBEB] border border-[#FDE68A] rounded-xl px-3 py-2">
            <span className="w-1.5 h-1.5 rounded-full bg-[#F59E0B] shrink-0" />
            疑似重复源文件 {coverage.dupCount} 组
          </div>
        )}
      </div>
    </div>
  );
}
