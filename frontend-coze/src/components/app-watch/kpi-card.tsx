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
    <div className="rounded-2xl border border-[#E4EAF2] bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.02)] transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-blue-200/80 hover:shadow-[0_8px_20px_rgba(16,40,71,0.08)] motion-reduce:transform-none">
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
