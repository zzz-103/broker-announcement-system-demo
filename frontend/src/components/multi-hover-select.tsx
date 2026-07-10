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
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [panelWidth, setPanelWidth] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const closeDropdown = useCallback(() => {
    clearCloseTimer();
    setIsOpen(false);
  }, [clearCloseTimer]);

  const openDropdown = useCallback(() => {
    // Close any other open dropdown first
    if (activeDropdownClose && activeDropdownClose !== closeDropdown) {
      activeDropdownClose();
    }
    clearCloseTimer();
    setIsOpen(true);
    activeDropdownClose = closeDropdown;
    // Measure trigger width
    if (triggerRef.current) {
      setPanelWidth(Math.max(triggerRef.current.offsetWidth, 120));
    }
  }, [clearCloseTimer, closeDropdown]);

  const handleMouseEnter = useCallback(() => {
    openDropdown();
  }, [openDropdown]);

  const handleMouseLeave = useCallback(() => {
    closeTimerRef.current = setTimeout(() => {
      setIsOpen(false);
      if (activeDropdownClose === closeDropdown) {
        activeDropdownClose = null;
      }
    }, 50);
  }, [closeDropdown]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
      if (activeDropdownClose === closeDropdown) activeDropdownClose = null;
    };
  }, [closeDropdown]);

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
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <button
        ref={triggerRef}
        type="button"
        className={`
          w-full flex items-center justify-between gap-1.5 px-3 py-1.5 rounded-md text-[13px]
          border transition-all duration-150 whitespace-nowrap
          ${
            values.length > 0
              ? "border-[#2563EB]/30 bg-[#2563EB]/5 text-[#2563EB]"
              : "border-[#E4E9F0] bg-white text-[#667085] hover:border-[#D0D5DD]"
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
      <div
        className={`
          absolute top-full left-0 mt-1 z-50
          bg-white/80 backdrop-blur-xl rounded-lg
          border border-white/60 shadow-[0_8px_32px_rgba(0,0,0,0.12),0_2px_8px_rgba(0,0,0,0.06)]
          origin-top transition-all duration-[180ms] ease-[cubic-bezier(0.16,1,0.3,1)]
          ${isOpen ? "opacity-100 scale-y-100 pointer-events-auto" : "opacity-0 scale-y-95 pointer-events-none"}
        `}
        style={{ minWidth: panelWidth, maxHeight: maxHeight + 8 }}
      >
        <div className="py-1 overflow-y-auto" style={{ maxHeight }}>
          {searchable && (
            <div className="px-2 pb-2">
              <input
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder={searchPlaceholder}
                className="h-8 w-full rounded-md border border-[#E4E9F0] bg-[#F8FAFC] px-2.5 text-[12px] text-[#172033] placeholder:text-[#98A2B3] focus:outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/10"
              />
            </div>
          )}
          {/* Clear all option */}
          {!normalizedQuery && (
            <button
              type="button"
              onClick={() => onChange([])}
              className={`
                w-full text-left px-3 py-1.5 text-[13px] flex items-center gap-2
                transition-colors duration-100
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
                onClick={() => handleSelect(opt.value)}
                className={`
                  w-full text-left px-3 py-1.5 text-[13px] flex items-center gap-2
                  transition-colors duration-100
                  ${isSelected ? "bg-[#2563EB]/8 text-[#2563EB]" : "text-[#344054] hover:bg-[#F8FAFC]"}
                `}
              >
                <span
                  className={`
                    w-4 h-4 shrink-0 rounded border flex items-center justify-center
                    transition-all duration-150
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
                      className="mt-2 inline-flex h-8 items-center rounded-md bg-[#2563EB] px-2.5 text-[12px] font-semibold text-white hover:bg-blue-700 transition-colors"
                    >
                      登记需求
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
