"use client";

import {
  formatReleaseDate,
  getBrokerReleaseCounts,
  getFeatureTagDistribution,
  getReleaseTrend,
  getUpdateTypeDistribution,
  sortByPublishDateDesc,
  UPDATE_TYPE_COLORS,
  type AppReleaseRecord,
} from "@/lib/app-release-data";

interface OverviewChartsProps {
  data: AppReleaseRecord[];
  onSelect: (record: AppReleaseRecord) => void;
}

const CARD_CLASS =
  "min-w-0 rounded-2xl border border-[#E4EAF2] bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.02)]";

export function OverviewCharts({ data, onSelect }: OverviewChartsProps) {
  const trendData = getReleaseTrend(data).slice(-12);
  const typeData = getUpdateTypeDistribution(data);
  const tagData = getFeatureTagDistribution(data).slice(0, 8);
  const brokerData = getBrokerReleaseCounts(data).slice(0, 6);
  const recentUpdates = sortByPublishDateDesc(data).slice(0, 6);

  return (
    <>
      <section className={`${CARD_CLASS} lg:col-span-7`}>
        <CardTitle title="版本更新趋势" subtitle="按月统计更新次数" />
        {trendData.length === 0 ? <EmptyState /> : <TrendLine data={trendData} />}
      </section>

      <section className={`${CARD_CLASS} lg:col-span-5`}>
        <CardTitle title="更新内容构成" subtitle="更新类型与重点功能标签" />
        {typeData.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="space-y-5">
            <DistributionBar data={typeData} />
            <div className="flex flex-wrap gap-2">
              {tagData.map((item, index) => (
                <span
                  key={item.name}
                  className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium ${
                    index < 3
                      ? "border-blue-100 bg-blue-50 text-blue-700"
                      : "border-[#E4EAF2] bg-[#F8FAFC] text-[#667085]"
                  }`}
                >
                  {item.name} <strong className="ml-1 tabular-nums">{item.count}</strong>
                </span>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className={`${CARD_CLASS} lg:col-span-5`}>
        <CardTitle title="券商更新活跃度" subtitle="当前筛选范围内更新次数排行" />
        {brokerData.length === 0 ? <EmptyState /> : <RankingList data={brokerData} />}
      </section>

      <section className={`${CARD_CLASS} lg:col-span-7`}>
        <CardTitle title="近期重点更新" subtitle="优先展示最新版本与核心更新内容" />
        {recentUpdates.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="divide-y divide-[#F0F2F5]">
            {recentUpdates.map((record, index) => (
              <button
                // A source hash is not guaranteed to be unique in imported data;
                // keep the list position as a final disambiguator for React.
                key={`${record.contentSha256 || "release"}-${record.brokerCode}-${record.appName}-${index}`}
                type="button"
                onClick={() => onSelect(record)}
                className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-3 py-3 text-left first:pt-0 last:pb-0 hover:text-[#2563EB]"
              >
                <span className="min-w-0">
                  <span className="flex min-w-0 items-center gap-2">
                    <strong className="truncate text-[13px] text-[#172033]">
                      {record.brokerName || "未知券商"} · {record.appName || "未知 App"}
                    </strong>
                    <span className="shrink-0 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-600">
                      {record.appVersion || "版本未识别"}
                    </span>
                  </span>
                  <span className="mt-1 block truncate text-xs text-[#667085]">
                    {record.highlights[0] || record.updateSummary || "暂无更新摘要"}
                  </span>
                </span>
                <span className="whitespace-nowrap text-[11px] tabular-nums text-[#98A2B3]">
                  {formatReleaseDate(record.publishDate)}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function CardTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <h3 className="text-[14px] font-bold text-[#172033]">{title}</h3>
      <span className="text-right text-[10px] text-[#98A2B3]">{subtitle}</span>
    </div>
  );
}

function TrendLine({ data }: { data: { name: string; count: number }[] }) {
  const width = 600;
  const height = 150;
  const padding = 18;
  const max = Math.max(...data.map((item) => item.count), 1);
  const denominator = Math.max(data.length - 1, 1);
  const points = data.map((item, index) => ({
    ...item,
    x: padding + (index / denominator) * (width - padding * 2),
    y: height - padding - (item.count / max) * (height - padding * 2),
  }));
  const polyline = points.map((point) => `${point.x},${point.y}`).join(" ");

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-[150px] w-full" role="img" aria-label="版本更新趋势">
        <defs>
          <linearGradient id="app-trend-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#2563EB" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#2563EB" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <line x1={padding} x2={width - padding} y1={height - padding} y2={height - padding} stroke="#E4EAF2" />
        <polygon
          points={`${padding},${height - padding} ${polyline} ${width - padding},${height - padding}`}
          fill="url(#app-trend-fill)"
        />
        <polyline points={polyline} fill="none" stroke="#2563EB" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
        {points.map((point) => (
          <g key={point.name}>
            <circle cx={point.x} cy={point.y} r="4" fill="#fff" stroke="#2563EB" strokeWidth="2.5" />
            <text x={point.x} y={Math.max(12, point.y - 10)} textAnchor="middle" fontSize="10" fill="#475467">{point.count}</text>
          </g>
        ))}
      </svg>
      <div className="flex justify-between gap-2 text-[10px] text-[#98A2B3]">
        {data.length <= 3 ? (
          data.map((item) => <span key={item.name}>{item.name}</span>)
        ) : (
          <>
            <span>{data[0].name}</span>
            <span>{data[Math.floor(data.length / 2)].name}</span>
            <span>{data[data.length - 1].name}</span>
          </>
        )}
      </div>
    </div>
  );
}

function DistributionBar({ data }: { data: { name: string; count: number }[] }) {
  const total = data.reduce((sum, item) => sum + item.count, 0);
  return (
    <div>
      <div className="flex h-3 overflow-hidden rounded-full bg-[#F0F2F5]">
        {data.map((item) => (
          <span
            key={item.name}
            style={{
              width: `${(item.count / total) * 100}%`,
              backgroundColor: UPDATE_TYPE_COLORS[item.name] || "#98A2B3",
            }}
          />
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        {data.map((item) => (
          <div key={item.name} className="flex items-center justify-between gap-2 text-xs">
            <span className="flex min-w-0 items-center gap-1.5 truncate text-[#667085]">
              <i className="size-2 shrink-0 rounded-full" style={{ backgroundColor: UPDATE_TYPE_COLORS[item.name] || "#98A2B3" }} />
              {item.name}
            </span>
            <strong className="tabular-nums text-[#172033]">{item.count}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function RankingList({ data }: { data: { name: string; count: number }[] }) {
  const max = Math.max(...data.map((item) => item.count), 1);
  return (
    <div className="space-y-3">
      {data.map((item, index) => (
        <div key={item.name} className="grid grid-cols-[20px_92px_minmax(0,1fr)_28px] items-center gap-2 text-xs">
          <span className={`font-bold ${index < 3 ? "text-[#2563EB]" : "text-[#98A2B3]"}`}>{index + 1}</span>
          <span className="truncate font-medium text-[#475467]" title={item.name}>{item.name}</span>
          <span className="h-2 overflow-hidden rounded-full bg-[#F0F2F5]">
            <i className="block h-full rounded-full bg-gradient-to-r from-[#2563EB] to-[#60A5FA]" style={{ width: `${(item.count / max) * 100}%` }} />
          </span>
          <strong className="text-right tabular-nums text-[#172033]">{item.count}</strong>
        </div>
      ))}
    </div>
  );
}

function EmptyState() {
  return <div className="flex h-32 items-center justify-center text-sm text-[#98A2B3]">暂无数据</div>;
}
