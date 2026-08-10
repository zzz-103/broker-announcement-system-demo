"use client";

import { Loader2, Mail, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { IntelligenceAssistantExecution } from "@/lib/api/contracts";
import { FIELD_INPUT_CLASS } from "./custom-intelligence-constants";

function parseRecipients(value: string): string[] {
  return Array.from(new Set(value.split(/[\s,;，；]+/).map((item) => item.trim().toLowerCase()).filter(Boolean)));
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function EmailDialog({
  execution,
  open,
  sending,
  onOpenChange,
  onSend,
}: {
  execution: IntelligenceAssistantExecution | null;
  open: boolean;
  sending: boolean;
  onOpenChange: (open: boolean) => void;
  onSend: (recipients: string[], format: "html" | "pdf", externalConfirmed: boolean) => Promise<void>;
}) {
  const [draft, setDraft] = useState("");
  const [format, setFormat] = useState<"html" | "pdf">("html");
  const [error, setError] = useState("");
  const [confirmExternal, setConfirmExternal] = useState(false);
  const recipients = useMemo(() => parseRecipients(draft), [draft]);
  const external = recipients.filter((recipient) => !recipient.endsWith("@csco.com.cn"));
  const valid = recipients.length > 0 && recipients.length <= 5 && recipients.every(isEmail);
  useEffect(() => {
    if (!open) {
      setDraft("");
      setFormat("html");
      setError("");
      setConfirmExternal(false);
    }
  }, [open]);
  const close = (next: boolean) => {
    if (sending) return;
    if (!next) {
      setDraft("");
      setError("");
      setConfirmExternal(false);
    }
    onOpenChange(next);
  };
  const submit = async () => {
    if (!execution || sending) return;
    if (!valid) {
      setError(recipients.length > 5 ? "最多填写 5 个收件人。" : "请输入有效的邮箱地址。多个地址请用空格或逗号分隔。");
      return;
    }
    if (external.length > 0 && !confirmExternal) {
      setConfirmExternal(true);
      return;
    }
    await onSend(recipients, format, external.length > 0);
  };
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="w-[calc(100%-1rem)] max-w-lg border-[#D9E2EC] bg-white sm:w-full">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base text-[#172033]"><Mail className="size-4 text-[#315EA8]" />发送情报报告</DialogTitle>
          <DialogDescription className="text-[#667085]">报告会按选定格式发送到收件人。公司外部地址需要再次确认。</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <label htmlFor="assistant-email-recipients" className="mb-1.5 block text-xs font-semibold text-[#344054]">收件人 <span className="font-normal text-[#98A2B3]">最多 5 个</span></label>
            <textarea id="assistant-email-recipients" value={draft} onChange={(event) => { setDraft(event.target.value); setError(""); setConfirmExternal(false); }} rows={3} placeholder="name@csco.com.cn，可用空格或逗号分隔" className={FIELD_INPUT_CLASS} />
            {recipients.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{recipients.map((recipient) => <button key={recipient} type="button" onClick={() => { setDraft(recipients.filter((item) => item !== recipient).join(", ")); setConfirmExternal(false); }} aria-label={`移除收件人 ${recipient}`} className="inline-flex items-center gap-1 rounded bg-[#EEF4FF] px-2 py-1 text-[11px] text-[#315EA8] hover:bg-[#DCE8FF]">{recipient}<X className="size-3" aria-hidden="true" /></button>)}</div>}
          </div>
          <fieldset>
            <legend className="mb-1.5 text-xs font-semibold text-[#344054]">发送格式</legend>
            <div className="grid grid-cols-2 gap-2">
              {(["html", "pdf"] as const).map((item) => <label key={item} className={`cursor-pointer rounded-md border px-3 py-2.5 text-xs ${format === item ? "border-[#4F7CFF] bg-[#EEF4FF] text-[#2455AC]" : "border-[#E4EAF2] text-[#475467]"}`}><input type="radio" name="assistant-email-format" value={item} checked={format === item} onChange={() => setFormat(item)} className="sr-only" />{item === "html" ? "邮件正文（HTML）" : "PDF 附件"}</label>)}
            </div>
          </fieldset>
          {confirmExternal && external.length > 0 && <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-5 text-amber-800">以下地址不属于 @csco.com.cn：{external.join("、")}。确认仍要发送吗？</div>}
          {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
        </div>
        <DialogFooter>
          <button type="button" onClick={() => close(false)} disabled={sending} className="rounded-md border border-[#D0D5DD] px-3.5 py-2 text-sm font-semibold text-[#475467] hover:bg-white">取消</button>
          <button type="button" onClick={() => void submit()} disabled={sending || !execution} className="inline-flex items-center gap-1.5 rounded-md bg-[#2563EB] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1D4ED8] disabled:cursor-not-allowed disabled:opacity-50">{sending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}{confirmExternal ? "确认发送" : "发送报告"}</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
