"use client";

import { Lock, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface FullRefreshDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  password: string;
  onPasswordChange: (password: string) => void;
  verifying: boolean;
  error: string | null;
  busy: boolean;
  onConfirm: () => void | Promise<void>;
}

export function FullRefreshDialog({
  open,
  onOpenChange,
  password,
  onPasswordChange,
  verifying,
  error,
  busy,
  onConfirm,
}: FullRefreshDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border-[#D9E2EC]">
        <DialogHeader>
          <DialogTitle className="text-base text-[#172033]">确认全量重建</DialogTitle>
          <DialogDescription className="text-[#667085]">
            该操作会重新处理全部公告，并覆盖已有处理结果；增量处理不受影响。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="rounded-md bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-700">
            影响范围较大，请输入管理员密码确认身份后执行。
          </div>
          <div className="relative">
            <Lock className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[#98A2B3]" />
            <input
              type="password"
              value={password}
              onChange={(event) => onPasswordChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void onConfirm();
              }}
              placeholder="请输入管理员密码"
              autoComplete="current-password"
              disabled={verifying}
              className={cn(
                "h-11 w-full rounded-lg border bg-white pl-10 pr-3 text-sm text-[#172033] outline-none transition-colors placeholder:text-[#98A2B3]",
                error ? "border-rose-300 focus:border-rose-400" : "border-[#D9E2EC] focus:border-[#2563EB]",
              )}
            />
          </div>
          {error && <p className="text-xs text-rose-600">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={verifying}
            >
              取消
            </Button>
            <Button
              type="button"
              onClick={() => void onConfirm()}
              disabled={busy || verifying || !password}
              className="bg-amber-600 text-xs font-semibold text-white hover:bg-amber-700"
            >
              {verifying ? (
                <>
                  <RefreshCw className="size-3.5 animate-spin" />
                  验证中...
                </>
              ) : (
                "确认全量重建"
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
