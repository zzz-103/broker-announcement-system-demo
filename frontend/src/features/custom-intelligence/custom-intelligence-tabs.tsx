"use client";

import { Bookmark, Clock3, Sparkles } from "lucide-react";
import type { CustomIntelligenceTab } from "./custom-intelligence-types";

interface CustomIntelligenceTabsProps {
  activeTab: CustomIntelligenceTab;
  executionCount: number;
  onChange: (tab: CustomIntelligenceTab) => void;
}

const TABS: readonly [CustomIntelligenceTab, string, typeof Sparkles][] = [
  ["generate", "生成报告", Sparkles],
  ["assistants", "我的助手", Bookmark],
  ["history", "历史报告", Clock3],
];

export function CustomIntelligenceTabs({ activeTab, executionCount, onChange }: CustomIntelligenceTabsProps) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-[#E4EAF2]" role="tablist" aria-label="情报助手内容">
      {TABS.map(([tab, label, Icon]) => {
        const selected = activeTab === tab;
        return (
          <button
            key={tab}
            id={`custom-intelligence-tab-${tab}`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={`custom-intelligence-panel-${tab}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab)}
            onKeyDown={(event) => {
              if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
              event.preventDefault();
              const index = TABS.findIndex(([key]) => key === tab);
              const nextIndex = event.key === "ArrowRight" ? (index + 1) % TABS.length : (index - 1 + TABS.length) % TABS.length;
              onChange(TABS[nextIndex][0]);
              document.getElementById(`custom-intelligence-tab-${TABS[nextIndex][0]}`)?.focus();
            }}
            className={`inline-flex shrink-0 items-center gap-1.5 border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors motion-reduce:transition-none ${selected ? "border-[#3568C8] text-[#2455AC]" : "border-transparent text-[#667085] hover:text-[#344054]"}`}
          >
            <Icon className="size-4" aria-hidden="true" />
            {label}
            {tab === "history" && executionCount > 0 && (
              <span className="rounded bg-[#EEF4FF] px-1.5 text-[10px] text-[#315EA8]" aria-label={`${executionCount} 条记录`}>
                {executionCount}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
