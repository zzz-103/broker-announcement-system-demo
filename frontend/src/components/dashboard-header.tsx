"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { ChevronDown, Download, LogOut, Settings, UserRound } from "lucide-react";
import { ModuleSwitcher, type ActiveModule } from "@/components/app-watch/module-switcher";

export interface DashboardExportOption {
  id: string;
  label: string;
  description?: string;
  onSelect: () => void;
  disabled?: boolean;
}

interface DashboardHeaderProps {
  username: string;
  isAdmin: boolean;
  activeModule: ActiveModule;
  statusText: string;
  statusLabel?: string;
  statusDescription?: string;
  exportOptions: DashboardExportOption[];
  onOpenAdmin?: () => void;
  onLogout: () => void;
}

function useDismissableMenu(open: boolean, onClose: () => void, menuId: "export" | "user") {
  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(`[data-dashboard-menu="${menuId}"]`)) return;
      onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuId, onClose, open]);
}

function ExportMenu({ options }: { options: DashboardExportOption[] }) {
  const [open, setOpen] = useState(false);
  const hasEnabledOption = options.some((option) => !option.disabled);

  useDismissableMenu(open, () => setOpen(false), "export");

  return (
    <div className="relative shrink-0" data-dashboard-menu="export">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        disabled={!hasEnabledOption}
        className="inline-flex h-9 w-[84px] items-center justify-center gap-1.5 rounded-md border border-blue-300/40 bg-blue-500/90 px-2 text-[12px] font-semibold text-white shadow-[0_2px_8px_rgba(37,99,235,0.22)] transition-colors hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-55"
      >
        <Download className="size-3.5" />
        <span>导出</span>
        <ChevronDown className={`size-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-[224px] rounded-lg border border-[#D9E2EC] bg-white p-1.5 text-[#172033] shadow-[0_12px_32px_rgba(16,40,71,0.18)]"
        >
          <p className="px-2.5 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#98A2B3]">导出数据</p>
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              role="menuitem"
              disabled={option.disabled}
              onClick={() => {
                setOpen(false);
                option.onSelect();
              }}
              className="flex w-full items-start justify-between gap-3 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-[#F2F6FC] disabled:cursor-not-allowed disabled:opacity-45"
            >
              <span className="min-w-0">
                <span className="block truncate text-[12px] font-semibold text-[#344054]">{option.label}</span>
                {option.description && <span className="mt-0.5 block truncate text-[10px] text-[#98A2B3]">{option.description}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function UserMenu({
  username,
  isAdmin,
  onOpenAdmin,
  onLogout,
}: Pick<DashboardHeaderProps, "username" | "isAdmin" | "onOpenAdmin" | "onLogout">) {
  const [open, setOpen] = useState(false);

  useDismissableMenu(open, () => setOpen(false), "user");

  return (
    <div className="relative shrink-0" data-dashboard-menu="user">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`用户菜单：${username || "当前用户"}`}
        title={username || "当前用户"}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex h-9 w-[132px] min-w-0 items-center gap-1.5 rounded-md border border-white/15 bg-white/[0.04] px-2.5 text-left text-[12px] text-slate-200 transition-colors hover:bg-white/10 hover:text-white"
      >
        <UserRound className="size-3.5 shrink-0 text-slate-300" />
        <span className="min-w-0 flex-1 truncate">{username || "当前用户"}</span>
        <ChevronDown className={`size-3 shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-[224px] rounded-lg border border-[#D9E2EC] bg-white p-1.5 text-[#172033] shadow-[0_12px_32px_rgba(16,40,71,0.18)]"
        >
          <div className="border-b border-[#EEF2F6] px-2.5 pb-2 pt-1">
            <p className="break-all text-[12px] font-semibold text-[#172033]">{username || "当前用户"}</p>
            <p className="mt-0.5 text-[10px] text-[#98A2B3]">{isAdmin ? "管理员账号" : "业务用户"}</p>
          </div>
          {isAdmin && onOpenAdmin && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onOpenAdmin();
              }}
              className="mt-1 flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[12px] font-semibold text-[#344054] transition-colors hover:bg-[#F2F6FC]"
            >
              <Settings className="size-3.5 text-[#315EA8]" />
              管理控制台
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[12px] font-semibold text-[#667085] transition-colors hover:bg-rose-50 hover:text-rose-600"
          >
            <LogOut className="size-3.5" />
            退出登录
          </button>
        </div>
      )}
    </div>
  );
}

export function DashboardHeader({
  username,
  isAdmin,
  activeModule,
  statusText,
  statusLabel = "最新数据",
  statusDescription,
  exportOptions,
  onOpenAdmin,
  onLogout,
}: DashboardHeaderProps) {
  return (
    <header
      className="sticky top-0 z-40 h-[68px] min-w-0 overflow-visible border-b border-blue-400/20 bg-[linear-gradient(105deg,#102847_0%,#17385F_58%,#1E4070_100%)] text-white"
      aria-label="平台导航"
    >
      <div className="mx-auto flex h-full min-w-0 max-w-[1600px] items-center gap-3 px-3 sm:px-6 lg:px-8">
        <div className="flex min-w-0 flex-1 basis-0 items-center gap-2">
          <Image src="/brand/company-icon.png" alt="世纪证券" width={36} height={36} className="size-8 shrink-0 rounded-lg" priority />
          <h1 className="min-w-0 truncate text-[15px] font-bold tracking-wide text-white sm:text-[17px]">世纪证券业务信息平台</h1>
        </div>

        <ModuleSwitcher activeModule={activeModule} />

        <div className="flex shrink-0 items-center justify-end gap-2">
          <div
            className="hidden h-9 w-[146px] shrink-0 items-center gap-2 rounded-md border border-white/10 bg-white/[0.04] px-2.5 text-[11px] text-slate-300 lg:flex"
            title={statusDescription || `${statusLabel}：${statusText}`}
          >
            <span className="size-1.5 shrink-0 rounded-full bg-emerald-400" />
            <span className="shrink-0 text-slate-400">{statusLabel}</span>
            <span className="min-w-0 truncate font-medium text-white">{statusText}</span>
          </div>
          <ExportMenu options={exportOptions} />
          <UserMenu username={username} isAdmin={isAdmin} onOpenAdmin={onOpenAdmin} onLogout={onLogout} />
        </div>
      </div>
    </header>
  );
}
