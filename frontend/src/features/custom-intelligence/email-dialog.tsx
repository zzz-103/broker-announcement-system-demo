"use client";

import { Loader2, Mail, Plus, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { HoverSelect } from "@/components/hover-select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { IntelligenceAssistantExecution } from "@/lib/api/contracts";
import { FIELD_INPUT_CLASS } from "./custom-intelligence-constants";

const MAX_RECIPIENTS = 5;
const COMPANY_DOMAIN = "csco.com.cn";
const COMMON_DOMAINS = [COMPANY_DOMAIN, "126.com", "163.com", "qq.com"] as const;
const DOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/i;
const EMAIL_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

function normalizeDomain(value: string): string {
  return value.trim().replace(/^@+/, "").toLowerCase();
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
  onSend: (recipients: string[], note: string, externalConfirmed: boolean) => Promise<void>;
}) {
  const [localPart, setLocalPart] = useState("");
  const [domainChoice, setDomainChoice] = useState<string>(COMPANY_DOMAIN);
  const [customDomain, setCustomDomain] = useState("");
  const [recipients, setRecipients] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [confirmExternal, setConfirmExternal] = useState(false);

  const reset = useCallback(() => {
    setLocalPart("");
    setDomainChoice(COMPANY_DOMAIN);
    setCustomDomain("");
    setRecipients([]);
    setNote("");
    setError("");
    setConfirmExternal(false);
  }, []);

  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  const close = (next: boolean) => {
    if (sending) return;
    if (!next) reset();
    onOpenChange(next);
  };

  const addRecipient = () => {
    if (sending) return;
    if (recipients.length >= MAX_RECIPIENTS) {
      setError(`单次最多添加 ${MAX_RECIPIENTS} 个收件人。`);
      return;
    }

    let username = localPart.trim();
    let domain = domainChoice === "custom" ? normalizeDomain(customDomain) : domainChoice;
    if (username.includes("@")) {
      const parts = username.split("@");
      if (parts.length !== 2) {
        setError("邮箱格式不正确，请检查用户名和后缀。");
        return;
      }
      [username, domain] = [parts[0].trim(), normalizeDomain(parts[1])];
      if ((COMMON_DOMAINS as readonly string[]).includes(domain)) {
        setDomainChoice(domain);
        setCustomDomain("");
      } else {
        setDomainChoice("custom");
        setCustomDomain(domain);
      }
    }

    if (!username || /[\s@<>]/.test(username)) {
      setError("请输入有效的邮箱用户名。");
      return;
    }
    if (!DOMAIN_PATTERN.test(domain)) {
      setError("请输入有效的邮箱后缀，例如 example.com。");
      return;
    }
    const recipient = `${username}@${domain}`.toLowerCase();
    if (!EMAIL_PATTERN.test(recipient)) {
      setError("邮箱格式不正确，请检查后再添加。");
      return;
    }
    if (recipients.some((item) => item.toLowerCase() === recipient)) {
      setError("该收件人已经添加。");
      return;
    }
    setRecipients((current) => [...current, recipient]);
    setLocalPart("");
    setError("");
    setConfirmExternal(false);
  };

  const removeRecipient = (recipient: string) => {
    setRecipients((current) => current.filter((item) => item !== recipient));
    setError("");
    setConfirmExternal(false);
  };

  const external = recipients.filter((recipient) => !recipient.endsWith(`@${COMPANY_DOMAIN}`));
  const submit = async () => {
    if (!execution || sending) return;
    if (localPart.trim()) {
      setError("还有未添加的邮箱，请先点击“添加”。");
      return;
    }
    if (!recipients.length) {
      setError("请至少添加一个收件人。");
      return;
    }
    if (external.length > 0 && !confirmExternal) {
      setConfirmExternal(true);
      return;
    }
    await onSend(recipients, note.trim(), external.length > 0);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="w-[calc(100%-1rem)] max-w-xl border-[#D9E2EC] bg-white sm:w-full">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base text-[#172033]"><Mail className="size-4 text-[#315EA8]" />发送情报报告</DialogTitle>
          <DialogDescription className="text-[#667085]">邮件将包含完整报告正文，并同时附带 PDF。</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <div className="mb-1.5 flex items-center justify-between gap-3">
              <label htmlFor="assistant-email-local-part" className="text-xs font-semibold text-[#344054]">收件人<span className="ml-0.5 text-sm font-bold text-red-500" aria-hidden="true">*</span><span className="sr-only">（必填）</span></label>
              <span className="text-[10px] tabular-nums text-[#98A2B3]">{recipients.length}/{MAX_RECIPIENTS}</span>
            </div>
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_160px_auto]">
              <input
                id="assistant-email-local-part"
                value={localPart}
                onChange={(event) => { setLocalPart(event.target.value); setError(""); setConfirmExternal(false); }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addRecipient();
                  }
                }}
                disabled={sending || recipients.length >= MAX_RECIPIENTS}
                placeholder="邮箱用户名或完整邮箱"
                autoComplete="off"
                className={FIELD_INPUT_CLASS}
              />
              <HoverSelect
                value={domainChoice}
                onChange={(value) => { if (!sending) { setDomainChoice(value); setError(""); setConfirmExternal(false); } }}
                options={[
                  ...COMMON_DOMAINS.map((domain) => ({ value: domain, label: `@${domain}` })),
                  { value: "custom", label: "自定义后缀" },
                ]}
                placeholder="邮箱后缀"
                className={`w-full ${sending || recipients.length >= MAX_RECIPIENTS ? "pointer-events-none opacity-50" : ""}`}
              />
              <button
                type="button"
                onClick={addRecipient}
                disabled={sending || recipients.length >= MAX_RECIPIENTS}
                className="inline-flex items-center justify-center gap-1.5 rounded-md bg-[#2563EB] px-3 py-2 text-sm font-semibold text-white hover:bg-[#1D4ED8] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus className="size-3.5" aria-hidden="true" />添加
              </button>
            </div>
            {domainChoice === "custom" && (
              <input
                value={customDomain}
                onChange={(event) => { setCustomDomain(event.target.value); setError(""); setConfirmExternal(false); }}
                disabled={sending || recipients.length >= MAX_RECIPIENTS}
                placeholder="自定义后缀，例如 example.com"
                aria-label="自定义邮箱后缀"
                className={`${FIELD_INPUT_CLASS} mt-2`}
              />
            )}
            <div className="mt-2 flex flex-wrap items-center gap-1.5" aria-label="常用邮箱后缀">
              <span className="mr-0.5 text-[10px] text-[#98A2B3]">快速切换</span>
              {COMMON_DOMAINS.map((domain) => (
                <button
                  key={domain}
                  type="button"
                  onClick={() => { setDomainChoice(domain); setCustomDomain(""); setError(""); setConfirmExternal(false); }}
                  disabled={sending}
                  className={`rounded-full border px-2 py-1 text-[10px] ${domainChoice === domain ? "border-[#8BADE4] bg-[#EEF4FF] text-[#315EA8]" : "border-[#E4EAF2] bg-white text-[#667085] hover:border-[#BFD2F3]"}`}
                >
                  @{domain}
                </button>
              ))}
            </div>
            {recipients.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2" aria-label="已添加收件人">
                {recipients.map((recipient) => (
                  <span key={recipient} className="group inline-flex items-center gap-1.5 rounded-full border border-[#BFD2F3] bg-[#EEF4FF] py-1 pl-2.5 pr-1.5 text-[11px] text-[#2455AC]">
                    {recipient}
                    <button type="button" onClick={() => removeRecipient(recipient)} disabled={sending} aria-label={`删除收件人 ${recipient}`} className="rounded-full p-0.5 text-[#6F8FC5] opacity-70 hover:bg-white hover:text-[#2455AC] hover:opacity-100 focus-visible:bg-white focus-visible:opacity-100">
                      <X className="size-3" aria-hidden="true" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between gap-3">
              <label htmlFor="assistant-email-note" className="text-xs font-semibold text-[#344054]">附言 <span className="font-normal text-[#98A2B3]">（可选）</span></label>
              <span className="text-[10px] tabular-nums text-[#98A2B3]">{note.length}/500</span>
            </div>
            <textarea
              id="assistant-email-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={500}
              rows={3}
              disabled={sending}
              placeholder="例如：你好，请看一下这份报告。"
              className={`${FIELD_INPUT_CLASS} resize-y leading-6`}
            />
          </div>

          {confirmExternal && external.length > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-5 text-amber-800">以下地址不属于 @{COMPANY_DOMAIN}：{external.join("、")}。确认仍要发送吗？</div>
          )}
          {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
        </div>

        <DialogFooter>
          <button type="button" onClick={() => close(false)} disabled={sending} className="rounded-md border border-[#D0D5DD] px-3.5 py-2 text-sm font-semibold text-[#475467] hover:bg-[#F8FAFC]">取消</button>
          <button type="button" onClick={() => void submit()} disabled={sending || !execution || recipients.length === 0} className="inline-flex items-center gap-1.5 rounded-md bg-[#2563EB] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1D4ED8] disabled:cursor-not-allowed disabled:opacity-50">
            {sending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}{confirmExternal ? "确认发送" : "发送报告"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
