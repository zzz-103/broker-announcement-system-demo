"use client";

import { getReleaseTrend, getUpdateTypeDistribution, getFeatureTagDistribution, getBrokerReleaseCounts } from "@/lib/app-release-data";
import type { AppReleaseRecord } from "@/lib/app-release-data";

interface OverviewChartsProps {
  data: AppReleaseRecord[];
}

export function OverviewCharts({ data }: OverviewChartsProps) {
  const trendData = getReleaseTrend(data);
  const typeData = getUpdateTypeDistribution(data);
  const tagData = getFeatureTagDistribution(data);
  const brokerData = getBrokerReleaseCounts(data);

  return (
    <>
      {/* Update Trend */}
      <div className="rounded-xl border border-[#E4E9F0] bg-white p-4 lg:col-span-6">
        <h4 className="text-sm font-semibold text-[#172033] mb-4">更新时间趋势</h4>
        {data.length === 0 ? (
          <EmptyState />
        ) : (
          <BarChart data={trendData} color="#2563EB" />
        )}
      </div>

      {/* Update Type Distribution */}
      <div className="rounded-xl border border-[#E4E9F0] bg-white p-4 lg:col-span-6">
        <h4 className="text-sm font-semibold text-[#172033] mb-4">更新类型分布</h4>
        {typeData.length === 0 ? (
          <EmptyState />
        ) : (
          <BarChart data={typeData} color="#0F9F8F" />
        )}
      </div>

      {/* Feature Tags */}
      <div className="rounded-xl border border-[#E4E9F0] bg-white p-4 lg:col-span-6">
        <h4 className="text-sm font-semibold text-[#172033] mb-4">功能标签分布</h4>
        {tagData.length === 0 ? (
          <EmptyState />
        ) : (
          <BarChart data={tagData} color="#F59E0B" maxBars={8} />
        )}
      </div>

      {/* Broker Release Count */}
      <div className="rounded-xl border border-[#E4E9F0] bg-white p-4 lg:col-span-6">
        <h4 className="text-sm font-semibold text-[#172033] mb-4">各券商更新数</h4>
        {brokerData.length === 0 ? (
          <EmptyState />
        ) : (
          <BarChart data={brokerData} color="#2563EB" maxBars={5} horizontal />
        )}
      </div>
    </>
  );
}

function BarChart({
  data,
  color,
  maxBars,
  horizontal,
}: {
  data: { name: string; count: number }[];
  color: string;
  maxBars?: number;
  horizontal?: boolean;
}) {
  const displayData = maxBars ? data.slice(0, maxBars) : data;
  const maxValue = Math.max(...displayData.map((d) => d.count), 1);

  if (horizontal) {
    return (
      <div className="space-y-2">
        {displayData.map((item) => (
          <div key={item.name} className="flex items-center gap-2">
            <span className="w-20 text-xs truncate text-[#667085]">{item.name}</span>
            <div className="flex-1 h-6 rounded bg-slate-50 overflow-hidden">
              <div
                className="h-full rounded transition-all"
                style={{ width: `${(item.count / maxValue) * 100}%`, backgroundColor: color }}
              />
            </div>
            <span className="text-xs font-medium text-[#172033] w-8 text-right">{item.count}</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
      {displayData.map((item) => (
        <div key={item.name} className="flex flex-col items-center gap-1">
          <div className="h-24 w-full relative rounded overflow-hidden" style={{ backgroundColor: "#F8FAFC" }}>
            <div
              className="absolute bottom-0 left-0 right-0 rounded transition-all"
              style={{ height: `${(item.count / maxValue) * 96}%`, backgroundColor: color }}
            />
          </div>
          <span className="text-[10px] truncate w-full text-center text-[#667085]">{item.name}</span>
          <span className="text-xs font-medium text-[#172033]">{item.count}</span>
        </div>
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex h-32 flex-col items-center justify-center text-[#98A2B3]">
      <svg className="mb-2 size-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
      <span className="text-sm">暂无数据</span>
    </div>
  );
}
