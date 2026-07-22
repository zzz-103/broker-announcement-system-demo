"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, MessageSquareText, RefreshCw, RotateCcw } from "lucide-react";
import {
  listDemoFeedback,
  updateDemoFeedbackStatus,
  type FeedbackCategory,
  type FeedbackRecord,
} from "@/lib/local-platform-service";

const CATEGORY_LABEL: Record<FeedbackCategory, string> = {
  broker_request: "补充券商",
  data_issue: "数据问题",
  product_suggestion: "产品建议",
};

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请稍后重试";
}

export function FeedbackManager() {
  const [feedback, setFeedback] = useState<FeedbackRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const loadFeedback = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      setFeedback(await listDemoFeedback());
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFeedback();
  }, [loadFeedback]);

  const toggleStatus = async (entry: FeedbackRecord) => {
    if (updatingId !== null) return;
    const nextStatus = entry.status === "pending" ? "processed" : "pending";
    setUpdatingId(entry.id);
    setError("");
    try {
      await updateDemoFeedbackStatus(entry.id, nextStatus);
      setFeedback(await listDemoFeedback());
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <section className="mt-6 overflow-hidden rounded-xl border border-[#E4E9F0] bg-white shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-[#E4E9F0] px-5 py-4">
        <div className="flex items-center gap-2.5">
          <div className="flex size-9 items-center justify-center rounded-lg bg-blue-50 text-[#2563EB]">
            <MessageSquareText className="size-4" />
          </div>
          <div>
            <h2 className="text-base font-bold text-[#172033]">用户反馈</h2>
            <p className="mt-0.5 text-xs text-[#667085]">待处理反馈优先展示，可标记处理状态</p>
          </div>
        </div>
        <button type="button" onClick={() => void loadFeedback()} disabled={isLoading} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#E4E9F0] px-3 text-xs font-medium text-[#344054] transition-colors hover:bg-[#F5F7FA] disabled:cursor-not-allowed disabled:opacity-60">
          <RefreshCw className={`size-3.5 ${isLoading ? "animate-spin" : ""}`} />
          刷新
        </button>
      </div>
      {error && <p className="mx-5 mt-4 rounded-lg border border-rose-100 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-600">{error}</p>}
      {isLoading && feedback.length === 0 ? (
        <div className="flex items-center justify-center gap-2 px-5 py-10 text-sm text-[#667085]"><Loader2 className="size-4 animate-spin" />正在加载反馈...</div>
      ) : feedback.length === 0 ? (
        <div className="px-5 py-10 text-center text-sm text-[#98A2B3]">暂无用户反馈</div>
      ) : (
        <div className="divide-y divide-[#F0F2F5]">
          {feedback.map((entry) => (
            <article key={entry.id} className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-blue-100 bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">{CATEGORY_LABEL[entry.category]}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${entry.status === "pending" ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>{entry.status === "pending" ? "待处理" : "已处理"}</span>
                  <span className="text-[11px] text-[#98A2B3]">{formatDate(entry.createdAt)}</span>
                </div>
                {(entry.brokerName || entry.relatedContext) && <p className="mt-2 text-sm font-semibold text-[#344054]">{entry.brokerName || entry.relatedContext}</p>}
                {entry.message && <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-[#475467]">{entry.message}</p>}
                <p className="mt-2 text-[11px] text-[#98A2B3]">提交人：本地演示用户（{entry.userId}）</p>
              </div>
              <button type="button" onClick={() => void toggleStatus(entry)} disabled={updatingId !== null} className={`inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${entry.status === "pending" ? "border-emerald-200 text-emerald-700 hover:bg-emerald-50" : "border-[#D0D5DD] text-[#667085] hover:bg-[#F8FAFC]"}`}>
                {updatingId === entry.id ? <Loader2 className="size-3.5 animate-spin" /> : entry.status === "pending" ? <CheckCircle2 className="size-3.5" /> : <RotateCcw className="size-3.5" />}
                {entry.status === "pending" ? "标记已处理" : "恢复待处理"}
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
