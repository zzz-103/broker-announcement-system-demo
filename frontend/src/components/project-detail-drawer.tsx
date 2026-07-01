"use client";

import { X, AlertCircle } from "lucide-react";
import type { ProcessedRecord } from "@/lib/announcement-data";
import { formatDate, formatAmount } from "@/lib/announcement-data";

interface ProjectDetailDrawerProps {
  record: ProcessedRecord | null;
  onClose: () => void;
}

export function ProjectDetailDrawer({
  record,
  onClose,
}: ProjectDetailDrawerProps) {
  if (!record) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/20 z-40"
        onClick={onClose}
      />
      {/* Drawer */}
      <div className="fixed top-0 right-0 h-full w-full sm:w-[42%] sm:max-w-[720px] bg-white shadow-xl z-50 overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-[#E4E9F0] px-6 py-4 flex items-center justify-between z-10">
          <h2 className="text-[16px] font-semibold text-[#172033]">
            项目详情
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-gray-100 transition-colors"
          >
            <X className="w-4 h-4 text-[#667085]" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-6">
          {/* Section 1: Project Overview */}
          <section>
            <h3 className="text-[13px] font-semibold text-[#162B49] uppercase tracking-wider mb-3">
              项目概览
            </h3>
            <div className="space-y-2.5">
              <Field label="主体" value={record.validBrokerName} />
              <Field label="项目名称" value={record.project_name_raw} />
              <Field
                label="标准化名称"
                value={record.normalizedProjectName}
              />
              <Field label="金融科技方向" value={record.primaryDomain} />
              <div className="flex items-start gap-3 text-[13px]">
                <span className="text-[#667085] w-28 shrink-0">主题标签</span>
                <div className="flex flex-wrap gap-1">
                  {record.topicTags.length > 0 ? (
                    record.topicTags.map((tag) => (
                      <span
                        key={tag}
                        className="text-[11px] px-1.5 py-0.5 rounded bg-[#F0F2F5] text-[#667085]"
                      >
                        {tag}
                      </span>
                    ))
                  ) : (
                    <span className="text-[#98A2B3]">无标签</span>
                  )}
                </div>
              </div>
              <Field
                label="公告阶段"
                value={record.announcement_stage || "待确认"}
              />
              <Field
                label="采购方式"
                value={record.procurement_method || "方式未识别"}
              />
              <Field
                label="公告日期"
                value={formatDate(record.validPublishDate)}
              />
            </div>
          </section>

          {/* Section 2: Supplier & Price */}
          <section>
            <h3 className="text-[13px] font-semibold text-[#162B49] uppercase tracking-wider mb-3">
              供应商与价格
            </h3>
            <div className="space-y-2.5">
              <Field
                label="结果公告披露供应商"
                value={record.normalizedSupplier || "未披露"}
              />
              {record.normalizedSupplier && (
                <div className="flex items-start gap-1.5 text-[11px] text-[#F59E0B] ml-31">
                  <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
                  <span>
                    当前数据未进一步区分中标、候选或入围角色。
                  </span>
                </div>
              )}
              <Field
                label="公开披露成交金额"
                value={
                  record.winning_amount_yuan !== null
                    ? formatAmount(record.winning_amount_yuan)
                    : "未披露"
                }
                highlight={record.winning_amount_yuan !== null}
              />
            </div>
          </section>

          {/* Section 3: Data Source */}
          <section>
            <h3 className="text-[13px] font-semibold text-[#162B49] uppercase tracking-wider mb-3">
              数据来源
            </h3>
            <div className="space-y-2.5">
              <Field label="源文件" value={record.markdown_file || "未提供"} />
              <Field
                label="文档SHA1"
                value={record.document_sha1 || "未提供"}
                mono
              />
              <Field
                label="处理时间"
                value={record.processed_at || "未提供"}
              />
              <Field
                label="原始路径"
                value={record.raw_json_path || "未提供"}
                mono
              />
              <Field
                label="主体文件夹"
                value={record.broker_folder || "未提供"}
              />
              <div className="text-[11px] text-[#98A2B3] mt-2">
                当前数据未保存可直接访问的公告URL。
              </div>
            </div>
          </section>

          {/* Section 4: Data Quality */}
          <section>
            <h3 className="text-[13px] font-semibold text-[#162B49] uppercase tracking-wider mb-3">
              数据质量
            </h3>
            <div className="space-y-2">
              <QualityItem
                label="日期是否识别"
                ok={record.validPublishDate !== null}
              />
              <QualityItem
                label="供应商是否披露"
                ok={record.normalizedSupplier !== ""}
              />
              <QualityItem
                label="金额是否披露"
                ok={record.winning_amount_yuan !== null}
              />
              <QualityItem
                label="是否属于非金融科技项目"
                ok={!record.isFinTech}
                invert
              />
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

function Field({
  label,
  value,
  highlight,
  mono,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start gap-3 text-[13px]">
      <span className="text-[#667085] w-28 shrink-0">{label}</span>
      <span
        className={`flex-1 break-all ${
          highlight ? "text-[#0F9F8F] font-medium" : "text-[#172033]"
        } ${mono ? "font-mono text-[12px]" : ""}`}
      >
        {value}
      </span>
    </div>
  );
}

function QualityItem({
  label,
  ok,
  invert,
}: {
  label: string;
  ok: boolean;
  invert?: boolean;
}) {
  const isGood = invert ? !ok : ok;
  return (
    <div className="flex items-center gap-2 text-[12px]">
      <span
        className={`w-1.5 h-1.5 rounded-full ${
          isGood ? "bg-[#0F9F8F]" : "bg-[#D64545]"
        }`}
      />
      <span className="text-[#667085]">{label}</span>
      <span className={isGood ? "text-[#0F9F8F]" : "text-[#D64545]"}>
        {isGood ? "是" : "否"}
      </span>
    </div>
  );
}
