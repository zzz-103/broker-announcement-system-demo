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
    <div className="rounded-2xl border border-[#E4EAF2] bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
      <div className="text-[12px] text-[#667085]">{label}</div>
      <div
        className={`font-bold text-[#172033] ${
          isText ? "text-[16px]" : "text-[24px]"
        }`}
      >
        {value}
      </div>
    </div>
  );
}
