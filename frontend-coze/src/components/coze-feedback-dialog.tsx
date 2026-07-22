"use client";

import { FormEvent, useState } from "react";
import { X } from "lucide-react";
import { submitDemoFeedback, type DemoUser } from "@/lib/local-platform-service";

export function CozeFeedbackDialog({ user, open, onClose }: { user: DemoUser; open: boolean; onClose: () => void }) {
  const [category, setCategory] = useState<"broker_request" | "data_issue" | "product_suggestion">("data_issue");
  const [brokerName, setBrokerName] = useState("");
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);
  if (!open) return null;
  function submit(event: FormEvent) {
    event.preventDefault();
    submitDemoFeedback({ userId: user.id, category, brokerName, message, relatedContext: "" });
    setSent(true); setMessage("");
  }
  return <><div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} /><section className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white p-6 shadow-xl"><div className="flex items-center justify-between"><h2 className="font-bold text-[#172033]">提交反馈</h2><button onClick={onClose} aria-label="关闭"><X className="h-4 w-4" /></button></div>{sent ? <div className="py-10 text-center text-sm text-emerald-700">反馈已保存到本浏览器的演示数据中。<button onClick={onClose} className="ml-2 underline">关闭</button></div> : <form onSubmit={submit} className="mt-5 space-y-4"><select value={category} onChange={(event) => setCategory(event.target.value as typeof category)} className="h-10 w-full rounded-lg border px-3 text-sm"><option value="data_issue">数据问题</option><option value="broker_request">补充券商</option><option value="product_suggestion">产品建议</option></select><input value={brokerName} onChange={(event) => setBrokerName(event.target.value)} placeholder="相关券商（可选）" className="h-10 w-full rounded-lg border px-3 text-sm" /><textarea required value={message} onChange={(event) => setMessage(event.target.value)} placeholder="请填写反馈内容" rows={5} className="w-full rounded-lg border px-3 py-2 text-sm" /><button className="w-full rounded-lg bg-[#162B49] px-4 py-2.5 text-sm font-semibold text-white">提交</button></form>}</section></>;
}
