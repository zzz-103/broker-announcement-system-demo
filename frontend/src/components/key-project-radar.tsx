"use client";

import { useMemo } from "react";
import type { ProcessedRecord } from "@/lib/announcement-data";
import {
  scoreProject,
  getScoreReason,
  displayAmountLabel,
  formatDate,
  formatAmount,
} from "@/lib/announcement-data";

interface KeyProjectRadarProps {
  data: ProcessedRecord[];
  baseline: Date | null;
  onSelectProject: (r: ProcessedRecord) => void;
}

export function KeyProjectRadar({
  data,
  baseline,
  onSelectProject,
}: KeyProjectRadarProps) {
  const projects = useMemo(() => {
    const updateTime = (record: ProcessedRecord) => {
      const processed = new Date(record.processed_at).getTime();
      return Number.isFinite(processed)
        ? processed
        : record.validPublishDate?.getTime() ?? 0;
    };
    const latestByProject = new Map<string, ProcessedRecord>();
    for (const record of data) {
      const current = latestByProject.get(record.projectKey);
      if (!current || updateTime(record) > updateTime(current)) {
        latestByProject.set(record.projectKey, record);
      }
    }

    return [...latestByProject.values()]
      .map((r) => ({
        record: r,
        score: scoreProject(r, baseline),
        reason: getScoreReason(r),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 6)
      .sort((a, b) => {
        const updateDiff = updateTime(b.record) - updateTime(a.record);
        if (updateDiff !== 0) return updateDiff;
        return (
          (b.record.validPublishDate?.getTime() ?? 0) -
          (a.record.validPublishDate?.getTime() ?? 0)
        );
      });
  }, [data, baseline]);

  const getAccentColor = (stage: string, domain: string) => {
    if (domain === "交易、柜台与核心系统") return "#D64545"; // Red
    if (stage === "采购招标") return "#2563EB"; // Blue
    if (stage === "结果公示") return "#16A36A"; // Green
    return "#CBD5E1"; // Gray default
  };

  return (
    <section className="rounded-xl border border-[#E4EAF2] bg-white p-4 shadow-[0_1px_2px_rgba(16,40,71,0.03)] sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-[15px] font-bold text-[#172033]">
        重点项目雷达
        </h3>
        <span className="text-[11px] text-[#7A8699]">按近期变化和金额优先</span>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {projects.map(({ record: r, reason }) => (
          <button
            type="button"
            key={r.projectKey}
            onClick={() => onSelectProject(r)}
            className="relative flex min-h-[168px] cursor-pointer flex-col justify-between overflow-hidden rounded-lg border border-[#E4EAF2] bg-white py-3 pl-4 pr-3 text-left transition-colors hover:border-[#B9D0F5] hover:bg-[#FBFCFE] motion-reduce:transition-none"
          >
            {/* Left accent strip */}
            <div 
              className="absolute left-0 top-0 bottom-0 w-[4px]"
              style={{ backgroundColor: getAccentColor(r.announcement_stage, r.primaryDomain) }}
            />

            {/* Upper Section */}
            <div className="w-full">
              <div className="mb-1.5 flex items-center gap-2">
                  <span
                  className="size-1.5 shrink-0 rounded-full bg-[#7A9BCB]"
                  />
                <span className="truncate text-[11px] font-medium text-[#667085]">
                  {r.primaryDomain}
                </span>
              </div>
              <div className="mb-1.5 flex h-[36px] items-start text-[13px] font-bold leading-relaxed text-[#172033] line-clamp-2">
                {r.normalizedProjectName}
              </div>
              <div className="mb-2 flex h-[18px] flex-wrap gap-1 overflow-hidden">
                {r.topicTags.slice(0, 3).map((tag) => (
                  <span
                    key={tag}
                    className="flex items-center rounded bg-[#F0F2F5] px-1.5 py-0.5 text-[10px] leading-none text-[#667085]"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>

            {/* Lower Section (with top border for alignment visualization) */}
            <div className="mt-auto w-full border-t border-[#F0F2F5] pt-2">
              <div className="flex h-[16px] items-center justify-between text-[11px] text-[#7A8699]">
                <span className="max-w-[65%] truncate pr-2 font-medium text-[#718096]">{r.validBrokerName}</span>
                <span className="tabular-nums shrink-0">{formatDate(r.validPublishDate)}</span>
              </div>
              <div className="mt-1.5 flex h-[16px] items-center justify-between text-[11px]">
                {r.normalizedSupplier ? (
                  <span className="text-[#667085] truncate max-w-[65%] font-medium">
                    供应商: <span className="text-[#172033] font-semibold">{r.normalizedSupplier}</span>
                  </span>
                ) : (
                  <span className="text-[#98A2B3] italic font-normal">招标阶段</span>
                )}
                {r.display_amount_yuan !== null ? (
                  <span className={`${r.display_amount_kind === "winning" ? "text-[#0F9F8F]" : "text-[#2563EB]"} font-bold tabular-nums text-[12px] shrink-0`}>
                    <span className="mr-1 text-[10px] font-medium">{displayAmountLabel(r)}</span>
                    {formatAmount(r.display_amount_yuan)}
                  </span>
                ) : (
                  <span className="shrink-0 w-4 h-4" />
                )}
              </div>
              <div className="mt-1.5 h-[14px] text-[10px] font-medium leading-tight text-[#B7791F] line-clamp-1">
                {reason}
              </div>
            </div>
          </button>
        ))}
      </div>
      {projects.length === 0 && (
        <p className="text-[12px] text-[#98A2B3] py-8 text-center">
          暂无重点项目
        </p>
      )}
    </section>
  );
}
