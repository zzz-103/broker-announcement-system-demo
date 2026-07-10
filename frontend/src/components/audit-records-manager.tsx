"use client";

import { useCallback, useEffect, useState } from "react";
import { Activity, LogIn, QrCode, RefreshCw, UserCheck, UsersRound } from "lucide-react";
import { useAuthStore } from "@/store/auth-store";
import {
  type AuditEventRecord,
  type AuditEventType,
  BackendApiError,
  getAdminAuditEvents,
  getAdminAuditSummary,
  type AuditSummaryResponse,
} from "@/lib/api/backend-client";

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
  return [event.role, event.source, event.ip_masked].filter(Boolean).join(" · ") || "-";
}

export function AuditRecordsManager() {
  const { token, clearAuth } = useAuthStore();
  const [summary, setSummary] = useState<AuditSummaryResponse | null>(null);
  const [events, setEvents] = useState<AuditEventRecord[]>([]);
  const [eventType, setEventType] = useState<AuditEventType | "">("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const loadRecords = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    setError("");
    try {
      const [nextSummary, nextEvents] = await Promise.all([
        getAdminAuditSummary(token),
        getAdminAuditEvents(token, eventType),
      ]);
      setSummary(nextSummary);
      setEvents(nextEvents.events);
    } catch (reason) {
      if (reason instanceof BackendApiError && reason.status === 401) {
        clearAuth("登录已失效，请重新登录");
      } else {
        setError(reason instanceof Error ? reason.message : "无法加载访问记录");
      }
    } finally {
      setIsLoading(false);
    }
  }, [clearAuth, eventType, token]);

  useEffect(() => {
    void loadRecords();
  }, [loadRecords]);

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
            onChange={(event) => setEventType(event.target.value as AuditEventType | "")}
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
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-left text-xs"><thead className="border-b border-[#F0F2F5] text-[#98A2B3]"><tr><th className="px-2 py-2">类型</th><th className="px-2 py-2">人员</th><th className="px-2 py-2">详情</th><th className="px-2 py-2">时间</th></tr></thead><tbody className="divide-y divide-[#F5F7FA] text-[#475467]">
            {events.map((event) => <tr key={event.id}><td className="px-2 py-2.5 font-medium text-[#172033]">{EVENT_LABELS[event.event_type]}</td><td className="max-w-[220px] truncate px-2 py-2.5" title={eventIdentity(event)}>{eventIdentity(event)}</td><td className="max-w-[260px] truncate px-2 py-2.5" title={eventDetail(event)}>{eventDetail(event)}</td><td className="whitespace-nowrap px-2 py-2.5 text-[#98A2B3]">{formatTime(event.created_at)}</td></tr>)}
          </tbody></table>
        </div>
        <div className="space-y-2 md:hidden">
          {events.map((event) => <div key={event.id} className="rounded-lg border border-[#EEF2F6] p-3"><div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold text-[#172033]">{EVENT_LABELS[event.event_type]}</span><span className="shrink-0 text-[10px] text-[#98A2B3]">{formatTime(event.created_at)}</span></div><p className="mt-1 truncate text-xs font-medium text-[#475467]">{eventIdentity(event)}</p><p className="mt-1 text-[11px] text-[#98A2B3]">{eventDetail(event)}</p></div>)}
        </div>
        {!isLoading && events.length === 0 && <p className="py-6 text-center text-xs text-[#98A2B3]">暂无访问记录</p>}
      </div>
    </section>
  );
}
