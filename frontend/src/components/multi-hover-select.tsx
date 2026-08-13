"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { ChevronDown, Check } from "lucide-react";

interface Option {
  value: string;
  label: string;
}

interface MultiHoverSelectProps {
  values: string[];
  onChange: (values: string[]) => void;
  onToggle: (value: string) => void;
  options: Option[];
  placeholder?: string;
  maxHeight?: number;
  searchable?: boolean;
  searchPlaceholder?: string;
  knownOptions?: Option[];
  onMissingSearch?: (query: string) => void;
  className?: string;
}

// Global event to close other dropdowns
let activeDropdownClose: (() => void) | null = null;

export function MultiHoverSelect({
  values,
  onChange,
  onToggle,
  options,
  placeholder = "请选择",
  maxHeight = 280,
  searchable = false,
  searchPlaceholder = "搜索...",
  knownOptions = options,
  onMissingSearch,
  className = "",
}: MultiHoverSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [panelWidth, setPanelWidth] = useState(0);
  const [panelPlacement, setPanelPlacement] = useState<"below" | "above">("below");
  const [panelMaxHeight, setPanelMaxHeight] = useState(maxHeight);
  const [searchQuery, setSearchQuery] = useState("");

  const closeDropdown = useCallback(() => {
    setIsOpen(false);
  }, []);

  const updatePanelLayout = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const viewportPadding = 8;
    const availableBelow = Math.max(0, window.innerHeight - rect.bottom - viewportPadding);
    const availableAbove = Math.max(0, rect.top - viewportPadding);
    const opensAbove = availableBelow < Math.min(maxHeight, 180) && availableAbove > availableBelow;
    const availableHeight = opensAbove ? availableAbove : availableBelow;

    setPanelWidth(Math.max(trigger.offsetWidth, 120));
    setPanelPlacement(opensAbove ? "above" : "below");
    setPanelMaxHeight(Math.max(1, Math.min(maxHeight, availableHeight || maxHeight)));
  }, [maxHeight]);

  const openDropdown = useCallback(() => {
    // Close any other open dropdown first
    if (activeDropdownClose && activeDropdownClose !== closeDropdown) {
      activeDropdownClose();
    }
    updatePanelLayout();
    setIsOpen(true);
    activeDropdownClose = closeDropdown;
  }, [closeDropdown, updatePanelLayout]);

  useEffect(() => {
    return () => {
      if (activeDropdownClose === closeDropdown) activeDropdownClose = null;
    };
  }, [closeDropdown]);

  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) closeDropdown();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeDropdown();
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", updatePanelLayout);
    window.addEventListener("scroll", updatePanelLayout, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", updatePanelLayout);
      window.removeEventListener("scroll", updatePanelLayout, true);
    };
  }, [closeDropdown, isOpen, updatePanelLayout]);

  const handleSelect = (value: string) => {
    if (value === "") {
      onChange([]);
    } else {
      onToggle(value);
    }
  };

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const visibleOptions = normalizedQuery
    ? options.filter((option) => option.label.toLowerCase().includes(normalizedQuery))
    : options;
  const hasKnownMatch = normalizedQuery
    ? knownOptions.some((option) => option.label.toLowerCase().includes(normalizedQuery))
    : true;

  const displayLabel =
    values.length === 0
      ? placeholder
      : values.length === 1
        ? options.find((o) => o.value === values[0])?.label ?? values[0]
        : `已选 ${values.length} 项`;

  return (
    <div
      ref={containerRef}
      className={`relative min-w-0 ${className}`}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => (isOpen ? closeDropdown() : openDropdown())}
        className={`
          w-full min-h-11 flex items-center justify-between gap-1.5 px-3 py-1.5 rounded-md text-[13px]
          border transition-[background-color,border-color,color] duration-150 whitespace-nowrap touch-manipulation
          sm:min-h-0
          ${
            values.length > 0
              ? "border-[#2563EB]/30 bg-[#2563EB]/5 text-[#2563EB]"
              : "border-[#E4EAF2] bg-white text-[#667085] hover:border-[#D0D5DD]"
          }
        `}
      >
        <span className="truncate max-w-[100px]">{displayLabel}</span>
        <ChevronDown
          size={13}
          className={`shrink-0 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      {/* Dropdown panel */}
      {isOpen && <div
        role="listbox"
        aria-multiselectable="true"
        className={`
          absolute z-50 max-w-[calc(100vw-1rem)] overflow-hidden rounded-lg
          bg-white
          border border-[#D9E2EC] shadow-[0_8px_24px_rgba(16,40,71,0.12)]
          ${panelPlacement === "above" ? "bottom-full mb-1" : "top-full mt-1"}
          right-0 md:left-0 md:right-auto
        `}
        style={{ minWidth: panelWidth, maxWidth: "calc(100vw - 1rem)", maxHeight: panelMaxHeight + 8 }}
      >
        <div className="py-1 overflow-y-auto" style={{ maxHeight: panelMaxHeight }}>
          {searchable && (
            <div className="px-2 pb-2">
              <input
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder={searchPlaceholder}
                className="h-11 w-full rounded-md border border-[#E4EAF2] bg-[#F8FAFC] px-2.5 text-[12px] text-[#172033] placeholder:text-[#98A2B3] touch-manipulation focus:outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/10 sm:h-8"
              />
            </div>
          )}
          {/* Clear all option */}
          {!normalizedQuery && (
            <button
              type="button"
              role="option"
              aria-selected={values.length === 0}
              onClick={() => onChange([])}
              className={`
                w-full min-h-11 text-left px-3 py-2 text-[13px] flex items-center gap-2
                transition-colors duration-100 touch-manipulation sm:min-h-0 sm:py-1.5
                ${values.length === 0 ? "bg-[#2563EB]/8 text-[#2563EB] font-medium" : "text-[#667085] hover:bg-[#F8FAFC]"}
              `}
            >
              <span className="w-4 h-4 shrink-0" />
              <span>全部券商</span>
            </button>
          )}

          {visibleOptions.map((opt) => {
            const isSelected = values.includes(opt.value);
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => handleSelect(opt.value)}
                className={`
                  w-full min-h-11 text-left px-3 py-2 text-[13px] flex items-center gap-2
                  transition-colors duration-100 touch-manipulation sm:min-h-0 sm:py-1.5
                  ${isSelected ? "bg-[#2563EB]/8 text-[#2563EB]" : "text-[#344054] hover:bg-[#F8FAFC]"}
                `}
              >
                <span
                  className={`
                    w-4 h-4 shrink-0 rounded border flex items-center justify-center
                    transition-[background-color,border-color] duration-150
                    ${isSelected ? "bg-[#2563EB] border-[#2563EB]" : "border-[#D0D5DD] bg-white"}
                  `}
                >
                  {isSelected && <Check size={11} className="text-white" strokeWidth={3} />}
                </span>
                <span className="truncate">{opt.label}</span>
              </button>
            );
          })}
          {normalizedQuery && visibleOptions.length === 0 && (
            <div className="px-3 py-3 text-[12px] text-[#667085]">
              {hasKnownMatch ? (
                <p>当前筛选条件下暂无匹配券商。</p>
              ) : (
                <>
                  <p>当前公开来源未检索到“{searchQuery.trim()}”的采购公告。</p>
                  {onMissingSearch && (
                    <button
                      type="button"
                      onClick={() => onMissingSearch(searchQuery.trim())}
                      className="mt-2 inline-flex h-11 items-center rounded-md bg-[#2563EB] px-2.5 text-[12px] font-semibold text-white touch-manipulation transition-colors hover:bg-blue-700 sm:h-8"
                    >
                      登记需求
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>}
    </div>
  );
}
