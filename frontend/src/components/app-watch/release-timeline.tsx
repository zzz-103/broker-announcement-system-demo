"use client";

import type { AppReleaseRecord } from "@/lib/app-release-data";
import { formatReleaseDate, UPDATE_TYPE_COLORS } from "@/lib/app-release-data";

interface ReleaseTimelineProps {
  title: string;
  releases: AppReleaseRecord[];
  onSelect: (record: AppReleaseRecord) => void;
}

export function ReleaseTimeline({ title, releases, onSelect }: ReleaseTimelineProps) {
  return (
    <div className="bg-white rounded-2xl border border-[#E4EAF2] shadow-[0_1px_3px_rgba(0,0,0,0.02)] p-4">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h3 className="text-[14px] font-bold text-[#172033]">{title}</h3>
        <span className="text-[11px] text-[#98A2B3]">{releases.length} 条更新</span>
      </div>

      {releases.length === 0 ? (
        <p className="text-[13px] text-[#98A2B3] py-6 text-center">暂无版本更新记录。</p>
      ) : (
        <ol className="relative border-l border-[#E4EAF2] pl-5 space-y-4 max-h-[560px] overflow-y-auto">
          {releases.map((record, index) => {
            const typeColor = UPDATE_TYPE_COLORS[record.updateType] ?? "#98A2B3";
            return (
              <li key={`${record.contentSha256}-${index}`} className="relative">
                <span
                  className="absolute -left-[26px] top-1 flex size-3 items-center justify-center rounded-full ring-4 ring-white"
                  style={{ backgroundColor: typeColor }}
                />
                <button
                  onClick={() => onSelect(record)}
                  className="w-full text-left rounded-xl border border-[#E4EAF2] px-3 py-2.5 hover:border-[#B7C6D9] hover:bg-[#FAFBFD] transition-all"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[13px] font-semibold text-[#172033]">
                        {record.appVersion || "版本未识别"}
                      </span>
                      <span
                        className="text-[10px] font-medium px-1.5 py-0.5 rounded-full text-white"
                        style={{ backgroundColor: typeColor }}
                      >
                        {record.updateType}
                      </span>
                      {record.platform && record.platform !== "未知" && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#F0F2F5] text-[#667085]">
                          {record.platform}
                        </span>
                      )}
                    </div>
                    <span className="shrink-0 text-[11px] text-[#98A2B3]">
                      {formatReleaseDate(record.publishDate)}
                    </span>
                  </div>
                  <p className="mt-1.5 text-[12px] text-[#667085] line-clamp-2">
                    {record.updateSummary || "暂无摘要"}
                  </p>
                  {record.featureTags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {record.featureTags.slice(0, 5).map((tag) => (
                        <span
                          key={tag}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-[#EEF3FB] text-[#2563EB]"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
