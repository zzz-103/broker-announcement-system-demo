"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { ChevronDown } from "lucide-react";

interface HoverSelectProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  className?: string;
  maxHeight?: number;
  disabled?: boolean;
}

// Global coordination: when one dropdown opens, close all others immediately
let activeDropdown: ((id: number) => void) | null = null;
let nextId = 0;

export function HoverSelect({
  id,
  value,
  onChange,
  options,
  placeholder = "请选择",
  className = "",
  maxHeight = 240,
  disabled = false,
}: HoverSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [triggerWidth, setTriggerWidth] = useState(0);
  const [panelPlacement, setPanelPlacement] = useState<"below" | "above">("below");
  const [panelMaxHeight, setPanelMaxHeight] = useState(maxHeight);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const idRef = useRef(++nextId);

  const updatePanelLayout = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const viewportPadding = 8;
    const availableBelow = Math.max(0, window.innerHeight - rect.bottom - viewportPadding);
    const availableAbove = Math.max(0, rect.top - viewportPadding);
    const opensAbove = availableBelow < Math.min(maxHeight, 160) && availableAbove > availableBelow;
    const availableHeight = opensAbove ? availableAbove : availableBelow;

    setTriggerWidth(trigger.offsetWidth);
    setPanelPlacement(opensAbove ? "above" : "below");
    setPanelMaxHeight(Math.max(1, Math.min(maxHeight, availableHeight || maxHeight)));
  }, [maxHeight]);

  const openDropdown = useCallback(() => {
    updatePanelLayout();
    if (activeDropdown && activeDropdown !== null) {
      activeDropdown(idRef.current);
    }
    setIsOpen(true);
    activeDropdown = (newId: number) => {
      if (newId !== idRef.current) {
        setIsOpen(false);
      }
    };
  }, [updatePanelLayout]);

  const closeDropdown = useCallback(() => {
    setIsOpen(false);
    if (activeDropdown) {
      activeDropdown = null;
    }
  }, []);

  const handleSelect = useCallback(
    (val: string) => {
      onChange(val);
      closeDropdown();
    },
    [onChange, closeDropdown]
  );

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        closeDropdown();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeDropdown();
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", updatePanelLayout);
    window.addEventListener("scroll", updatePanelLayout, true);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", updatePanelLayout);
      window.removeEventListener("scroll", updatePanelLayout, true);
    };
  }, [isOpen, closeDropdown, updatePanelLayout]);

  const displayLabel =
    options.find((o) => o.value === value)?.label || placeholder;

  return (
    <div
      ref={containerRef}
      className={`relative inline-block ${className}`}
    >
      {/* Trigger */}
      <button
        id={id}
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        disabled={disabled}
        onClick={() => (isOpen ? closeDropdown() : openDropdown())}
        className={`
          w-full flex items-center justify-between gap-1.5
          min-h-11 px-3 py-2 text-[13px] rounded-md
          border transition-[background-color,border-color,box-shadow,color] duration-150 touch-manipulation cursor-pointer
          sm:min-h-0
          ${
            isOpen
              ? "border-[#2563EB]/40 bg-white ring-1 ring-[#2563EB]/20"
              : "border-[#E4EAF2] bg-[#F8FAFC]"
          }
          ${value ? "text-[#172033]" : "text-[#667085]"}
          disabled:cursor-not-allowed disabled:border-[#E4EAF2] disabled:bg-[#F8FAFC] disabled:text-[#98A2B3]
        `}
      >
        <span className="truncate">{displayLabel}</span>
        <ChevronDown
          className={`w-3.5 h-3.5 text-[#98A2B3] shrink-0 transition-transform duration-200 ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </button>

      {/* Dropdown Panel - frosted glass + slide-down animation */}
      {isOpen && <div
        role="listbox"
        className={`
          absolute z-50 max-w-[calc(100vw-1rem)] overflow-hidden rounded-lg
          bg-white border border-[#D9E2EC]
          shadow-[0_8px_24px_rgba(16,40,71,0.12)]
          ${panelPlacement === "above" ? "bottom-full mb-1" : "top-full mt-1"}
          right-0 md:left-0 md:right-auto
        `}
        style={{ width: triggerWidth > 0 ? `${triggerWidth}px` : "auto", maxWidth: "calc(100vw - 1rem)" }}
      >
        <div
          className="overflow-y-auto py-1"
          style={{ maxHeight: `${panelMaxHeight}px` }}
        >
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="option"
              aria-selected={opt.value === value}
              onClick={() => handleSelect(opt.value)}
              className={`
                w-full min-h-11 text-left px-3 py-2 text-[13px] transition-colors duration-100 touch-manipulation sm:min-h-0 sm:py-[7px]
                ${
                  opt.value === value
                    ? "bg-[#2563EB]/8 text-[#2563EB] font-medium"
                    : "text-[#374151] hover:bg-[#F3F4F6]"
                }
              `}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>}
    </div>
  );
}
