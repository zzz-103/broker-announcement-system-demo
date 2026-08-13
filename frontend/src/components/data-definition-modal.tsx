"use client";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface DataDefinitionModalProps {
  open: boolean;
  onClose: () => void;
}

export function DataDefinitionModal({
  open,
  onClose,
}: DataDefinitionModalProps) {
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-1rem)] max-w-[640px] gap-0 overflow-y-auto overscroll-contain border-[#E4E9F0] bg-white p-0 sm:max-h-[80vh]">
          <DialogHeader className="sticky top-0 z-10 border-b border-[#E4E9F0] bg-white px-4 py-4 sm:px-6">
            <DialogTitle className="text-[16px] font-semibold text-[#172033]">数据口径说明</DialogTitle>
            <DialogDescription className="sr-only">招采看板指标与数据范围说明</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 px-4 py-5 text-[13px] leading-relaxed text-[#172033] sm:px-6">
            <p>
              <strong>公告记录不等于独立项目。</strong>
              同一项目可能在不同阶段发布多条公告。“项目线索”按主体名称和标准化项目名去重计算。
            </p>
            <p>
              <strong>活跃度受公开信息披露程度影响。</strong>
              各券商的公开招采信息发布渠道和覆盖范围不同，本平台的排名和数量仅反映已采集到的公开数据，不代表实际科技投入规模。
            </p>
            <p>
              <strong>供应商信息来自结果公告。</strong>
              当前数据未进一步区分中标、候选或入围角色，统称为“结果公告披露供应商”。
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
      </DialogContent>
    </Dialog>
  );
}
