"use client";

import { AlertCircle, CheckCircle2, LoaderCircle, Square } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { JobStatus } from "@/lib/api/backend-client";
import { cn } from "@/lib/utils";

export interface AdminTaskProgressState {
  status: JobStatus;
  taskName?: string;
  message?: string;
  stage?: string;
  current?: number;
  total?: number;
}

interface AdminTaskProgressProps {
  progress: AdminTaskProgressState;
  onCancel?: () => void;
}

function progressLabel(progress: AdminTaskProgressState): string {
  if (
    progress.status === "running" &&
    typeof progress.current === "number" &&
    typeof progress.total === "number" &&
    progress.total > 0
  ) {
    return `正在处理 ${progress.current} / ${progress.total}`;
  }
  if (progress.status === "running") {
    return "正在处理中";
  }
  if (progress.status === "succeeded") {
    return "已完成";
  }
  if (progress.status === "cancelled") {
    return "已停止";
  }
  if (progress.status === "failed") {
    return "执行失败";
  }
  return "暂无活动任务";
}

export function AdminTaskProgress({ progress, onCancel }: AdminTaskProgressProps) {
  const determinate =
    progress.status === "running" &&
    typeof progress.current === "number" &&
    typeof progress.total === "number" &&
    progress.total > 0;
  const percent = determinate
    ? Math.max(0, Math.min(100, Math.round((progress.current! / progress.total!) * 100)))
    : progress.status === "succeeded"
      ? 100
      : progress.status === "failed" || progress.status === "cancelled"
        ? 100
        : 0;

  return (
    <section className="mt-6 rounded-xl border border-[#E4E9F0] bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div
            className={cn(
              "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full",
              progress.status === "running" && "bg-blue-50 text-blue-600",
              progress.status === "succeeded" && "bg-emerald-50 text-emerald-600",
              (progress.status === "failed" || progress.status === "cancelled") && "bg-red-50 text-red-600",
              progress.status === "idle" && "bg-slate-100 text-slate-500",
            )}
          >
            {progress.status === "running" ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : progress.status === "succeeded" ? (
              <CheckCircle2 className="size-4" />
            ) : progress.status === "failed" || progress.status === "cancelled" ? (
              <AlertCircle className="size-4" />
            ) : (
              <LoaderCircle className="size-4" />
            )}
          </div>
          <div className="space-y-1">
            <div className="text-sm font-semibold text-[#172033]">
              {progress.taskName || "统一任务进度"}
            </div>
            <div className="text-sm text-[#667085]">
              {progress.message || "当前没有运行中的任务"}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <div className="text-sm font-medium text-[#35537A]">{progressLabel(progress)}</div>
          {onCancel && progress.status === "running" && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onCancel}
              className="h-7 gap-1.5 border-rose-200 px-2.5 text-xs text-rose-600 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700"
            >
              <Square className="size-3 fill-current" />
              终止运行
            </Button>
          )}
        </div>
      </div>

      <div className="mt-4">
        <div className="relative h-3 overflow-hidden rounded-full bg-[#E9EEF5]">
          {determinate || progress.status === "succeeded" || progress.status === "failed" || progress.status === "cancelled" ? (
            <div
              className={cn(
                "h-full rounded-full transition-[width] duration-300",
                progress.status === "failed" || progress.status === "cancelled"
                  ? "bg-gradient-to-r from-rose-500 to-red-500"
                  : progress.status === "succeeded"
                    ? "bg-gradient-to-r from-emerald-500 to-teal-500"
                    : "bg-gradient-to-r from-[#1F6FE5] via-[#4F9DF7] via-[#7AC5FF] via-[#4F9DF7] to-[#1F6FE5] animate-progress-flow",
              )}
              style={{ width: `${percent}%` }}
            />
          ) : progress.status === "running" ? (
            <div className="admin-progress-indeterminate absolute inset-y-0 left-0 w-1/2 rounded-full bg-gradient-to-r from-[#1F6FE5] via-[#4F9DF7] via-[#7AC5FF] via-[#4F9DF7] to-[#1F6FE5] animate-progress-flow" />
          ) : (
            <div className="h-full w-0 bg-slate-200" />
          )}
        </div>
        <div className="mt-2 text-xs text-[#667085]">
          {progress.status === "idle"
            ? "等待管理员启动任务"
            : progress.message || progressLabel(progress)}
        </div>
      </div>
    </section>
  );
}
