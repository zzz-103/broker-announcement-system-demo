"use client";

import { X } from "lucide-react";

interface DataDefinitionModalProps {
  open: boolean;
  onClose: () => void;
}

export function DataDefinitionModal({
  open,
  onClose,
}: DataDefinitionModalProps) {
  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/20 z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-8">
        <div className="bg-white rounded-[10px] border border-[#E4E9F0] shadow-xl max-w-[640px] w-full max-h-[80vh] overflow-y-auto">
          <div className="sticky top-0 bg-white border-b border-[#E4E9F0] px-6 py-4 flex items-center justify-between">
            <h2 className="text-[16px] font-semibold text-[#172033]">
              数据口径说明
            </h2>
            <button
              onClick={onClose}
              className="p-1.5 rounded hover:bg-gray-100 transition-colors"
            >
              <X className="w-4 h-4 text-[#667085]" />
            </button>
          </div>
          <div className="px-6 py-5 space-y-4 text-[13px] text-[#172033] leading-relaxed">
            <p>
              <strong>公告记录不等于独立项目。</strong>
              同一项目可能在不同阶段发布多条公告。"去重项目线索"按主体名称和标准化项目名去重计算。
            </p>
            <p>
              <strong>活跃度受公开信息披露程度影响。</strong>
              各券商的公开招采信息发布渠道和覆盖范围不同，本平台的排名和数量仅反映已采集到的公开数据，不代表实际科技投入规模。
            </p>
            <p>
              <strong>供应商信息来自结果公告。</strong>
              当前数据未进一步区分中标、候选或入围角色，统称为"结果公告披露供应商"。
            </p>
            <p>
              <strong>价格仅为公开披露样本。</strong>
              并非所有项目都公开披露成交金额，公开价格样本数不等于行业总成交额。
            </p>
            <p>
              <strong>当前数据不能确认实施、上线和验收状态。</strong>
              数据仅覆盖公告阶段（采购招标、结果公示、流标废标），不包含合同签订、实施建设、系统上线和项目验收等后续阶段信息。
            </p>
            <p>
              <strong>金融科技分类基于关键词匹配。</strong>
              分类结果基于项目名称、细分品类和一级类别的关键词匹配，可能存在偏差。
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
