"use client";

import { useMemo } from "react";
import { ChevronRight } from "lucide-react";
import type { ProcessedRecord } from "@/lib/announcement-data";
import {
  scoreProject,
  getScoreReason,
  displayAmountLabel,
  formatDate,
  formatAmountInWan,
} from "@/lib/announcement-data";

interface KeyProjectRadarProps {
  data: ProcessedRecord[];
  baseline: Date | null;
  onSelectProject: (r: ProcessedRecord) => void;
}

// 后端兜底文案：未命中任何具体关注点时使用，列表中不再重复展示。
const GENERIC_REASON = "公开招采动态值得关注";

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

  return (
    <section className="surface-panel p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[15px] font-bold text-[#172033]">重点项目</h3>
        <span className="text-[11px] text-[#7A8699]">按近期动态排序</span>
      </div>

      {projects.length === 0 ? (
        <p className="py-8 text-center text-[12px] text-[#98A2B3]">
          暂无符合条件的重点项目
        </p>
      ) : (
        <ol className="divide-y divide-[#EEF2F6]">
          {projects.map(({ record, reason }, index) => (
            <KeyProjectRow
              key={record.projectKey}
              record={record}
              reason={reason}
              rank={index + 1}
              onSelect={() => onSelectProject(record)}
            />
          ))}
        </ol>
      )}
    </section>
  );
}

interface KeyProjectRowProps {
  record: ProcessedRecord;
  reason: string;
  rank: number;
  onSelect: () => void;
}

function KeyProjectRow({
  record: r,
  reason,
  rank,
  onSelect,
}: KeyProjectRowProps) {
  // 第二层：券商 · 业务方向 · 公告日期
  const meta = [r.validBrokerName, r.primaryDomain, formatDate(r.validPublishDate)]
    .filter(Boolean)
    .join(" · ");

  // 第三层：阶段 / 金额 / 供应商 / 关注点，按数据实际存在组合，最多一行
  const supplementParts: string[] = [];
  if (r.announcement_stage && r.announcement_stage !== "其他") {
    supplementParts.push(r.announcement_stage);
  }
  if (r.display_amount_yuan !== null) {
    supplementParts.push(`${displayAmountLabel(r)} ${formatAmountInWan(r.display_amount_yuan)}`);
  }
  if (r.normalizedSupplier) {
    supplementParts.push(`供应商：${r.normalizedSupplier}`);
  }
  if (reason && reason !== GENERIC_REASON) {
    supplementParts.push(`关注点：${reason}`);
  }
  const supplement = supplementParts.join(" · ");

  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-label={`查看项目详情：${r.normalizedProjectName}`}
        className="group grid w-full grid-cols-[28px_minmax(0,1fr)_auto] items-start gap-x-3 rounded-md px-2 py-3 text-left transition-colors duration-150 motion-reduce:transition-none hover:bg-blue-50/40 focus-visible:bg-blue-50/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/25"
      >
        {/* 序号 */}
        <span className="pt-0.5 text-[13px] font-bold tabular-nums text-[#98A2B3]">
          {String(rank).padStart(2, "0")}
        </span>

        {/* 主体信息 */}
        <span className="min-w-0">
          <span
            className="block line-clamp-2 text-[13.5px] font-bold leading-relaxed text-[#172033]"
            title={r.normalizedProjectName}
          >
            {r.normalizedProjectName}
          </span>
          <span className="mt-1 block truncate text-[11px] text-[#7A8699]" title={meta}>
            {meta}
          </span>
          {supplement && (
            <span className="mt-1 block truncate text-[11px] text-[#667085]" title={supplement}>
              {supplement}
            </span>
          )}
        </span>

        {/* 详情入口 */}
        <span className="inline-flex shrink-0 items-center gap-0.5 pt-0.5 text-[11px] font-semibold text-[#2563EB]">
          查看
          <ChevronRight className="size-3.5" aria-hidden="true" />
        </span>
      </button>
    </li>
  );
}
