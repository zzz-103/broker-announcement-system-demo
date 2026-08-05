"use client";

interface ProcurementTabsProps {
  activeTab: "ai" | "overview" | "table";
  setActiveTab: (tab: "ai" | "overview" | "table") => void;
  filteredCount: number;
  headerHeight: number;
}

/** Procurement-specific tabs keep the business language distinct from the AI label. */
export function ProcurementTabs({
  activeTab,
  setActiveTab,
  filteredCount,
  headerHeight,
}: ProcurementTabsProps) {
  const tabClass = (tab: ProcurementTabsProps["activeTab"]) =>
    `inline-flex h-9 shrink-0 items-center rounded-md px-3.5 text-[13px] font-semibold whitespace-nowrap transition-colors motion-reduce:transition-none ${
      activeTab === tab
        ? "border border-[#D7E5FF] bg-white text-[#2563EB] shadow-[0_1px_2px_rgba(16,40,71,0.08)]"
        : "border border-transparent text-[#667085] hover:bg-white/75 hover:text-[#344054]"
    }`;

  return (
    <nav
      className="sticky z-30 -mx-3 overflow-x-auto border-b border-[#E4EAF2] bg-[#F4F7FB]/95 px-3 py-1.5 backdrop-blur-sm sm:-mx-8 sm:px-8"
      style={{ top: `${headerHeight}px` }}
      aria-label="招采情报视图"
    >
      <div className="flex min-w-full w-max items-center gap-1.5" role="tablist">
        <button type="button" id="procurement-tab-ai" role="tab" aria-selected={activeTab === "ai"} aria-controls="procurement-panel-ai" tabIndex={activeTab === "ai" ? 0 : -1} onClick={() => setActiveTab("ai")} onKeyDown={(event) => handleTabKey(event, "ai", setActiveTab)} className={tabClass("ai")}>
          分析报告
        </button>
        <button type="button" id="procurement-tab-overview" role="tab" aria-selected={activeTab === "overview"} aria-controls="procurement-panel-overview" tabIndex={activeTab === "overview" ? 0 : -1} onClick={() => setActiveTab("overview")} onKeyDown={(event) => handleTabKey(event, "overview", setActiveTab)} className={tabClass("overview")}>
          情报总览
        </button>
        <button type="button" id="procurement-tab-table" role="tab" aria-selected={activeTab === "table"} aria-controls="procurement-panel-table" tabIndex={activeTab === "table" ? 0 : -1} onClick={() => setActiveTab("table")} onKeyDown={(event) => handleTabKey(event, "table", setActiveTab)} className={`${tabClass("table")} gap-1.5`}>
          项目明细
          <span
            className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
              activeTab === "table" ? "bg-[#EAF2FF] text-[#2563EB]" : "bg-[#E8EDF3] text-[#667085]"
            }`}
          >
            {filteredCount.toLocaleString("zh-CN")}
          </span>
        </button>
      </div>
    </nav>
  );
}

function handleTabKey(
  event: React.KeyboardEvent<HTMLButtonElement>,
  current: ProcurementTabsProps["activeTab"],
  onChange: ProcurementTabsProps["setActiveTab"],
) {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  event.preventDefault();
  const tabs: ProcurementTabsProps["activeTab"][] = ["ai", "overview", "table"];
  const index = tabs.indexOf(current);
  const next = tabs[(index + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
  onChange(next);
  requestAnimationFrame(() => document.getElementById(`procurement-tab-${next}`)?.focus());
}
