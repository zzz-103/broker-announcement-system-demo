"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { ChevronDown } from "lucide-react";

interface HoverSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  className?: string;
  maxHeight?: number;
}

// Global coordination: when one dropdown opens, close all others immediately
let activeDropdown: ((id: number) => void) | null = null;
let nextId = 0;

export function HoverSelect({
  value,
  onChange,
  options,
  placeholder = "请选择",
  className = "",
  maxHeight = 240,
}: HoverSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [triggerWidth, setTriggerWidth] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idRef = useRef(++nextId);

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const openDropdown = useCallback(() => {
    clearCloseTimer();
    if (triggerRef.current) {
      setTriggerWidth(triggerRef.current.offsetWidth);
    }
    if (activeDropdown && activeDropdown !== null) {
      activeDropdown(idRef.current);
    }
    setIsOpen(true);
    activeDropdown = (newId: number) => {
      if (newId !== idRef.current) {
        setIsOpen(false);
      }
    };
  }, [clearCloseTimer]);

  const closeDropdown = useCallback(() => {
    setIsOpen(false);
    if (activeDropdown) {
      activeDropdown = null;
    }
  }, []);

  const handleMouseEnter = useCallback(() => {
    clearCloseTimer();
    openDropdown();
  }, [clearCloseTimer, openDropdown]);

  const handleMouseLeave = useCallback(() => {
    clearCloseTimer();
    closeTimerRef.current = setTimeout(() => {
      closeDropdown();
    }, 50);
  }, [clearCloseTimer, closeDropdown]);

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
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen, closeDropdown]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  const displayLabel =
    options.find((o) => o.value === value)?.label || placeholder;

  return (
    <div
      ref={containerRef}
      className={`relative inline-block ${className}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Trigger */}
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={isOpen}
        onClick={openDropdown}
        className={`
          w-full flex items-center justify-between gap-1.5
          px-3 py-2 text-[13px] rounded-md
          border transition-all duration-150 cursor-pointer
          ${
            isOpen
              ? "border-[#2563EB]/40 bg-white ring-1 ring-[#2563EB]/20"
              : "border-[#E4E9F0] bg-[#F8FAFC]"
          }
          ${value ? "text-[#172033]" : "text-[#667085]"}
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
      <div
        className={`
          absolute top-full left-0 mt-1 rounded-lg z-50
          bg-white/75 backdrop-blur-xl border border-white/60
          shadow-[0_8px_32px_rgba(0,0,0,0.08),0_2px_8px_rgba(0,0,0,0.04)]
          origin-top transition-[transform,opacity] duration-[180ms] ease-[cubic-bezier(0.16,1,0.3,1)]
          ${isOpen ? "opacity-100 scale-y-100 pointer-events-auto" : "opacity-0 scale-y-0 pointer-events-none"}
        `}
        style={{ width: triggerWidth > 0 ? `${triggerWidth}px` : "auto" }}
      >
        <div
          className="overflow-y-auto py-1"
          style={{ maxHeight: `${maxHeight}px` }}
        >
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => handleSelect(opt.value)}
              className={`
                w-full text-left px-3 py-[7px] text-[13px] transition-colors duration-100
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
      </div>
    </div>
  );
}
