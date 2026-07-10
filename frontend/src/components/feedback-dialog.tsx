"use client";

import { useEffect, useState } from "react";
import { Building2, CheckCircle2, DatabaseZap, Lightbulb, Send } from "lucide-react";
import {
  BackendApiError,
  type FeedbackCategory,
  submitFeedback,
} from "@/lib/api/backend-client";
import { useAuthStore } from "@/store/auth-store";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface FeedbackDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialCategory?: FeedbackCategory;
  initialBrokerName?: string;
}

const CATEGORY_OPTIONS: Array<{
  value: FeedbackCategory;
  label: string;
  description: string;
  icon: typeof Building2;
}> = [
  { value: "broker_request", label: "补充券商", description: "希望新增关注的券商", icon: Building2 },
  { value: "data_issue", label: "数据问题", description: "发现缺失或不准确的数据", icon: DatabaseZap },
  { value: "product_suggestion", label: "产品建议", description: "改进看板体验与功能", icon: Lightbulb },
];

function errorMessage(error: unknown) {
  if (error instanceof BackendApiError) {
    return error.status === 0 ? "无法连接 FastAPI 后端，请确认服务已启动" : error.message;
  }
  return "提交失败，请稍后重试";
}

export function FeedbackDialog({
  open,
  onOpenChange,
  initialCategory,
  initialBrokerName,
}: FeedbackDialogProps) {
  const { token, clearAuth } = useAuthStore();
  const [category, setCategory] = useState<FeedbackCategory | null>(null);
  const [brokerName, setBrokerName] = useState("");
  const [message, setMessage] = useState("");
  const [relatedContext, setRelatedContext] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCategory(initialCategory ?? null);
    setBrokerName(initialBrokerName ?? "");
    setMessage("");
    setRelatedContext("");
    setError("");
    setSubmitted(false);
  }, [initialBrokerName, initialCategory, open]);

  const selectCategory = (value: FeedbackCategory) => {
    setCategory(value);
    setError("");
  };

  const handleSubmit = async () => {
    if (!token || !category || isSubmitting) return;
    const normalizedBrokerName = brokerName.trim();
    const normalizedMessage = message.trim();
    if (category === "broker_request" && !normalizedBrokerName) {
      setError("请填写希望收录的券商名称。");
      return;
    }
    if (category !== "broker_request" && !normalizedMessage) {
      setError("请简要描述你遇到的问题或建议。");
      return;
    }

    setError("");
    setIsSubmitting(true);
    try {
      await submitFeedback(token, {
        category,
        broker_name: normalizedBrokerName,
        message: normalizedMessage,
        related_context: relatedContext.trim(),
      });
      setSubmitted(true);
    } catch (submitError) {
      if (submitError instanceof BackendApiError && submitError.status === 401) {
        clearAuth("登录已失效，请重新登录");
      } else {
        setError(errorMessage(submitError));
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-[#D9E2EC] bg-white sm:max-w-lg">
        {submitted ? (
          <div className="py-5 text-center">
            <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
              <CheckCircle2 className="size-6" />
            </div>
            <DialogTitle className="text-[#172033]">反馈已提交</DialogTitle>
            <p className="mt-2 text-sm text-[#667085]">感谢你的反馈，管理员将在控制台统一查看和处理。</p>
            <button type="button" onClick={() => onOpenChange(false)} className="mt-5 h-10 rounded-lg bg-[#2563EB] px-5 text-sm font-semibold text-white hover:bg-blue-700">完成</button>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="text-[#172033]">提交反馈</DialogTitle>
              <DialogDescription className="text-[#667085]">选择反馈类型后，只填写最关键的信息即可。</DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              {CATEGORY_OPTIONS.map((option) => {
                const Icon = option.icon;
                const selected = category === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => selectCategory(option.value)}
                    className={`rounded-xl border p-3 text-left transition-all ${selected ? "border-[#93B4F8] bg-blue-50/70 text-[#1D4ED8] shadow-[0_1px_4px_rgba(37,99,235,0.10)]" : "border-[#E4E9F0] bg-white text-[#475467] hover:border-[#B8CCF8] hover:bg-[#F8FAFC]"}`}
                  >
                    <Icon className="mb-2 size-4" />
                    <span className="block text-sm font-semibold">{option.label}</span>
                    <span className="mt-1 block text-[11px] leading-relaxed text-[#667085]">{option.description}</span>
                  </button>
                );
              })}
            </div>
            {category && (
              <div className="space-y-3 pt-1">
                {category === "broker_request" ? (
                  <>
                    <label className="block text-sm font-medium text-[#344054]">
                      希望收录的券商 <span className="text-rose-600">*</span>
                      <input value={brokerName} onChange={(event) => setBrokerName(event.target.value)} maxLength={100} placeholder="例如：XX证券" className="mt-1.5 h-10 w-full rounded-lg border border-[#D0D5DD] px-3 text-sm text-[#172033] outline-none transition-all focus:border-[#2563EB] focus:ring-4 focus:ring-[#2563EB]/10" />
                    </label>
                    <label className="block text-sm font-medium text-[#344054]">
                      补充说明（选填）
                      <textarea value={message} onChange={(event) => setMessage(event.target.value)} maxLength={1000} rows={3} placeholder="例如：希望跟踪其金融科技采购公告" className="mt-1.5 w-full resize-none rounded-lg border border-[#D0D5DD] px-3 py-2 text-sm text-[#172033] outline-none transition-all focus:border-[#2563EB] focus:ring-4 focus:ring-[#2563EB]/10" />
                    </label>
                  </>
                ) : (
                  <>
                    <label className="block text-sm font-medium text-[#344054]">
                      {category === "data_issue" ? "数据问题" : "你的建议"} <span className="text-rose-600">*</span>
                      <textarea value={message} onChange={(event) => setMessage(event.target.value)} maxLength={1000} rows={4} placeholder={category === "data_issue" ? "请简要说明缺失或不准确的数据" : "请简要描述你希望改进的功能或体验"} className="mt-1.5 w-full resize-none rounded-lg border border-[#D0D5DD] px-3 py-2 text-sm text-[#172033] outline-none transition-all focus:border-[#2563EB] focus:ring-4 focus:ring-[#2563EB]/10" />
                    </label>
                    <label className="block text-sm font-medium text-[#344054]">
                      关联券商或项目（选填）
                      <input value={relatedContext} onChange={(event) => setRelatedContext(event.target.value)} maxLength={200} placeholder="例如：XX证券 / 某采购项目" className="mt-1.5 h-10 w-full rounded-lg border border-[#D0D5DD] px-3 text-sm text-[#172033] outline-none transition-all focus:border-[#2563EB] focus:ring-4 focus:ring-[#2563EB]/10" />
                    </label>
                  </>
                )}
                {error && <p className="text-xs font-medium text-rose-600">{error}</p>}
              </div>
            )}
            <DialogFooter>
              <button type="button" onClick={() => onOpenChange(false)} disabled={isSubmitting} className="h-10 rounded-lg border border-[#D0D5DD] px-4 text-sm font-semibold text-[#475467] hover:bg-[#F8FAFC] disabled:opacity-60">取消</button>
              <button type="button" onClick={() => void handleSubmit()} disabled={!category || isSubmitting} className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-[#2563EB] px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60">
                <Send className="size-3.5" />
                {isSubmitting ? "正在提交..." : "提交反馈"}
              </button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
