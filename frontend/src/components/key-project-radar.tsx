"use client";

import { useMemo } from "react";
import type { ProcessedRecord } from "@/lib/announcement-data";
import {
  getDataBaseline,
  scoreProject,
  getScoreReason,
  formatDate,
  formatAmount,
} from "@/lib/announcement-data";

interface KeyProjectRadarProps {
  data: ProcessedRecord[];
  allData: ProcessedRecord[];
  onSelectProject: (r: ProcessedRecord) => void;
}

const DOMAIN_COLORS: Record<string, string> = {
  "AI与智能化": "#2563EB",
  "数据治理与数据平台": "#0F9F8F",
  "财富管理与客户经营": "#F59E0B",
  "交易、柜台与核心系统": "#D64545",
  "APP与数字化渠道": "#8B5CF6",
  "网络安全与监管科技": "#EC4899",
  "云计算、算力与基础设施": "#06B6D4",
  "IT运维与技术服务": "#667085",
  "投研资讯与金融数据": "#84CC16",
  "非金融科技及其他": "#98A2B3",
};

export function KeyProjectRadar({
  data,
  allData,
  onSelectProject,
}: KeyProjectRadarProps) {
  const baseline = useMemo(() => getDataBaseline(allData), [allData]);

  const projects = useMemo(() => {
    // Deduplicate by projectKey
    const seen = new Set<string>();
    const unique = data.filter((r) => {
      if (seen.has(r.projectKey)) return false;
      seen.add(r.projectKey);
      return true;
    });

    return unique
      .map((r) => ({
        record: r,
        score: scoreProject(r, baseline),
        reason: getScoreReason(r),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);
  }, [data, baseline]);

  const getAccentColor = (stage: string, domain: string) => {
    if (domain === "交易、柜台与核心系统") return "#D64545"; // Red
    if (stage === "采购招标") return "#2563EB"; // Blue
    if (stage === "结果公示") return "#16A36A"; // Green
    return "#CBD5E1"; // Gray default
  };

  return (
    <div className="bg-white rounded-2xl border border-[#E4EAF2] shadow-[0_1px_3px_rgba(0,0,0,0.02)] p-5">
      <h3 className="text-[15px] font-bold text-[#172033] mb-4">
        重点项目雷达
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {projects.map(({ record: r, reason }) => (
          <button
            key={r.projectKey}
            onClick={() => onSelectProject(r)}
            className="relative overflow-hidden text-left border border-[#E4EAF2] rounded-xl pl-5 pr-4 py-4 hover:border-blue-500/35 hover:shadow-[0_4px_12px_rgba(37,99,235,0.05)] transition-all duration-200 motion-reduce:transition-none motion-reduce:transform-none cursor-pointer bg-white"
          >
            {/* Left accent strip */}
            <div 
              className="absolute left-0 top-0 bottom-0 w-[4px]"
              style={{ backgroundColor: getAccentColor(r.announcement_stage, r.primaryDomain) }}
            />

            <div className="flex items-center gap-2 mb-2">
              <span
                className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{
                  backgroundColor:
                    DOMAIN_COLORS[r.primaryDomain] || "#98A2B3",
                }}
              />
              <span className="text-[11px] text-[#667085] truncate font-medium">
                {r.primaryDomain}
              </span>
            </div>
            <div className="text-[13px] text-[#172033] font-bold line-clamp-2 leading-relaxed mb-2">
              {r.normalizedProjectName}
            </div>
            <div className="flex flex-wrap gap-1 mb-3">
              {r.topicTags.slice(0, 3).map((tag) => (
                <span
                  key={tag}
                  className="text-[10px] px-1.5 py-0.5 rounded-md bg-[#F0F2F5] text-[#667085]"
                >
                  {tag}
                </span>
              ))}
            </div>
            <div className="flex items-center justify-between text-[11px] text-[#98A2B3]">
              <span className="font-medium text-[#718096]">{r.validBrokerName}</span>
              <span className="tabular-nums">{formatDate(r.validPublishDate)}</span>
            </div>
            {r.normalizedSupplier && (
              <div className="text-[11px] text-[#667085] mt-1.5 truncate font-medium">
                供应商: <span className="text-[#172033]">{r.normalizedSupplier}</span>
              </div>
            )}
            {r.winning_amount_yuan !== null && (
              <div className="text-[12px] text-[#0F9F8F] font-bold mt-1.5 tabular-nums">
                {formatAmount(r.winning_amount_yuan)}
              </div>
            )}
            <div className="text-[10px] text-[#F59E0B] mt-2.5 font-medium">{reason}</div>
          </button>
        ))}
      </div>
      {projects.length === 0 && (
        <p className="text-[12px] text-[#98A2B3] py-8 text-center">
          暂无重点项目
        </p>
      )}
    </div>
  );
}
