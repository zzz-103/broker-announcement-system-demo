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
    <div
      className="sticky top-[68px] z-30 -mx-3 overflow-x-auto border-b border-[#E4EAF2] bg-[#F4F7FB]/95 px-3 py-1.5 backdrop-blur-sm sm:-mx-8 sm:px-8"
      role="tablist"
      aria-label="情报助手内容"
    >
      <div className="flex min-w-full w-max items-center gap-1.5">
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
            className={`inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border px-3.5 text-[13px] font-semibold transition-colors motion-reduce:transition-none ${selected ? "border-[#D7E5FF] bg-white text-[#2563EB]" : "border-transparent text-[#667085] hover:bg-white/75 hover:text-[#344054]"}`}
          >
            <Icon className="size-4" aria-hidden="true" />
            {label}
            {tab === "history" && executionCount > 0 && (
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${selected ? "bg-[#EAF2FF] text-[#2563EB]" : "bg-[#E8EDF3] text-[#667085]"}`} aria-label={`${executionCount} 条记录`}>
                {executionCount}
              </span>
            )}
          </button>
        );
      })}
      </div>
    </div>
  );
}
