"use client";

import { Smartphone } from "lucide-react";
import type { BrokerAppGroup } from "@/lib/app-release-data";
import { formatReleaseDate, UPDATE_TYPE_COLORS } from "@/lib/app-release-data";

interface BrokerAppListProps {
  groups: BrokerAppGroup[];
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
}

export function BrokerAppList({ groups, selectedKey, onSelect }: BrokerAppListProps) {
  return (
    <div className="bg-white rounded-2xl border border-[#E4EAF2] shadow-[0_1px_3px_rgba(0,0,0,0.02)] p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[14px] font-bold text-[#172033]">券商 App 列表</h3>
        {selectedKey && (
          <button
            onClick={() => onSelect(null)}
            className="text-[11px] text-[#2563EB] hover:underline"
          >
            查看全部
          </button>
        )}
      </div>

      {groups.length === 0 ? (
        <p className="text-[13px] text-[#98A2B3] py-6 text-center">暂无 App 更新数据。</p>
      ) : (
        <div className="space-y-2 max-h-[560px] overflow-y-auto pr-1">
          {groups.map((group) => {
            const active = group.key === selectedKey;
            const typeColor = UPDATE_TYPE_COLORS[group.latest.updateType] ?? "#98A2B3";
            return (
              <button
                key={group.key}
                onClick={() => onSelect(active ? null : group.key)}
                className={`w-full text-left rounded-xl border px-3 py-2.5 transition-all ${
                  active
                    ? "border-[#2563EB] bg-[#F5F8FF]"
                    : "border-[#E4EAF2] hover:border-[#B7C6D9] hover:bg-[#FAFBFD]"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-[#EEF3FB] text-[#2563EB]">
                      <Smartphone className="w-3.5 h-3.5" />
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-semibold text-[#172033]">
                        {group.appName}
                      </div>
                      <div className="truncate text-[11px] text-[#667085]">
                        {group.brokerName}
                      </div>
                    </div>
                  </div>
                  <span className="shrink-0 rounded-full bg-[#F0F2F5] px-2 py-0.5 text-[11px] font-medium text-[#667085]">
                    {group.count} 条
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between gap-2 text-[11px]">
                  <span className="inline-flex items-center gap-1 text-[#667085]">
                    <span
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ backgroundColor: typeColor }}
                    />
                    最新 {group.latest.appVersion || "版本未识别"}
                  </span>
                  <span className="text-[#98A2B3]">
                    {formatReleaseDate(group.latest.publishDate)}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
