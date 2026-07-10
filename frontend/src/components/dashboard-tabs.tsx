"use client";

interface DashboardTabsProps {
  activeTab: "ai" | "overview" | "table";
  setActiveTab: (tab: "ai" | "overview" | "table") => void;
  filteredCount: number;
  headerHeight: number;
}

export function DashboardTabs({ activeTab, setActiveTab, filteredCount, headerHeight }: DashboardTabsProps) {
  const tabClass = (tab: "ai" | "overview" | "table") => `
    inline-flex h-9 items-center rounded-lg px-3.5 text-[14px] font-semibold transition-all duration-200 motion-reduce:transition-none
    ${activeTab === tab
      ? "border border-[#D7E5FF] bg-white text-[#2563EB] shadow-[0_1px_3px_rgba(16,40,71,0.08)]"
      : "border border-transparent text-[#667085] hover:bg-white/75 hover:text-[#344054]"
    }
  `;

  return (
    <div
      className="sticky z-30 -mx-3 border-b border-[#E4EAF2] bg-[#F4F7FB]/95 px-3 py-2 backdrop-blur-sm sm:-mx-8 sm:px-8"
      style={{ top: `${headerHeight}px` }}
    >
      <div className="flex items-center gap-1.5" aria-label="看板内容切换">
        <button type="button" onClick={() => setActiveTab("ai")} className={tabClass("ai")}>
          智能洞察
        </button>
        <button type="button" onClick={() => setActiveTab("overview")} className={tabClass("overview")}>
          情报总览
        </button>
        <button type="button" onClick={() => setActiveTab("table")} className={`${tabClass("table")} gap-1.5`}>
          <span>项目明细</span>
          <span className={`rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${activeTab === "table" ? "bg-[#EAF2FF] text-[#2563EB]" : "bg-[#E8EDF3] text-[#667085]"}`}>
            {filteredCount}
          </span>
        </button>
      </div>
    </div>
  );
}
