"use client";

import { Bookmark, Clock3, Search } from "lucide-react";
import { formatCount } from "@/lib/display";
import type { CustomIntelligenceTab } from "./custom-intelligence-types";

interface CustomIntelligenceTabsProps {
  activeTab: CustomIntelligenceTab;
  executionCount: number;
  onChange: (tab: CustomIntelligenceTab) => void;
}

export function CustomIntelligenceTabs({
  activeTab,
  executionCount,
  onChange,
}: CustomIntelligenceTabsProps) {
  const tabs = [
    ["instant", "即时搜索", Search],
    ["topics", "已保存配置", Bookmark],
    ["executions", "执行记录", Clock3],
  ] as const;

  return (
    <div className="flex gap-1 overflow-x-auto border-b border-[#E4EAF2]" role="tablist" aria-label="自定义情报内容">
      {tabs.map(([tab, label, Icon]) => {
        const selected = activeTab === tab;
        const panelId = `custom-intelligence-panel-${tab}`;
        return (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={panelId}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab)}
            onKeyDown={(event) => {
              if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
              event.preventDefault();
              const index = tabs.findIndex(([key]) => key === tab);
              const nextIndex = event.key === "ArrowRight"
                ? (index + 1) % tabs.length
                : (index - 1 + tabs.length) % tabs.length;
              onChange(tabs[nextIndex][0]);
              document.getElementById(`custom-intelligence-tab-${tabs[nextIndex][0]}`)?.focus();
            }}
            id={`custom-intelligence-tab-${tab}`}
            className={`inline-flex shrink-0 items-center gap-1.5 border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors motion-reduce:transition-none ${selected ? "border-[#3568C8] text-[#2455AC]" : "border-transparent text-[#667085] hover:text-[#344054]"}`}
          >
            <Icon className="size-4" aria-hidden="true" />
            {label}
            {tab === "executions" && executionCount > 0 && (
              <span className="rounded bg-[#EEF4FF] px-1.5 text-[10px] text-[#315EA8]" aria-label={`${formatCount(executionCount)} 条记录`}>
                {formatCount(executionCount)}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
