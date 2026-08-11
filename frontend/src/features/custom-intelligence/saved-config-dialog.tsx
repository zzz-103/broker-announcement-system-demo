"use client";

import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { HoverSelect } from "@/components/hover-select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { IntelligenceAssistantRequest } from "@/lib/api/contracts";
import { AUDIENCE_OPTIONS, FIELD_INPUT_CLASS, FOCUS_TAG_LIMIT, FOCUS_TAG_OPTIONS, REPORT_LENGTH_OPTIONS, TIME_RANGE_OPTIONS } from "./custom-intelligence-constants";

function RequiredFieldLabel({ htmlFor, children }: { htmlFor: string; children: ReactNode }) {
  return <label htmlFor={htmlFor} className="mb-1.5 flex items-center text-xs font-semibold text-[#344054]">{children}<span className="ml-0.5 text-sm font-bold text-red-500" aria-hidden="true">*</span><span className="sr-only">（必填）</span></label>;
}

export function SavedConfigDialog({
  open,
  saving,
  editorId,
  name,
  draft,
  onOpenChange,
  onNameChange,
  onDraftChange,
  onSave,
}: {
  open: boolean;
  saving: boolean;
  editorId: number | null;
  name: string;
  draft: IntelligenceAssistantRequest;
  onOpenChange: (open: boolean) => void;
  onNameChange: (value: string) => void;
  onDraftChange: (value: IntelligenceAssistantRequest) => void;
  onSave: () => void;
}) {
  const update = <K extends keyof IntelligenceAssistantRequest>(key: K, value: IntelligenceAssistantRequest[K]) => onDraftChange({ ...draft, [key]: value });
  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="flex max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] max-w-[720px] flex-col gap-0 overflow-hidden border-[#D9E2EC] bg-white p-0 sm:max-h-[calc(100dvh-2rem)] sm:w-[calc(100%-2rem)]">
        <DialogHeader className="shrink-0 border-b border-[#E4EAF2] bg-[#F8FAFD] px-4 py-4 pr-12 sm:px-6">
          <DialogTitle className="text-base text-[#172033]">{editorId === null ? "保存为我的助手" : "编辑我的助手"}</DialogTitle>
          <DialogDescription className="text-[#667085]">保存后可在“我的助手”中再次使用。</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">
          <div className="space-y-4">
            <div><RequiredFieldLabel htmlFor="assistant-config-name">助手名称</RequiredFieldLabel><input id="assistant-config-name" required value={name} onChange={(event) => onNameChange(event.target.value)} maxLength={80} placeholder="例如：财富管理竞争监测" className={FIELD_INPUT_CLASS} /></div>
            <div><RequiredFieldLabel htmlFor="assistant-config-focus">关注内容</RequiredFieldLabel><textarea id="assistant-config-focus" required value={draft.focus} onChange={(event) => update("focus", event.target.value)} rows={3} maxLength={1000} className="w-full resize-y rounded-md border border-[#D0D5DD] px-3 py-2.5 text-sm leading-6 outline-none focus:border-[#4F7CFF] focus:ring-2 focus:ring-[#4F7CFF]/15" /></div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div><RequiredFieldLabel htmlFor="assistant-config-audience">报告受众</RequiredFieldLabel><HoverSelect id="assistant-config-audience" value={draft.audience} onChange={(value) => { const audience = value as IntelligenceAssistantRequest["audience"]; onDraftChange({ ...draft, audience, audience_detail: audience === "custom" ? draft.audience_detail : "" }); }} options={AUDIENCE_OPTIONS.map((option) => ({ value: option.value, label: option.label }))} className="w-full" /></div>
              <div><RequiredFieldLabel htmlFor="assistant-config-time">时间范围</RequiredFieldLabel><HoverSelect id="assistant-config-time" value={draft.time_range} onChange={(value) => update("time_range", value as IntelligenceAssistantRequest["time_range"])} options={TIME_RANGE_OPTIONS.map((option) => ({ value: option.value, label: option.label }))} className="w-full" /></div>
              <div><RequiredFieldLabel htmlFor="assistant-config-length">报告篇幅</RequiredFieldLabel><HoverSelect id="assistant-config-length" value={draft.report_length} onChange={(value) => update("report_length", value as IntelligenceAssistantRequest["report_length"])} options={REPORT_LENGTH_OPTIONS.map((option) => ({ value: option.value, label: option.label }))} className="w-full" /></div>
            </div>
            <fieldset><legend className="mb-1.5 text-xs font-semibold text-[#344054]">研究侧重点 <span className="font-normal text-[#98A2B3]">软偏好，最多 3 个</span></legend><div className="flex flex-wrap gap-1.5">{FOCUS_TAG_OPTIONS.map((tag) => { const selected = draft.focus_tags.includes(tag); return <button key={tag} type="button" aria-pressed={selected} disabled={!selected && draft.focus_tags.length >= FOCUS_TAG_LIMIT} onClick={() => update("focus_tags", selected ? draft.focus_tags.filter((item) => item !== tag) : [...draft.focus_tags, tag])} className={`rounded-full border px-2.5 py-1 text-[11px] ${selected ? "border-[#4F7CFF] bg-[#EEF4FF] text-[#2455AC]" : "border-[#E4EAF2] text-[#667085]"} disabled:opacity-40`}>{tag}</button>; })}</div></fieldset>
            {draft.audience === "custom" && <div><RequiredFieldLabel htmlFor="assistant-config-audience-detail">受众说明</RequiredFieldLabel><input id="assistant-config-audience-detail" required value={draft.audience_detail} onChange={(event) => update("audience_detail", event.target.value)} maxLength={240} className={FIELD_INPUT_CLASS} /></div>}
            <div><label htmlFor="assistant-config-extra" className="mb-1.5 flex items-center justify-between text-xs font-semibold text-[#344054]"><span>额外关注</span><span className="text-[10px] font-normal text-[#98A2B3]">可选</span></label><textarea id="assistant-config-extra" value={draft.extra_focus} onChange={(event) => update("extra_focus", event.target.value)} rows={2} maxLength={600} className="w-full resize-y rounded-md border border-[#D0D5DD] px-3 py-2.5 text-sm leading-6 outline-none focus:border-[#4F7CFF] focus:ring-2 focus:ring-[#4F7CFF]/15" /></div>
          </div>
        </div>
        <DialogFooter className="shrink-0 border-t border-[#E4EAF2] bg-[#FBFCFE] px-4 py-3.5 sm:px-6">
          <button type="button" onClick={() => onOpenChange(false)} disabled={saving} className="rounded-md border border-[#D0D5DD] px-3.5 py-2 text-sm font-semibold text-[#475467]">取消</button>
          <button type="button" onClick={onSave} disabled={saving || !name.trim() || !draft.focus.trim() || (draft.audience === "custom" && !draft.audience_detail.trim())} className="inline-flex items-center gap-1.5 rounded-md bg-[#2563EB] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1D4ED8] disabled:cursor-not-allowed disabled:opacity-50">{saving && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}保存助手</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
