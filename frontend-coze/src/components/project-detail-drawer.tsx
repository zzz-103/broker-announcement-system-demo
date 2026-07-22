"use client";

import { X, AlertCircle } from "lucide-react";
import type { ProcessedRecord } from "@/lib/announcement-data";
import { formatAmount, formatAmountInWan, formatDate } from "@/lib/announcement-data";

export function ProjectDetailDrawer({ record, onClose }: { record: ProcessedRecord | null; onClose: () => void }) {
  if (!record) return null;
  return <>
    <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />
    <aside className="fixed right-0 top-0 z-50 h-full w-full max-w-[720px] overflow-y-auto bg-white shadow-xl sm:w-[42%]">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[#E4E9F0] bg-white px-6 py-4">
        <h2 className="text-[16px] font-semibold text-[#172033]">项目详情</h2>
        <button onClick={onClose} className="rounded p-1.5 hover:bg-gray-100" aria-label="关闭"><X className="h-4 w-4" /></button>
      </div>
      <div className="space-y-6 px-6 py-5">
        <section><h3 className="mb-3 text-[13px] font-semibold uppercase tracking-wider text-[#162B49]">项目概览</h3><div className="space-y-2.5">
          <Field label="主体" value={record.validBrokerName} /><Field label="项目名称" value={record.project_name_raw} /><Field label="标准化名称" value={record.normalizedProjectName} /><Field label="金融科技方向" value={record.primaryDomain} /><Field label="主题标签" value={record.topicTags.join("、") || "无标签"} /><Field label="公告阶段" value={record.announcement_stage || "待确认"} /><Field label="采购方式" value={record.procurement_method || "方式未识别"} /><Field label="公告日期" value={formatDate(record.validPublishDate)} />
        </div></section>
        <section><h3 className="mb-3 text-[13px] font-semibold uppercase tracking-wider text-[#162B49]">供应商与价格</h3><div className="space-y-2.5">
          <Field label="项目预算" value={formatAmountInWan(record.budget_amount_yuan)} highlight={record.budget_amount_yuan !== null} /><Field label="结果公告披露供应商" value={record.normalizedSupplier || "未披露"} />{record.normalizedSupplier && <p className="flex gap-1.5 text-[11px] text-[#F59E0B]"><AlertCircle className="h-3 w-3 shrink-0" />当前数据未进一步区分中标、候选或入围角色。</p>}<Field label="公开披露成交金额" value={record.winning_amount_yuan === null ? "未披露" : formatAmount(record.winning_amount_yuan)} highlight={record.winning_amount_yuan !== null} />
        </div></section>
      </div>
    </aside>
  </>;
}

function Field({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return <div className="flex items-start gap-3 text-[13px]"><span className="w-28 shrink-0 text-[#667085]">{label}</span><span className={highlight ? "font-medium text-[#0F9F8F]" : "break-all text-[#172033]"}>{value}</span></div>;
}
