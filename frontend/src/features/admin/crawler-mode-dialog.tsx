"use client";

import { Globe, Workflow } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { JobType } from "@/lib/api/backend-client";

interface CrawlerModeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (jobType: Extract<JobType, "scraper" | "pipeline">) => void | Promise<void>;
}

export function CrawlerModeDialog({ open, onOpenChange, onSelect }: CrawlerModeDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border-[#D9E2EC]">
        <DialogHeader>
          <DialogTitle className="text-base text-[#172033]">选择采集范围</DialogTitle>
          <DialogDescription className="text-[#667085]">
            两种方式都会依次采集采购公告和结果公告；完整流程会在校验、备份后自动更新看板。
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 pt-2">
          <Button
            type="button"
            onClick={() => void onSelect("scraper")}
            variant="outline"
            className="h-auto min-h-16 justify-start border-emerald-200 px-4 py-3 text-left text-emerald-700 hover:bg-emerald-50"
          >
            <Globe className="size-4 shrink-0" />
            <span>
              <span className="block text-sm font-semibold">仅采集公告</span>
              <span className="mt-0.5 block text-xs font-normal text-[#667085]">只下载公告原文，不执行后续处理。</span>
            </span>
          </Button>
          <Button
            type="button"
            onClick={() => void onSelect("pipeline")}
            className="h-auto min-h-16 justify-start bg-[#162B49] px-4 py-3 text-left text-white hover:bg-[#1e3a5f]"
          >
            <Workflow className="size-4 shrink-0" />
            <span>
              <span className="block text-sm font-semibold">运行完整流程</span>
              <span className="mt-0.5 block text-xs font-normal text-white/70">继续运行数据处理、匹配与汇总，通过安全校验后自动发布。</span>
            </span>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
