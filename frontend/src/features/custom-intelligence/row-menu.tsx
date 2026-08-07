"use client";

import { MoreHorizontal } from "lucide-react";
import { useRef, useState } from "react";

export interface RowMenuItem {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
}

/**
 * 行级“更多”菜单：低频操作收纳于此，fixed 定位避免被表格滚动容器裁剪。
 */
export function RowMenu({ items, label = "更多操作" }: { items: RowMenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; right: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const enabled = items.filter((item) => !item.disabled);
  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) setPosition({ top: rect.bottom + 4, right: Math.max(8, window.innerWidth - rect.right) });
    setOpen(true);
  };
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        disabled={enabled.length === 0}
        aria-label={label}
        aria-expanded={open}
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-md border border-transparent text-[#667085] transition hover:border-[#E4EAF2] hover:bg-[#F8FAFD] hover:text-[#344054] disabled:cursor-not-allowed disabled:opacity-40"
      >
        <MoreHorizontal className="size-4" aria-hidden="true" />
      </button>
      {open && position && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden="true" />
          <div
            role="menu"
            className="fixed z-50 min-w-[150px] rounded-md border border-[#E4EAF2] bg-white py-1 shadow-lg"
            style={{ top: position.top, right: position.right }}
          >
            {items.map((item) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
                className={`block w-full px-3 py-2 text-left text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${item.danger ? "text-red-600 hover:bg-red-50" : "text-[#344054] hover:bg-[#F8FAFD]"}`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}
