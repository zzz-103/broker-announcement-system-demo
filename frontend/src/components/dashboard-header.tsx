"use client";

import { useRef } from "react";
import Image from "next/image";
import { Download, Settings, LogOut, Sparkles, ArrowLeft, HelpCircle, MessageSquarePlus } from "lucide-react";
import type { ProcessedRecord } from "@/lib/announcement-data";
import { formatDate } from "@/lib/announcement-data";
import { ModuleSwitcher, type ActiveModule } from "@/components/app-watch/module-switcher";
import { APP_VERSION } from "@/lib/app-version";

interface DashboardHeaderProps {
  username: string;
  totalBrokers: number;
  baseline: Date | null;
  filteredData: ProcessedRecord[];
  isAdmin: boolean;
  showDashboard: boolean;
  activeModule?: ActiveModule;
  onShowModal: () => void;
  onExport: () => void;
  onOpenFeedback: () => void;
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
  activeModule,
  onShowModal,
  onExport,
  onOpenFeedback,
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
      className="relative flex min-w-0 flex-col overflow-hidden px-3 py-3 text-white sm:h-[76px] sm:flex-row sm:items-center sm:px-8 sm:py-0 sticky top-0 z-40 border-b border-blue-500/20 shrink-0"
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
          <Image src="/brand/company-icon.png" alt="世纪证券" width={36} height={36} className="size-8 shrink-0 rounded-lg sm:size-9" priority />
          <h1 className="min-w-0 text-[15px] font-bold leading-tight tracking-wide text-white sm:text-[18px]">
            <span className="sm:hidden">世纪证券招采平台</span><span className="hidden sm:inline">世纪证券招采情报平台</span>
          </h1>
          <span className="rounded border border-white/15 bg-white/10 px-1.5 py-0.5 text-[9px] font-medium text-blue-100">
            v{APP_VERSION}
          </span>
        </div>
        <p className="mt-0.5 hidden truncate text-[11px] font-normal text-[#B7C6D9] sm:block sm:text-[12px]">
          洞察招采趋势 · 追踪供应商动态 · 辅助科技采购决策
        </p>
      </div>

      {/* Grouped Right Area */}
      <div className="relative z-10 mt-2 flex min-w-0 items-center gap-1.5 text-[11px] text-slate-300 sm:mt-0 sm:gap-4 sm:text-[12px]">
        {/* 0. Module Switcher (NEW) */}
        {activeModule && (
          <div className="flex shrink-0 items-center gap-1.5 border-r border-white/10 pr-1.5 sm:border-l sm:border-r-0 sm:pr-0 sm:pl-3.5">
            <ModuleSwitcher activeModule={activeModule} />
          </div>
        )}

        {/* 1. Data Status Group */}
        <div className="flex items-center gap-3.5 border-r border-white/10 pr-3.5 hidden md:flex">
          <span className="whitespace-nowrap flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            最新数据：<span className="text-white font-medium">{formatDate(baseline)}</span>
          </span>
          <span className="whitespace-nowrap">
            覆盖主体：<span className="text-white font-medium">{totalBrokers}</span>
          </span>
        </div>

        {/* 2. Main Actions Group */}
        <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:flex-none sm:gap-2.5">
          <button
            onClick={onShowModal}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-white/15 text-slate-200 hover:text-white hover:bg-white/10 active:scale-[0.98] transition-all whitespace-nowrap"
          >
            <HelpCircle className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">数据口径</span><span className="sm:hidden">口径</span>
          </button>
          <button
            onClick={onOpenFeedback}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-sky-300/40 bg-sky-400/10 text-sky-100 hover:bg-sky-400/20 hover:text-white active:scale-[0.98] transition-all whitespace-nowrap"
            title="补充券商、反馈数据问题或提出产品建议"
          >
            <MessageSquarePlus className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">提交反馈</span><span className="sm:hidden">反馈</span>
          </button>
          <button
            onClick={onExport}
            className="group relative inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white font-semibold shadow-[0_2px_8px_rgba(37,99,235,0.35)] hover:bg-blue-500 active:scale-[0.97] transition-all duration-150 whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5 transition-transform group-hover:-translate-y-0.5" />
            <span className="hidden sm:inline">导出当前数据</span><span className="sm:hidden">导出</span>
            <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-white/20 text-[10px] font-normal ml-0.5">
              {filteredData.length}
            </span>
          </button>
        </div>

        {/* 3. Admin & User Controls Group */}
        <div className="flex shrink-0 items-center gap-1.5 border-l border-white/10 pl-1.5 sm:gap-3 sm:pl-3.5">
          {isAdmin && (
            <button
              onClick={() => onShowDashboard(true)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-amber-400/40 text-amber-300 hover:bg-amber-400/10 active:scale-[0.98] transition-all"
            >
              <Settings className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">管理控制台</span><span className="sm:hidden">管理</span>
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
