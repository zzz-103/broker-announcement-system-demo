"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { JobStatus } from "@/lib/api/backend-client";
import { copyTextToClipboard } from "@/lib/clipboard";
import { cn } from "@/lib/utils";

export interface AdminTaskLogLine {
  stream: "stdout" | "stderr" | "system";
  message: string;
}

interface AdminTaskLogDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  status: JobStatus;
  logs: AdminTaskLogLine[];
}

function statusText(status: JobStatus): string {
  if (status === "running") return "运行中";
  if (status === "succeeded") return "已完成";
  if (status === "failed") return "失败";
  return "空闲";
}

function streamText(stream: AdminTaskLogLine["stream"]): string {
  if (stream === "stdout") return "STDOUT";
  if (stream === "stderr") return "STDERR";
  return "SYSTEM";
}

export function AdminTaskLogDialog({
  open,
  onOpenChange,
  title,
  status,
  logs,
}: AdminTaskLogDialogProps) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const shouldStickRef = useRef(true);

  const renderedLogs = useMemo(
    () => logs.map((log) => `[${streamText(log.stream)}] ${log.message}`).join("\n"),
    [logs],
  );
  const logGroups = useMemo(() => {
    const jincai: AdminTaskLogLine[] = [];
    const direct: AdminTaskLogLine[] = [];
    const common: AdminTaskLogLine[] = [];
    for (const log of logs) {
      if (
        log.message.startsWith("[jincai:") ||
        log.message.startsWith("[procurement-scraper]") ||
        log.message.startsWith("[result-scraper]")
      ) {
        jincai.push(log);
      } else if (
        log.message.startsWith("[direct]") ||
        log.message.startsWith("[official-source]")
      ) {
        direct.push(log);
      } else {
        common.push(log);
      }
    }
    return { jincai, direct, common };
  }, [logs]);
  const hasCollectionLanes =
    logGroups.jincai.length > 0 || logGroups.direct.length > 0;

  useEffect(() => {
    if (!open) {
      shouldStickRef.current = true;
    }
  }, [open]);

  useEffect(() => {
    if (!open || !shouldStickRef.current) return;
    const container = containerRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, [logs, open]);

  useEffect(() => {
    if (copyState === "idle") return;
    const timer = window.setTimeout(() => setCopyState("idle"), 2000);
    return () => window.clearTimeout(timer);
  }, [copyState]);

  const handleScroll = () => {
    const container = containerRef.current;
    if (!container) return;
    const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    shouldStickRef.current = distanceToBottom < 24;
  };

  const handleCopy = async () => {
    if (!renderedLogs) return;
    const copied = await copyTextToClipboard(renderedLogs);
    setCopyState(copied ? "copied" : "failed");
  };

  const renderLogList = (items: AdminTaskLogLine[]) =>
    items.length === 0 ? (
      <div className="rounded-lg border border-dashed border-[#D9E2EC] bg-[#F8FAFC] px-4 py-6 text-center text-[#94A3B8]">
        等待日志
      </div>
    ) : (
      <div className="space-y-2">
        {items.map((log, index) => (
          <div
            key={`${log.stream}-${index}-${log.message}`}
            className="flex items-start gap-3 rounded-lg border border-[#EEF2F6] bg-[#FBFCFE] px-3 py-2"
          >
            <span
              className={cn(
                "mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold",
                log.stream === "stdout" && "bg-blue-50 text-blue-700",
                log.stream === "stderr" && "bg-rose-50 text-rose-700",
                log.stream === "system" && "bg-slate-100 text-slate-600",
              )}
            >
              {streamText(log.stream)}
            </span>
            <span className="min-w-0 whitespace-pre-wrap break-words text-[#24364D]">
              {log.message}
            </span>
          </div>
        ))}
      </div>
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl border-[#D9E2EC] p-0 sm:max-w-4xl">
        <DialogHeader className="border-b border-[#E4E9F0] px-6 py-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1 text-left">
              <DialogTitle className="text-base text-[#172033]">{title}</DialogTitle>
              <DialogDescription className="text-[#667085]">
                当前状态：{statusText(status)}
              </DialogDescription>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleCopy}
              disabled={!renderedLogs}
              className="border-[#D0D8E2] text-[#35537A]"
            >
              {copyState === "copied"
                ? "已复制"
                : copyState === "failed"
                  ? "复制失败"
                  : "复制日志"}
            </Button>
          </div>
        </DialogHeader>

        <div
          ref={containerRef}
          onScroll={handleScroll}
          className="max-h-[65vh] overflow-y-auto px-6 py-5 font-mono text-xs leading-6"
        >
          {logs.length === 0 ? (
            <div className="rounded-lg border border-dashed border-[#D9E2EC] bg-[#F8FAFC] px-4 py-6 text-center text-[#94A3B8]">
              暂无可查看的任务日志
            </div>
          ) : hasCollectionLanes ? (
            <div className="space-y-5">
              <div className="grid gap-4 lg:grid-cols-2">
                <section>
                  <h3 className="mb-2 text-xs font-semibold text-[#35537A]">金采网进度</h3>
                  {renderLogList(logGroups.jincai)}
                </section>
                <section>
                  <h3 className="mb-2 text-xs font-semibold text-[#35537A]">官网直采进度</h3>
                  {renderLogList(logGroups.direct)}
                </section>
              </div>
              {logGroups.common.length > 0 && (
                <section>
                  <h3 className="mb-2 text-xs font-semibold text-[#35537A]">后续处理日志</h3>
                  {renderLogList(logGroups.common)}
                </section>
              )}
            </div>
          ) : (
            renderLogList(logs)
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
