"use client";

import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type {
  CustomIntelligenceOptionsResponse,
  InstantSearchRequest,
} from "@/lib/api/contracts";
import { ConfigFields, FieldLabel } from "./config-fields";
import { FIELD_INPUT_CLASS } from "./custom-intelligence-constants";
import { KeywordSuggestionPicker } from "./keyword-suggestion-picker";

export interface SavedConfigDialogProps {
  open: boolean;
  saving: boolean;
  editorId: number | null;
  name: string;
  draft: InstantSearchRequest;
  options: CustomIntelligenceOptionsResponse;
  analysisAvailable: boolean;
  suggesting: boolean;
  keywordSuggestions: string[];
  selectedSuggestions: string[];
  onOpenChange: (open: boolean) => void;
  onNameChange: (value: string) => void;
  onDraftChange: (value: InstantSearchRequest) => void;
  onRequestSuggestions: () => void;
  onSelectedSuggestionsChange: (value: string[]) => void;
  onMergeSuggestions: () => void;
  onSave: () => void;
}

export function SavedConfigDialog({
  open,
  saving,
  editorId,
  name,
  draft,
  options,
  analysisAvailable,
  suggesting,
  keywordSuggestions,
  selectedSuggestions,
  onOpenChange,
  onNameChange,
  onDraftChange,
  onRequestSuggestions,
  onSelectedSuggestionsChange,
  onMergeSuggestions,
  onSave,
}: SavedConfigDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="flex w-[calc(100%-1rem)] max-h-[calc(100dvh-1rem)] max-w-[900px] flex-col gap-0 overflow-hidden border-[#D9E2EC] bg-white p-0 sm:w-[calc(100%-2rem)] sm:max-h-[calc(100dvh-2rem)] sm:!max-w-[900px]">
        <DialogHeader className="shrink-0 border-b border-[#E4EAF2] bg-[#F8FAFD] px-4 py-4 pr-12 sm:px-6 sm:py-5">
          <DialogTitle className="text-base text-[#172033]">{editorId === null ? "保存搜索配置" : "编辑已保存配置"}</DialogTitle>
          <DialogDescription className="text-[#667085]">配置保存后可在“已保存配置”中载入、编辑、停用或删除。</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-5">
          <div className="mb-4">
            <FieldLabel hint="必填">配置名称</FieldLabel>
            <input value={name} onChange={(event) => onNameChange(event.target.value)} maxLength={120} placeholder="例如：券商财富管理竞争监测" className={FIELD_INPUT_CLASS} />
          </div>
          <div className="mb-4">
            <FieldLabel hint="可选">业务问题</FieldLabel>
            <textarea value={draft.question} onChange={(event) => onDraftChange({ ...draft, question: event.target.value })} rows={2} maxLength={1000} placeholder="载入配置时自动填充到即时搜索表单" className="w-full resize-y rounded-md border border-[#D0D5DD] bg-white px-3 py-2.5 text-sm leading-6 text-[#172033] outline-none transition focus:border-[#4F7CFF] focus:ring-2 focus:ring-[#4F7CFF]/15" />
          </div>
          <ConfigFields value={draft} onChange={onDraftChange} options={options} showQuestion={false} />
          <KeywordSuggestionPicker
            title="生成的关键词"
            description="根据配置描述、已有关键词和关注对象生成，确认后才合并。"
            suggestions={keywordSuggestions}
            selected={selectedSuggestions}
            variant="dialog"
            generateAction={(
              <button type="button" onClick={() => void onRequestSuggestions()} disabled={suggesting || !analysisAvailable} className="inline-flex items-center gap-1.5 rounded-md border border-[#C8D7F0] bg-white px-2.5 py-1.5 text-[11px] font-semibold text-[#315EA8] disabled:opacity-50">
                {suggesting ? "生成中…" : "补充关键词"}
              </button>
            )}
            onSelectionChange={onSelectedSuggestionsChange}
            onMerge={onMergeSuggestions}
          />
        </div>
        <DialogFooter className="relative z-10 shrink-0 border-t border-[#E4EAF2] bg-[#FBFCFE] px-4 py-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-4">
          <button type="button" onClick={() => onOpenChange(false)} disabled={saving} className="rounded-md border border-[#D0D5DD] px-3.5 py-2 text-sm font-semibold text-[#475467] hover:bg-white">取消</button>
          <button type="button" onClick={() => void onSave()} disabled={saving || !name.trim()} className="inline-flex items-center gap-1.5 rounded-md bg-[#2563EB] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-50">{saving && <Loader2 className="size-4 animate-spin" />}保存配置</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
