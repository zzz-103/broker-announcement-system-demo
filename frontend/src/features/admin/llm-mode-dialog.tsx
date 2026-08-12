"use client";

import { Database, Info, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { JobType } from "@/lib/api/backend-client";

interface LlmModeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (jobType: Extract<JobType, "llm" | "llm-external">) => void | Promise<void>;
}

export function LlmModeDialog({ open, onOpenChange, onSelect }: LlmModeDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border-[#D9E2EC]">
        <DialogHeader>
          <DialogTitle className="text-base text-[#172033]">选择处理范围</DialogTitle>
          <DialogDescription className="text-[#667085]">
            常规公告会完成结构化处理、匹配与汇总；外来公告仅生成候选数据。
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-700">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          <span>处理完成后，请点击本卡片右上角「更多操作」菜单，选择「更新看板」发布结果。</span>
        </div>
        <div className="grid gap-3 pt-2">
          <Button
            type="button"
            onClick={() => void onSelect("llm")}
            className="h-11 justify-start bg-[#162B49] text-sm font-semibold text-white hover:bg-[#1e3a5f]"
          >
            <Database className="size-4" />
            处理常规公告
          </Button>
          <Button
            type="button"
            onClick={() => void onSelect("llm-external")}
            variant="outline"
            className="h-11 justify-start border-sky-200 text-sm font-semibold text-sky-700 hover:bg-sky-50"
          >
            <Upload className="size-4" />
            处理外来公告
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
