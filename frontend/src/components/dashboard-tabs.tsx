"use client";

import React from "react";

interface DashboardTabsProps {
  activeTab: "ai" | "overview" | "table";
  setActiveTab: (tab: "ai" | "overview" | "table") => void;
  filteredCount: number;
  headerHeight: number;
  tabContainerRef: React.RefObject<HTMLDivElement | null>;
  aiTabRef: React.RefObject<HTMLButtonElement | null>;
  overviewTabRef: React.RefObject<HTMLButtonElement | null>;
  tableTabRef: React.RefObject<HTMLButtonElement | null>;
  indicatorPos: { left: string; width: string };
}

export function DashboardTabs({
  activeTab,
  setActiveTab,
  filteredCount,
  headerHeight,
  tabContainerRef,
  aiTabRef,
  overviewTabRef,
  tableTabRef,
  indicatorPos,
}: DashboardTabsProps) {
  return (
    <div
      className="sticky z-30 bg-[#F4F7FB] -mx-3 sm:-mx-8 px-3 sm:px-8 py-2 border-b border-[#E4EAF2]"
      style={{ top: `${headerHeight}px` }}
    >
      <div className="relative flex items-center gap-1.5" ref={tabContainerRef}>
        {/* Liquid Glass Indicator with animated background */}
        <div
          className="absolute top-1/2 -translate-y-1/2 pointer-events-none transition-all duration-300 ease-[cubic-bezier(0.25,1,0.3,1)] motion-reduce:transition-none"
          style={{
            left: indicatorPos.left,
            width: indicatorPos.width,
            height: "36px",
          }}
        >
          <div className="absolute inset-0 rounded-lg bg-[#102847] shadow-[0_4px_16px_rgba(16,40,71,0.18)]" />
          {/* Subtle bottom highlighted purple-blue bar */}
          <div className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-gradient-to-r from-blue-500 via-purple-500 to-teal-400" />
        </div>

        <button
          ref={aiTabRef}
          onClick={() => setActiveTab("ai")}
          className={`
            relative z-10 px-5 py-2 text-[14px] font-semibold rounded-lg transition-colors duration-200
            ${activeTab === "ai" ? "text-white" : "text-[#4A5568] hover:text-[#172033] hover:bg-slate-200/40"}
          `}
        >
          智能洞察
        </button>
        <button
          ref={overviewTabRef}
          onClick={() => setActiveTab("overview")}
          className={`
            relative z-10 px-5 py-2 text-[14px] font-semibold rounded-lg transition-colors duration-200
            ${activeTab === "overview" ? "text-white" : "text-[#4A5568] hover:text-[#172033] hover:bg-slate-200/40"}
          `}
        >
          情报总览
        </button>
        <button
          ref={tableTabRef}
          onClick={() => setActiveTab("table")}
          className={`
            relative z-10 px-5 py-2 text-[14px] font-semibold rounded-lg transition-colors duration-200 flex items-center gap-1.5
            ${activeTab === "table" ? "text-white" : "text-[#4A5568] hover:text-[#172033] hover:bg-slate-200/40"}
          `}
        >
          <span>项目明细</span>
          <span
            className={`text-[11px] px-1.5 py-0.5 rounded-full font-medium transition-colors ${
              activeTab === "table" ? "bg-white/15 text-white/90" : "bg-slate-200/60 text-[#4A5568]"
            }`}
          >
            {filteredCount}
          </span>
        </button>
      </div>
    </div>
  );
}
