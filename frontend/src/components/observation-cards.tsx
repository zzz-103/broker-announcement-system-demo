"use client";

import { useMemo } from "react";
import type { ProcessedRecord } from "@/lib/announcement-data";
import {
  getDataBaseline,
  formatDate,
  uniqueCount,
} from "@/lib/announcement-data";
import { Info } from "lucide-react";

interface ObservationProps {
  data: ProcessedRecord[];
  allData: ProcessedRecord[];
}

export function BrokerActivityCard({ data, allData }: ObservationProps) {
  const baseline = useMemo(() => getDataBaseline(allData), [allData]);

  const brokers = useMemo(() => {
    const ninetyDaysAgo = baseline
      ? new Date(baseline.getTime() - 90 * 86400000)
      : null;
    const recent = ninetyDaysAgo
      ? data.filter(
          (r) => r.validPublishDate && r.validPublishDate >= ninetyDaysAgo
        )
      : data;

    const brokerMap: Record<
      string,
      { keys: Set<string>; domains: Record<string, number>; latestDate: Date | null }
    > = {};

    for (const r of recent) {
      if (r.validBrokerName === "主体待识别") continue;
      if (!brokerMap[r.validBrokerName])
        brokerMap[r.validBrokerName] = {
          keys: new Set(),
          domains: {},
          latestDate: null,
        };
      const b = brokerMap[r.validBrokerName];
      b.keys.add(r.projectKey);
      b.domains[r.primaryDomain] = (b.domains[r.primaryDomain] || 0) + 1;
      if (r.validPublishDate) {
        if (!b.latestDate || r.validPublishDate > b.latestDate)
          b.latestDate = r.validPublishDate;
      }
    }

    return Object.entries(brokerMap)
      .map(([name, info]) => ({
        name,
        count: info.keys.size,
        topDomain:
          Object.entries(info.domains).sort((a, b) => b[1] - a[1])[0]?.[0] ||
          "-",
        latestDate: formatDate(info.latestDate),
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [data, baseline]);

  const maxCount = useMemo(() => {
    if (brokers.length === 0) return 1;
    return Math.max(...brokers.map((b) => b.count));
  }, [brokers]);

  return (
    <div className="col-span-1 md:col-span-6 lg:col-span-5 bg-white rounded-2xl border border-[#E4EAF2] shadow-[0_1px_3px_rgba(0,0,0,0.02)] p-4 sm:p-5 flex flex-col justify-between">
      <div>
        <div className="flex items-center gap-1.5 mb-3.5">
          <h3 className="text-[14px] font-bold text-[#172033]">
            公开招采活跃主体
          </h3>
          <span
            className="relative group cursor-help"
            title="该排名反映公开招采活动，不代表实际科技投入规模。"
          >
            <Info className="w-3.5 h-3.5 text-[#98A2B3] hover:text-[#718096] transition-colors" />
          </span>
        </div>
        <div className="space-y-1">
          {brokers.map((b, i) => (
            <div key={b.name} className="relative py-1.5 group select-none">
              {/* Relative indicator bar */}
              <div 
                className="absolute bottom-0 left-8 h-[2px] bg-blue-500/10 rounded-full transition-all duration-300 motion-reduce:transition-none"
                style={{ width: `calc(${(b.count / maxCount) * 100}% - 32px)` }}
              />
              <div className="relative z-10 flex min-w-0 items-center gap-2 text-[13px] sm:gap-3">
                <span className="w-5 text-[11px] text-[#98A2B3] tabular-nums text-right font-medium">
                  {i + 1}
                </span>
                <span className="text-[#172033] font-semibold flex-1 truncate" title={b.name}>
                  {b.name}
                </span>
                <span className="text-[#2563EB] font-bold tabular-nums w-8 text-right">
                  {b.count}
                </span>
                <span className="hidden w-28 truncate text-[11px] text-[#667085] sm:inline" title={b.topDomain}>
                  {b.topDomain}
                </span>
                <span className="hidden w-20 text-right text-[11px] tabular-nums text-[#98A2B3] sm:inline">
                  {b.latestDate}
                </span>
              </div>
            </div>
          ))}
          {brokers.length === 0 && (
            <p className="text-[12px] text-[#98A2B3] py-8 text-center">
              暂无数据
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export function SupplierObservationCard({ data }: ObservationProps) {
  const suppliers = useMemo(() => {
    const resultRecords = data.filter(
      (r) => r.announcement_stage === "结果公示" && r.normalizedSupplier
    );

    // Deduplicate by projectKey + supplier
    const seen = new Set<string>();
    const supplierMap: Record<
      string,
      { projects: Set<string>; brokers: Set<string>; domains: Record<string, number> }
    > = {};

    for (const r of resultRecords) {
      const dedupKey = `${r.projectKey}||${r.normalizedSupplier}`;
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);

      if (!supplierMap[r.normalizedSupplier])
        supplierMap[r.normalizedSupplier] = {
          projects: new Set(),
          brokers: new Set(),
          domains: {},
        };
      const s = supplierMap[r.normalizedSupplier];
      s.projects.add(r.projectKey);
      s.brokers.add(r.validBrokerName);
      s.domains[r.primaryDomain] = (s.domains[r.primaryDomain] || 0) + 1;
    }

    return Object.entries(supplierMap)
      .map(([name, info]) => ({
        name,
        projectCount: info.projects.size,
        brokerCount: info.brokers.size,
        topDomain:
          Object.entries(info.domains).sort((a, b) => b[1] - a[1])[0]?.[0] ||
          "-",
      }))
      .sort((a, b) => b.projectCount - a.projectCount)
      .slice(0, 8);
  }, [data]);

  const maxCount = useMemo(() => {
    if (suppliers.length === 0) return 1;
    return Math.max(...suppliers.map((s) => s.projectCount));
  }, [suppliers]);

  return (
    <div className="col-span-1 md:col-span-3 lg:col-span-4 bg-white rounded-2xl border border-[#E4EAF2] shadow-[0_1px_3px_rgba(0,0,0,0.02)] p-4 sm:p-5 flex flex-col justify-between">
      <div>
        <h3 className="text-[14px] font-bold text-[#172033] mb-3.5">
          结果公告供应商观察
        </h3>
        <div className="space-y-1">
          {suppliers.map((s, i) => (
            <div key={s.name} className="relative py-1.5 group select-none">
              {/* Relative indicator bar */}
              <div 
                className="absolute bottom-0 left-8 h-[2px] bg-teal-500/10 rounded-full transition-all duration-300 motion-reduce:transition-none"
                style={{ width: `calc(${(s.projectCount / maxCount) * 100}% - 32px)` }}
              />
              <div className="relative z-10 flex min-w-0 items-center gap-2 text-[13px] sm:gap-3">
                <span className="w-5 text-[11px] text-[#98A2B3] tabular-nums text-right font-medium">
                  {i + 1}
                </span>
                <span className="text-[#172033] font-semibold flex-1 truncate" title={s.name}>
                  {s.name}
                </span>
                <span className="text-[#0F9F8F] font-bold tabular-nums w-8 text-right">
                  {s.projectCount}
                </span>
                <span className="text-[11px] text-[#667085] w-12 text-right">
                  {s.brokerCount}家
                </span>
                <span className="hidden w-24 truncate text-[11px] text-[#667085] sm:inline" title={s.topDomain}>
                  {s.topDomain}
                </span>
              </div>
            </div>
          ))}
          {suppliers.length === 0 && (
            <p className="text-[12px] text-[#98A2B3] py-8 text-center">
              暂无数据
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export function PriceSamplesCard({ data, allData }: ObservationProps) {
  const samples = useMemo(() => {
    const priceRecords = data.filter(
      (r) => r.priceSampleKey && r.normalizedSupplier
    );
    // Deduplicate by priceSampleKey
    const seen = new Set<string>();
    const unique = priceRecords.filter((r) => {
      if (seen.has(r.priceSampleKey!)) return false;
      seen.add(r.priceSampleKey!);
      return true;
    });
    // Sort by date desc, take 5
    return unique
      .sort((a, b) => {
        const da = a.validPublishDate?.getTime() || 0;
        const db = b.validPublishDate?.getTime() || 0;
        return db - da;
      })
      .slice(0, 5);
  }, [data]);

  return (
    <div className="col-span-1 md:col-span-3 lg:col-span-3 bg-white rounded-2xl border border-[#E4EAF2] shadow-[0_1px_3px_rgba(0,0,0,0.02)] p-4 sm:p-5 flex flex-col justify-between">
      <div>
        <h3 className="text-[14px] font-bold text-[#172033] mb-3.5">
          公开价格案例
        </h3>
        <div className="space-y-3">
          {samples.map((s, i) => (
            <div
              key={i}
              className="border-b border-[#F0F2F5] last:border-0 pb-2 last:pb-0"
            >
              <div className="text-[12px] text-[#172033] font-semibold line-clamp-2 leading-relaxed" title={s.normalizedProjectName}>
                {s.normalizedProjectName}
              </div>
              <div className="flex items-center justify-between gap-2 mt-1.5">
                <span className="text-[11px] text-[#667085] truncate max-w-[120px]" title={s.validBrokerName}>
                  {s.validBrokerName}
                </span>
                <span className="text-[11px] text-[#0F9F8F] font-bold tabular-nums">
                  {s.winning_amount_yuan !== null
                    ? `¥${(s.winning_amount_yuan / 10000).toFixed(1)}万`
                    : ""}
                </span>
              </div>
            </div>
          ))}
          {samples.length === 0 && (
            <p className="text-[12px] text-[#98A2B3] py-4 text-center">
              暂无数据
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
