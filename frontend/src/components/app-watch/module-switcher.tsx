"use client";

import { BrainCircuit, LayoutGrid, Smartphone } from "lucide-react";
import { useRouter } from "next/navigation";

export type ActiveModule = "procurement" | "app-watch" | "custom-intelligence";

const MODULES: { key: ActiveModule; label: string; icon: typeof LayoutGrid }[] = [
  { key: "procurement", label: "招采情报", icon: LayoutGrid },
  { key: "app-watch", label: "App 更新", icon: Smartphone },
  { key: "custom-intelligence", label: "自定义情报", icon: BrainCircuit },
];

export function ModuleSwitcher({ activeModule }: { activeModule: ActiveModule }) {
  const router = useRouter();

  return (
    <nav
      aria-label="业务模块"
      className="inline-flex h-9 shrink-0 items-center gap-0.5 rounded-md border border-white/12 bg-white/[0.04] p-0.5"
    >
      {MODULES.map(({ key, label, icon: Icon }) => {
        const active = key === activeModule;
        return (
          <button
            key={key}
            type="button"
            aria-current={active ? "page" : undefined}
            onClick={() => {
              if (key === "procurement") {
                router.push("/?view=procurement");
              } else if (key === "app-watch") {
                router.push("/app-updates");
              } else {
                router.push("/custom-intelligence");
              }
            }}
            className={`inline-flex h-8 w-[100px] items-center justify-center gap-1 rounded-[5px] px-2 text-[12px] font-medium whitespace-nowrap transition-colors duration-150 motion-reduce:transition-none ${
              active
                ? "bg-white/[0.14] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)]"
                : "text-slate-300 hover:bg-white/[0.08] hover:text-white"
            }`}
          >
            <Icon className="size-3.5 shrink-0" strokeWidth={1.8} />
            {label}
          </button>
        );
      })}
    </nav>
  );
}
