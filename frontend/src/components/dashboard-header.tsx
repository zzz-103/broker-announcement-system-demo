"use client";

import { useRef } from "react";
import { Download, Settings, LogOut, Sparkles, ArrowLeft, HelpCircle } from "lucide-react";
import type { ProcessedRecord } from "@/lib/announcement-data";
import { formatDate } from "@/lib/announcement-data";

interface DashboardHeaderProps {
  username: string;
  totalBrokers: number;
  baseline: Date | null;
  filteredData: ProcessedRecord[];
  isAdmin: boolean;
  showDashboard: boolean;
  onShowModal: () => void;
  onExport: () => void;
  onShowDashboard: (show: boolean) => void;
  onLogout: () => void;
}

export function DashboardHeader({
  username,
  totalBrokers,
  baseline,
  filteredData,
  isAdmin,
  showDashboard,
  onShowModal,
  onExport,
  onShowDashboard,
  onLogout,
}: DashboardHeaderProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    container.style.setProperty("--pointer-x", `${x}px`);
    container.style.setProperty("--pointer-y", `${y}px`);
  };

  return (
    <header
      ref={containerRef}
      onMouseMove={handleMouseMove}
      className="relative overflow-hidden flex flex-col sm:flex-row sm:h-[76px] sm:items-center px-4 sm:px-8 py-3.5 sm:py-0 sticky top-0 z-40 border-b border-blue-500/20 text-white shrink-0"
      style={{
        background: "linear-gradient(105deg, #102847 0%, #17385F 58%, #1E4070 100%)",
        "--pointer-x": "-999px",
        "--pointer-y": "-999px",
      } as React.CSSProperties}
    >
      {/* Non-reactive Pointer Glow */}
      <div
        className="absolute pointer-events-none inset-0 mix-blend-screen opacity-70 transition-opacity duration-300 motion-reduce:hidden"
        style={{
          background: "radial-gradient(380px circle at var(--pointer-x) var(--pointer-y), rgba(37, 99, 235, 0.22), transparent)",
        }}
      />

      {/* Brand Title Area */}
      <div className="relative z-10 flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {showDashboard && (
            <button
              onClick={() => onShowDashboard(false)}
              className="mr-2 flex items-center gap-1 text-xs text-slate-300 hover:text-white transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              返回
            </button>
          )}
          <h1 className="text-[16px] sm:text-[18px] font-bold text-white tracking-wide leading-tight truncate">
            券商金融科技招采情报平台
          </h1>
        </div>
        <p className="text-[11px] sm:text-[12px] text-[#B7C6D9] mt-0.5 font-normal truncate">
          洞察招采趋势 · 追踪供应商动态 · 辅助科技采购决策
        </p>
      </div>

      {/* Grouped Right Area */}
      <div className="relative z-10 flex items-center gap-3 sm:gap-6 text-[11px] sm:text-[12px] text-slate-300 flex-wrap mt-2 sm:mt-0">
        {/* 1. Data Status Group */}
        <div className="flex items-center gap-3.5 border-r border-white/10 pr-3.5 hidden md:flex">
          <span className="whitespace-nowrap flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            最新数据: <span className="text-white font-medium">{formatDate(baseline)}</span>
          </span>
          <span className="whitespace-nowrap">
            覆盖主体: <span className="text-white font-medium">{totalBrokers}</span>
          </span>
        </div>

        {/* 2. Main Actions Group */}
        <div className="flex items-center gap-2.5">
          <button
            onClick={onShowModal}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-white/15 text-slate-200 hover:text-white hover:bg-white/10 active:scale-[0.98] transition-all whitespace-nowrap"
          >
            <HelpCircle className="w-3.5 h-3.5" />
            数据口径
          </button>
          <button
            onClick={onExport}
            className="group relative inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white font-semibold shadow-[0_2px_8px_rgba(37,99,235,0.35)] hover:bg-blue-500 active:scale-[0.97] transition-all duration-150 whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5 transition-transform group-hover:-translate-y-0.5" />
            <span>导出当前数据</span>
            <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-white/20 text-[10px] font-normal ml-0.5">
              {filteredData.length}
            </span>
          </button>
        </div>

        {/* 3. Admin & User Controls Group */}
        <div className="flex items-center gap-3 pl-3.5 border-l border-white/10">
          {isAdmin && (
            <button
              onClick={() => onShowDashboard(true)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-amber-400/40 text-amber-300 hover:bg-amber-400/10 active:scale-[0.98] transition-all"
            >
              <Settings className="w-3.5 h-3.5" />
              <span>管理控制台</span>
            </button>
          )}
          <div className="flex items-center gap-2.5">
            <span className="text-slate-300 max-w-[80px] truncate hidden sm:inline">{username}</span>
            <button
              onClick={onLogout}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 active:scale-[0.95] transition-all"
              title="退出登录"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
