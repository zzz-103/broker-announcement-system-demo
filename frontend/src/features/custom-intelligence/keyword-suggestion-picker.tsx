"use client";

import type { ReactNode } from "react";

export interface KeywordSuggestionPickerProps {
  title: string;
  description: string;
  suggestions: string[];
  selected: string[];
  variant?: "inline" | "dialog";
  generateAction?: ReactNode;
  onSelectionChange: (values: string[]) => void;
  onMerge: () => void;
}

export function KeywordSuggestionPicker({
  title,
  description,
  suggestions,
  selected,
  variant = "inline",
  generateAction,
  onSelectionChange,
  onMerge,
}: KeywordSuggestionPickerProps) {
  const allSelected = suggestions.length > 0 && selected.length === suggestions.length;
  const toggleAll = () => onSelectionChange(allSelected ? [] : suggestions);
  const mergeButton = (
    <button type="button" onClick={onMerge} disabled={!selected.length} className="rounded-md bg-[#315EA8] px-2.5 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50">
      确认合并
    </button>
  );

  return (
    <div className="mt-4 rounded-lg border border-[#E4EAF2] bg-[#F8FAFD] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-bold text-[#243B61]">{title}</h4>
          <p className="mt-1 text-[11px] text-[#667085]">{description}</p>
        </div>
        {generateAction}
        {variant === "inline" && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={toggleAll}
              className="rounded-md border border-[#D0D5DD] px-2.5 py-1.5 text-[11px] text-[#475467]"
            >
              {allSelected ? "取消全选" : "全选"}
            </button>
            {mergeButton}
          </div>
        )}
      </div>
      {suggestions.length > 0 && (
        <>
          <div className={`mt-3 grid gap-2 ${variant === "dialog" ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-2"}`}>
            {suggestions.map((suggestion) => (
              <label key={suggestion} className="flex cursor-pointer items-center gap-2 rounded-lg border border-[#E4EAF2] bg-white px-3 py-2 text-xs text-[#344054] hover:border-[#9FB9E8]">
                <input
                  type="checkbox"
                  checked={selected.includes(suggestion)}
                  onChange={(event) => onSelectionChange(
                    event.target.checked
                      ? [...selected, suggestion]
                      : selected.filter((item) => item !== suggestion),
                  )}
                  className="size-3.5 accent-[#315EA8]"
                />
                {suggestion}
              </label>
            ))}
          </div>
          {variant === "dialog" && (
            <div className="mt-3 flex justify-end">{mergeButton}</div>
          )}
        </>
      )}
    </div>
  );
}
