"use client";

import { LayoutGrid, Smartphone } from "lucide-react";

export type ActiveModule = "procurement" | "app-watch";

const MODULES: { key: ActiveModule; label: string; icon: typeof LayoutGrid }[] = [
  { key: "procurement", label: "招采情报", icon: LayoutGrid },
  { key: "app-watch", label: "App更新", icon: Smartphone },
];

export function ModuleSwitcher({ activeModule, onModuleChange }: { activeModule: ActiveModule; onModuleChange?: (module: ActiveModule) => void }) {

  return (
    <div className="inline-flex items-center gap-0.5 rounded-lg border border-white/15 bg-white/5 p-0.5">
      {MODULES.map(({ key, label, icon: Icon }) => {
        const active = key === activeModule;
        return (
          <button
            key={key}
            onClick={() => onModuleChange?.(key)}
            className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium transition-all whitespace-nowrap sm:text-[12px] ${
              active
                ? "bg-white text-[#102847] shadow-sm"
                : "text-slate-200 hover:bg-white/10 hover:text-white"
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        );
      })}
    </div>
  );
}
