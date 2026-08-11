"use client";

import { AlertCircle, Clock3, Loader2, SearchCheck } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { IntelligenceQueryPlanResponse } from "@/lib/api/contracts";

export function QueryPlanDialog({
  open,
  loading,
  submitting,
  plan,
  error,
  seconds,
  paused,
  onOpenChange,
  onDirectionChange,
  onEditStart,
  onRetry,
  onConfirm,
}: {
  open: boolean;
  loading: boolean;
  submitting: boolean;
  plan: IntelligenceQueryPlanResponse | null;
  error: string;
  seconds: number;
  paused: boolean;
  onOpenChange: (open: boolean) => void;
  onDirectionChange: (index: number, value: string) => void;
  onEditStart: () => void;
  onRetry: () => void;
  onConfirm: () => void;
}) {
  const directions = plan?.directions ?? [];
  const validDirectionCount = directions.filter((item) => item.trim()).length;
  const canConfirm = validDirectionCount > 0 && validDirectionCount <= 5;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!submitting) onOpenChange(next); }}>
      <DialogContent className="w-[calc(100%-1rem)] max-w-2xl border-[#D9E2EC] bg-white sm:w-full">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base text-[#172033]"><SearchCheck className="size-4 text-[#315EA8]" />本次准备重点检索的方向</DialogTitle>
          <DialogDescription className="text-[#667085]">确认或修改研究方向后，系统才会开始检索公开资料。</DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex min-h-44 flex-col items-center justify-center gap-3 rounded-lg border border-[#E4EAF2] bg-[#F8FAFD] text-sm text-[#667085]" role="status">
            <Loader2 className="size-5 animate-spin text-[#315EA8] motion-reduce:animate-none" aria-hidden="true" />
            正在整理你的研究需求…
          </div>
        )}

        {!loading && error && (
          <div className="space-y-3 rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
            <div className="flex items-start gap-2"><AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" /><span>{error}</span></div>
            <button type="button" onClick={onRetry} className="rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50">重新整理</button>
          </div>
        )}

        {!loading && plan && (
          <div className="space-y-4">
            <div className="border-l-2 border-[#7FA3DF] pl-3">
              <p className="text-[11px] font-semibold text-[#667085]">检索意图</p>
              <p className="mt-1 text-sm leading-6 text-[#344054]">{plan.intent}</p>
            </div>

            <div className="space-y-3">
              <p className="text-[11px] leading-5 text-[#98A2B3]">可以直接改写；清空某一项后确认，系统会忽略该方向。</p>
              {directions.map((direction, index) => (
                <label key={index} className="block">
                  <span className="mb-1.5 block text-xs font-semibold text-[#344054]">方向 {index + 1}</span>
                  <textarea
                    value={direction}
                    onFocus={onEditStart}
                    onChange={(event) => onDirectionChange(index, event.target.value)}
                    maxLength={300}
                    rows={2}
                    disabled={submitting}
                    className="w-full resize-y rounded-md border border-[#D0D5DD] bg-white px-3 py-2.5 text-sm leading-6 text-[#172033] outline-none transition focus:border-[#4F7CFF] focus:ring-2 focus:ring-[#4F7CFF]/15 disabled:opacity-60"
                  />
                </label>
              ))}
            </div>

            {(plan.warning || plan.degraded) && (
              <p className="rounded-md border border-amber-100 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">{plan.warning || "查询规划暂时不可用，已保留你的原始关注内容供确认。"}</p>
            )}

            <div className={`flex items-center gap-2 rounded-md px-3 py-2 text-xs ${paused ? "bg-[#F8FAFC] text-[#667085]" : "bg-[#EEF4FF] text-[#315EA8]"}`} role="status" aria-live="polite">
              <Clock3 className="size-3.5 shrink-0" aria-hidden="true" />
              {paused ? "你正在编辑，自动确认已暂停。" : `${seconds} 秒后将自动确认并开始检索。`}
            </div>
          </div>
        )}

        <DialogFooter>
          <button type="button" onClick={() => onOpenChange(false)} disabled={submitting} className="rounded-md border border-[#D0D5DD] px-3.5 py-2 text-sm font-semibold text-[#475467] hover:bg-[#F8FAFC] disabled:opacity-50">取消</button>
          <button type="button" onClick={onConfirm} disabled={loading || submitting || !plan || !canConfirm} className="inline-flex items-center gap-1.5 rounded-md bg-[#2563EB] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1D4ED8] disabled:cursor-not-allowed disabled:opacity-50">
            {submitting && <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}{submitting ? "正在开始…" : "立即确认"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
