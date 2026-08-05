"use client";

export function KpiCard({
  label,
  value,
  isText,
}: {
  label: string;
  value: number | string;
  isText?: boolean;
}) {
  return (
    <div className="min-w-0 bg-white px-3 py-3 sm:px-4">
      <div className="truncate text-[11px] font-medium text-[#667085]" title={label}>{label}</div>
      <div
        className={`mt-1 truncate font-semibold tabular-nums text-[#172033] ${
          isText ? "text-[15px]" : "text-[22px]"
        }`}
        title={String(value)}
      >
        {value}
      </div>
    </div>
  );
}
