"use client";

import { useCallback, useEffect, useState } from "react";
import { Activity, ChevronLeft, ChevronRight, LogIn, QrCode, RefreshCw, Search, UserCheck, UsersRound } from "lucide-react";
import {
  type AuditEventRecord,
  type AuditEventType,
  type AdminListMeta,
  getAuditSummary,
  listAuditEvents,
} from "@/lib/local-platform-service";

const AUDIT_PAGE_SIZE = 20;
const EMPTY_META: AdminListMeta = { page: 1, page_size: AUDIT_PAGE_SIZE, total: 0, total_pages: 1, q: "" };

const EVENT_LABELS: Record<AuditEventType, string> = {
  qr_visit: "二维码访问",
  qualification_application: "资格申请",
  login_success: "成功登录",
  dashboard_view: "进入看板",
};

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}

function eventIdentity(event: AuditEventRecord): string {
  if (event.event_type === "qualification_application") {
    const name = typeof event.metadata.name === "string" ? event.metadata.name : "";
    const email = typeof event.metadata.email === "string" ? event.metadata.email : "";
    return [name, email].filter(Boolean).join(" / ") || "未识别申请人";
  }
  return event.username || "匿名访问";
}

function eventDetail(event: AuditEventRecord): string {
  if (event.event_type === "qualification_application") {
    const department = typeof event.metadata.department === "string" ? event.metadata.department : "";
    const result = typeof event.metadata.result === "string" ? event.metadata.result : "";
    return [department, result].filter(Boolean).join(" · ") || "资格申请";
  }
  return [event.role, event.source].filter(Boolean).join(" · ") || "-";
}

export function AuditRecordsManager() {
  const [summary, setSummary] = useState<Awaited<ReturnType<typeof getAuditSummary>> | null>(null);
  const [events, setEvents] = useState<AuditEventRecord[]>([]);
  const [meta, setMeta] = useState<AdminListMeta>(EMPTY_META);
  const [eventType, setEventType] = useState<AuditEventType | "">("");
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const loadRecords = useCallback(async (requestedPage = page, query = searchQuery) => {
    setIsLoading(true);
    setError("");
    try {
      const [nextSummary, nextEvents] = await Promise.all([
        getAuditSummary(),
        listAuditEvents(eventType, { page: requestedPage, pageSize: AUDIT_PAGE_SIZE, query }),
      ]);
      setSummary(nextSummary);
      setEvents(nextEvents.events);
      setMeta(nextEvents.meta);
      if (nextEvents.meta.page !== page) setPage(nextEvents.meta.page);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法加载访问记录");
    } finally {
      setIsLoading(false);
    }
  }, [eventType, page, searchQuery]);

  useEffect(() => {
    void loadRecords();
  }, [loadRecords]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearchQuery(searchInput.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const cards = [
    { label: "今日二维码访问", value: summary?.today_qr_visits ?? 0, icon: QrCode, color: "text-orange-600 bg-orange-50" },
    { label: "今日资格申请", value: summary?.today_qualification_applicants ?? 0, icon: UserCheck, color: "text-violet-600 bg-violet-50" },
    { label: "今日成功登录", value: summary?.today_login_users ?? 0, icon: LogIn, color: "text-blue-600 bg-blue-50" },
    { label: "今日进入看板", value: summary?.today_dashboard_users ?? 0, icon: UsersRound, color: "text-emerald-600 bg-emerald-50" },
  ];

  return (
    <section className="mt-6 overflow-hidden rounded-xl border border-[#E4E9F0] bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-[#E4E9F0] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex size-9 items-center justify-center rounded-lg bg-gradient-to-br from-[#162B49] to-[#2563EB] shadow-sm">
            <Activity className="size-4 text-white" />
          </div>
          <div>
            <h2 className="text-base font-bold text-[#172033]">访问记录</h2>
            <p className="mt-0.5 text-xs text-[#667085]">今日统计按 {summary?.timezone ?? "Asia/Shanghai"} 时区计算</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={eventType}
            onChange={(event) => {
              setEventType(event.target.value as AuditEventType | "");
              setPage(1);
            }}
            className="h-8 min-w-0 rounded-lg border border-[#E4E9F0] bg-white px-2 text-xs text-[#475467] outline-none focus:border-[#2563EB]"
            aria-label="筛选访问记录类型"
          >
            <option value="">全部记录</option>
            {Object.entries(EVENT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <button type="button" onClick={() => void loadRecords()} disabled={isLoading} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#E4E9F0] px-3 text-xs text-[#344054] hover:bg-[#F5F7FA] disabled:opacity-60">
            <RefreshCw className={`size-3.5 ${isLoading ? "animate-spin" : ""}`} /> 刷新
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 p-4 lg:grid-cols-4">
        {cards.map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="min-w-0 rounded-xl border border-[#EAF0F6] p-3.5">
            <div className="flex items-center justify-between gap-2"><span className="text-xs text-[#667085]">{label}</span><span className={`flex size-7 shrink-0 items-center justify-center rounded-lg ${color}`}><Icon className="size-3.5" /></span></div>
            <p className="mt-2 text-2xl font-bold tabular-nums text-[#172033]">{value}</p>
          </div>
        ))}
      </div>

      <div className="border-t border-[#F0F2F5] px-4 pb-4 pt-3 sm:px-5">
        {error && <p className="mb-3 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}
        <div className="relative mb-3">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-[#98A2B3]" />
          <input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="搜索人员、账号、来源、IP 或申请信息"
            className="h-9 w-full rounded-lg border border-[#E4E9F0] bg-[#F8FAFC] pl-9 pr-3 text-xs text-[#172033] outline-none transition-all placeholder:text-[#98A2B3] focus:border-[#2563EB] focus:bg-white focus:ring-4 focus:ring-[#2563EB]/10"
          />
        </div>
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-left text-xs"><thead className="border-b border-[#F0F2F5] text-[#98A2B3]"><tr><th className="px-2 py-2">类型</th><th className="px-2 py-2">人员</th><th className="px-2 py-2">详情</th><th className="px-2 py-2">时间</th></tr></thead><tbody className="divide-y divide-[#F5F7FA] text-[#475467]">
            {events.map((event) => <tr key={event.id}><td className="px-2 py-2.5 font-medium text-[#172033]">{EVENT_LABELS[event.event_type]}</td><td className="max-w-[220px] truncate px-2 py-2.5" title={eventIdentity(event)}>{eventIdentity(event)}</td><td className="max-w-[260px] truncate px-2 py-2.5" title={eventDetail(event)}>{eventDetail(event)}</td><td className="whitespace-nowrap px-2 py-2.5 text-[#98A2B3]">{formatTime(event.created_at)}</td></tr>)}
          </tbody></table>
        </div>
        <div className="space-y-2 md:hidden">
          {events.map((event) => <div key={event.id} className="rounded-lg border border-[#EEF2F6] p-3"><div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold text-[#172033]">{EVENT_LABELS[event.event_type]}</span><span className="shrink-0 text-[10px] text-[#98A2B3]">{formatTime(event.created_at)}</span></div><p className="mt-1 truncate text-xs font-medium text-[#475467]">{eventIdentity(event)}</p><p className="mt-1 text-[11px] text-[#98A2B3]">{eventDetail(event)}</p></div>)}
        </div>
        {!isLoading && events.length === 0 && <p className="py-6 text-center text-xs text-[#98A2B3]">{searchQuery ? "未找到匹配的访问记录" : "暂无访问记录"}</p>}
        {meta.total > 0 && (
          <div className="mt-3 flex items-center justify-between gap-3 border-t border-[#F0F2F5] pt-3 text-xs text-[#667085]">
            <span>共 {meta.total} 条 · 第 {meta.page} / {meta.total_pages} 页</span>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={isLoading || meta.page <= 1} className="inline-flex h-8 items-center gap-1 rounded-lg border border-[#E4E9F0] px-2.5 text-xs text-[#475467] hover:bg-[#F5F7FA] disabled:cursor-not-allowed disabled:opacity-50"><ChevronLeft className="size-3.5" />上一页</button>
              <button type="button" onClick={() => setPage((current) => Math.min(meta.total_pages, current + 1))} disabled={isLoading || meta.page >= meta.total_pages} className="inline-flex h-8 items-center gap-1 rounded-lg border border-[#E4E9F0] px-2.5 text-xs text-[#475467] hover:bg-[#F5F7FA] disabled:cursor-not-allowed disabled:opacity-50">下一页<ChevronRight className="size-3.5" /></button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
