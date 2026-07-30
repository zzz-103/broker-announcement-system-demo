"use client";

import { useMemo, useState } from "react";
import { Info } from "lucide-react";
import type { DashboardStatistics, ProcessedRecord } from "@/lib/announcement-data";
import { uniqueCount } from "@/lib/announcement-data";
import { useFilterStore } from "@/store/filter-store";

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
  color: string;
  onClick?: () => void;
}

function formatUpdatedAt(value: string | null): string {
  if (!value) return "更新时间待确认";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "更新时间待确认";
  return `更新于 ${date.toLocaleDateString("zh-CN")}`;
}

export function MetricCards({ data, baseline, statistics, updatedAt }: MetricCardsProps) {
  const { setDetailFilter } = useFilterStore();
  const [showBrokerDetails, setShowBrokerDetails] = useState(false);
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
    const supplierProjects = uniqueCount(
      data
        .filter((record) => record.announcement_stage === "结果公示" && record.normalizedSupplier !== "")
        .map((record) => record.projectKey)
    );
    const amountSamples = uniqueCount(
      data.filter((record) => record.amountSampleKey !== null).map((record) => record.amountSampleKey!)
    );

    const sourceMetric = {
        label: "已接入数据源",
        value: `${statistics.sourceCount.toLocaleString()} 个`,
        hint: `${statistics.sources.join("、")} · 持续增量更新 · ${formatUpdatedAt(updatedAt)}`,
        color: "#0F9F8F",
      };
    return [
      ...(statistics.sourceCount > 1 ? [sourceMetric] : []),
      {
        label: "公告结构化记录",
        value: totalRecords.toLocaleString(),
        hint: "当前筛选后的CSV行数",
        color: "#64748B",
      },
      {
        label: "去重项目线索",
        value: uniqueProjects.toLocaleString(),
        hint: "按主体+标准化项目名去重",
        color: "#6366F1",
      },
      {
        label: "近30日新增线索",
        value: recentProjects.toLocaleString(),
        hint: "以数据最新日期为基准",
        color: "#7C3AED",
      },
      {
        label: "结果公示项目",
        value: resultProjects.toLocaleString(),
        hint: "公告阶段为结果公示的去重线索",
        color: "#0F9F8F",
      },
      {
        label: "披露供应商项目",
        value: supplierProjects.toLocaleString(),
        hint: "结果公示且供应商非空的去重线索",
        color: "#16A36A",
      },
      {
        label: "公开金额样本",
        value: amountSamples.toLocaleString(),
        hint: "成交金额或项目预算，按金额去重",
        onClick: () => setDetailFilter({ hasPrice: "true" }),
        color: "#F59E0B",
      },
    ];
  }, [data, baseline, setDetailFilter, statistics.sourceCount, statistics.sources, updatedAt]);

  return (
    <div className={`grid grid-cols-1 min-[420px]:grid-cols-2 md:grid-cols-4 ${statistics.sourceCount > 1 ? "xl:grid-cols-8" : "xl:grid-cols-7"} gap-3.5 sm:gap-4`}>
      <div className="relative flex min-h-[116px] flex-col justify-between rounded-xl border border-[#B8CCF8] bg-[linear-gradient(180deg,#FFFFFF_0%,#F6F9FF_100%)] p-4 shadow-[0_4px_14px_rgba(37,99,235,0.08)] transition-[box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:shadow-[0_8px_20px_rgba(37,99,235,0.13)] motion-reduce:transform-none md:h-[108px] md:min-h-0">
        <div className="absolute top-0 left-0 right-0 h-1 bg-[#2563EB] rounded-t-xl" />
        <div className="text-[12px] font-medium leading-none text-[#2563EB] whitespace-nowrap">活跃券商覆盖</div>
        <div className="text-[29px] sm:text-[31px] font-bold text-[#172033] tabular-nums leading-none mt-1 py-1 flex-grow flex items-center">
          {statistics.brokerCount.toLocaleString()} 家
        </div>
        <button
          type="button"
          aria-expanded={showBrokerDetails}
          aria-controls="broker-coverage-details"
          onClick={() => setShowBrokerDetails((open) => !open)}
          className="inline-flex items-center gap-1 self-start text-[11px] leading-none text-[#667085] hover:text-[#2563EB] transition-colors"
        >
          <Info className="h-3.5 w-3.5" />
          查看统计说明
        </button>
        {showBrokerDetails && (
          <div id="broker-coverage-details" className="absolute left-0 top-[calc(100%+8px)] z-30 w-[min(320px,calc(100vw-2rem))] rounded-xl border border-[#D9E2EC] bg-white p-3.5 text-[12px] text-[#475467] shadow-[0_12px_28px_rgba(15,32,56,0.16)]">
            <div className="grid grid-cols-3 gap-2 text-center">
              <p><span className="block font-bold text-[#172033]">{statistics.brokerActivity.high} 家</span>高活跃</p>
              <p><span className="block font-bold text-[#172033]">{statistics.brokerActivity.medium} 家</span>中活跃</p>
              <p><span className="block font-bold text-[#172033]">{statistics.brokerActivity.low} 家</span>低活跃</p>
            </div>
            <div className="mt-3 border-t border-[#EEF2F6] pt-3">
              <p className="font-semibold text-[#172033]">为什么没有覆盖全部持牌券商？</p>
              <p className="mt-1 leading-relaxed">本平台仅统计在当前已接入公开来源中检索到采购披露记录的证券公司。部分机构可能采用内部采购系统、集团统一采购、框架协议或线下邀标等方式，未在公开渠道披露，因此不会计入当前覆盖数量。</p>
            </div>
          </div>
        )}
      </div>

      {metrics.map((metric) => {
        const content = (
          <>
            <div className="absolute top-0 left-0 right-0 h-[3px] pointer-events-none" style={{ backgroundColor: metric.color }} />
            <div className="text-[12px] font-medium leading-none text-[#718096]">{metric.label}</div>
            <div className="text-[26px] sm:text-[28px] font-bold text-[#172033] tabular-nums leading-none mt-1 py-1 flex-grow flex items-center">{metric.value}</div>
            <div className="text-[11px] leading-relaxed text-[#98A2B3] md:truncate" title={metric.hint}>{metric.hint}</div>
          </>
        );
        const className = "relative flex min-h-[116px] flex-col justify-between overflow-hidden rounded-xl border border-[#E4EAF2] bg-white p-4 text-left shadow-[0_1px_3px_rgba(0,0,0,0.02)] transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-blue-200/80 hover:shadow-[0_8px_20px_rgba(16,40,71,0.08)] motion-reduce:transform-none md:h-[108px] md:min-h-0";
        return metric.onClick ? (
          <button key={metric.label} onClick={metric.onClick} className={`${className} cursor-pointer transition-all duration-200 hover:border-blue-500/35 hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(37,99,235,0.05)]`}>
            {content}
          </button>
        ) : <div key={metric.label} className={className}>{content}</div>;
      })}
    </div>
  );
}
