"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, FileText, Loader2, RefreshCw, Users } from "lucide-react";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { HoverSelect } from "@/components/hover-select";
import { ReportBody, ReportTemplateSwitcher } from "@/features/custom-intelligence/report-content";
import {
  BackendApiError,
  getAdminUsers,
  isAbortError,
  type AdminUser,
} from "@/lib/api/backend-client";
import {
  fetchAdminAssistantExecution,
  fetchAdminUserAssistantExecutions,
} from "@/lib/api/custom-intelligence";
import type {
  IntelligenceAdminExecution,
  IntelligenceAdminExecutionSummary,
  IntelligenceAdminExecutionsResponse,
  IntelligenceReportTemplateStyle,
} from "@/lib/api/contracts";
import { formatDateTime } from "@/lib/display";
import { useAuthStore } from "@/store/auth-store";

const PAGE_SIZE = 10;
const EMPTY_META: IntelligenceAdminExecutionsResponse["meta"] = {
  page: 1,
  page_size: PAGE_SIZE,
  total: 0,
  total_pages: 1,
};

function statusLabel(status: string): string {
  if (status === "pending" || status === "running") return "生成中";
  if (status === "succeeded") return "已完成";
  if (status === "empty") return "无结果";
  return "生成失败";
}

function statusClass(status: string): string {
  if (status === "pending" || status === "running") return "bg-blue-50 text-blue-700";
  if (status === "succeeded") return "bg-emerald-50 text-emerald-700";
  if (status === "empty") return "bg-slate-100 text-slate-600";
  return "bg-red-50 text-red-700";
}

export function IntelligenceReportManager() {
  const { token, clearAuth } = useAuthStore();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [executions, setExecutions] = useState<IntelligenceAdminExecutionSummary[]>([]);
  const [meta, setMeta] = useState<IntelligenceAdminExecutionsResponse["meta"]>(EMPTY_META);
  const [page, setPage] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<IntelligenceAdminExecution | null>(null);
  const [detailLoading, setDetailLoading] = useState<number | null>(null);
  const [templateStyle, setTemplateStyle] = useState<IntelligenceReportTemplateStyle>("research");

  const selectedUser = useMemo(
    () => users.find((user) => user.id === selectedUserId) ?? null,
    [selectedUserId, users],
  );

  const handleError = useCallback((reason: unknown, fallback: string) => {
    if (reason instanceof BackendApiError && reason.status === 401) {
      clearAuth("登录已失效，请重新登录");
      return;
    }
    setError(reason instanceof Error ? reason.message : fallback);
  }, [clearAuth]);

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    setUsersLoading(true);
    setError("");
    void (async () => {
      const allUsers: AdminUser[] = [];
      let nextPage = 1;
      let totalPages = 1;
      do {
        const response = await getAdminUsers(
          token,
          { page: nextPage, pageSize: 100, query: "" },
          controller.signal,
        );
        allUsers.push(...response.users);
        totalPages = response.meta.total_pages;
        nextPage += 1;
      } while (nextPage <= totalPages && !controller.signal.aborted);
      if (!controller.signal.aborted) setUsers(allUsers);
    })().catch((reason: unknown) => {
      if (!isAbortError(reason)) handleError(reason, "无法加载账户列表");
    }).finally(() => {
      if (!controller.signal.aborted) setUsersLoading(false);
    });
    return () => controller.abort();
  }, [handleError, token]);

  useEffect(() => {
    if (!token || selectedUserId === null) {
      setExecutions([]);
      setMeta(EMPTY_META);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void fetchAdminUserAssistantExecutions(
      token,
      selectedUserId,
      page,
      PAGE_SIZE,
      controller.signal,
    ).then((response) => {
      setExecutions(response.executions);
      setMeta(response.meta);
      if (response.meta.page !== page) setPage(response.meta.page);
    }).catch((reason: unknown) => {
      if (!isAbortError(reason)) handleError(reason, "无法加载该账户的情报报告");
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [handleError, page, refreshKey, selectedUserId, token]);

  const openReport = async (executionId: number) => {
    if (!token || detailLoading !== null) return;
    setDetailLoading(executionId);
    setError("");
    try {
      const response = await fetchAdminAssistantExecution(token, executionId);
      setSelected(response.execution);
    } catch (reason) {
      handleError(reason, "无法加载报告详情");
    } finally {
      setDetailLoading(null);
    }
  };

  const changeUser = (value: string) => {
    setSelected(null);
    setExecutions([]);
    setMeta(EMPTY_META);
    setPage(1);
    setSelectedUserId(value ? Number(value) : null);
  };

  return (
    <section className="rounded-lg border border-[#D9E2EC] bg-white shadow-[var(--workspace-shadow)]">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#E4E9F0] p-5">
        <div>
          <h2 className="text-base font-bold text-[#172033]">账户情报报告</h2>
          <p className="mt-1 text-xs text-[#667085]">选择一个账户，只读查看该账户生成的报告及处理状态。</p>
        </div>
        <button
          type="button"
          onClick={() => setRefreshKey((value) => value + 1)}
          disabled={loading || selectedUserId === null}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#D0D5DD] px-3 text-xs font-semibold text-[#475467] disabled:opacity-50"
        >
          <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />刷新
        </button>
      </div>

      <div className="p-5">
        <label className="block max-w-xl">
          <span className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-[#344054]">
            <Users className="size-3.5 text-[#315EA8]" aria-hidden="true" />选择账户
          </span>
          <HoverSelect
            id="admin-intelligence-report-user"
            value={selectedUserId === null ? "" : String(selectedUserId)}
            onChange={changeUser}
            options={users.map((user) => ({
              value: String(user.id),
              label: `${user.name}（${user.username}）${user.role === "admin" ? " · 管理员" : ""}`,
            }))}
            placeholder={usersLoading ? "正在加载账户…" : users.length === 0 ? "暂无可选择账户" : "请选择要查看的用户"}
            disabled={usersLoading || users.length === 0}
            className="w-full"
            maxHeight={320}
          />
        </label>

        {error && <p role="alert" className="mt-4 rounded-md border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}

        <div className="mt-5 border-t border-[#EEF2F6] pt-5">
          {selectedUserId === null ? (
            <p className="rounded-md border border-dashed border-[#D9E2EC] bg-[#F8FAFC] px-3 py-12 text-center text-sm text-[#667085]">请先选择一个用户，再查看其情报报告。</p>
          ) : loading && executions.length === 0 ? (
            <p className="flex items-center gap-2 py-12 text-sm text-[#667085]"><Loader2 className="size-4 animate-spin" />正在加载 {selectedUser?.name || "该用户"} 的报告…</p>
          ) : executions.length === 0 ? (
            <p className="rounded-md bg-[#F8FAFC] px-3 py-12 text-center text-sm text-[#98A2B3]">{selectedUser?.name || "该用户"} 暂无情报报告。</p>
          ) : (
            <div className="space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-[#344054]">{selectedUser?.name} 的报告</p>
                <p className="text-xs text-[#98A2B3]">共 {meta.total} 条</p>
              </div>
              {executions.map((execution) => (
                <article key={execution.id} className="flex flex-col gap-3 rounded-md border border-[#E4EAF2] bg-[#FBFCFE] p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-semibold text-[#344054]">{execution.topic_name || "即时情报报告"}</p>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusClass(execution.status)}`}>{statusLabel(execution.status)}</span>
                    </div>
                    <p className="mt-1 text-[10px] text-[#98A2B3]">检索：{execution.search_status || "—"} · 分析：{execution.analysis_status || "—"} · 来源：{execution.source_count} · {formatDateTime(execution.completed_at || execution.created_at) || "—"}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void openReport(execution.id)}
                    disabled={detailLoading !== null || execution.status === "pending" || execution.status === "running"}
                    className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md border border-[#C8D7F0] px-3 py-2 text-xs font-semibold text-[#315EA8] disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    {detailLoading === execution.id ? <Loader2 className="size-3.5 animate-spin" /> : <FileText className="size-3.5" />}查看报告
                  </button>
                </article>
              ))}
              <div className="flex items-center justify-between border-t border-[#EEF2F6] pt-3 text-xs text-[#667085]">
                <span>第 {meta.page} / {meta.total_pages} 页</span>
                <div className="flex gap-1.5">
                  <button type="button" aria-label="上一页" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={loading || meta.page <= 1} className="inline-flex size-8 items-center justify-center rounded-md border border-[#D0D5DD] disabled:opacity-40"><ChevronLeft className="size-4" /></button>
                  <button type="button" aria-label="下一页" onClick={() => setPage((value) => Math.min(meta.total_pages, value + 1))} disabled={loading || meta.page >= meta.total_pages} className="inline-flex size-8 items-center justify-center rounded-md border border-[#D0D5DD] disabled:opacity-40"><ChevronRight className="size-4" /></button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <Dialog open={selected !== null} onOpenChange={(open) => { if (!open) setSelected(null); }}>
        <DialogContent className="flex h-dvh w-full flex-col gap-0 overflow-hidden rounded-none border-0 bg-white p-0 sm:h-[min(92dvh,900px)] sm:w-[min(1120px,92vw)] sm:max-w-[1120px] sm:rounded-lg sm:border sm:border-[#D9E2EC]">
          <DialogHeader className="shrink-0 border-b border-[#E4EAF2] bg-[#F8FAFD] px-5 py-4 pr-12">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <DialogTitle className="text-lg text-[#172033]">{selected?.report && "title" in selected.report ? selected.report.title || "情报报告" : "情报报告"}</DialogTitle>
                <DialogDescription className="mt-1">生成账户：{selected?.owner_name || selected?.owner_username || "未知账户"} · 只读查看</DialogDescription>
              </div>
              <ReportTemplateSwitcher value={templateStyle} onChange={setTemplateStyle} />
            </div>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto max-w-[880px] px-4 py-6 sm:px-8">{selected && <ReportBody execution={selected} templateStyle={templateStyle} />}</div>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
