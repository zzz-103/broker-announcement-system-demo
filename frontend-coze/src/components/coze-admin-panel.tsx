"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { listDemoFeedback, listDemoUsers, listLoginLogs, updateDemoFeedbackStatus, updateDemoUserStatus, type DemoUser, type FeedbackRecord, type LoginLog } from "@/lib/local-platform-service";

export function CozeAdminPanel({ currentUserId, onBack }: { currentUserId: string; onBack: () => void }) {
  const [users, setUsers] = useState<DemoUser[]>([]);
  const [logs, setLogs] = useState<LoginLog[]>([]);
  const [feedback, setFeedback] = useState<FeedbackRecord[]>([]);
  const refresh = useCallback(() => { setUsers(listDemoUsers()); setLogs(listLoginLogs()); setFeedback(listDemoFeedback()); }, []);
  useEffect(() => refresh(), [refresh]);
  return <main className="min-h-screen bg-[#F4F7FB] p-4 sm:p-8"><div className="mx-auto max-w-[1400px]"><div className="mb-5 flex items-center justify-between"><div><h1 className="text-2xl font-bold text-[#172033]">精简管理页</h1><p className="mt-1 text-xs text-[#98A2B3]">本地演示数据仅保存在当前浏览器，导入 Coze 后需替换服务适配层。</p></div><button onClick={onBack} className="rounded-lg border bg-white px-3 py-2 text-sm">返回看板</button></div><div className="grid gap-4 lg:grid-cols-3"><Panel title={"用户审批（" + users.length + "）"}><div className="space-y-2">{users.map((user) => <div key={user.id} className="rounded-lg border p-3 text-xs"><div className="flex items-center justify-between"><b>{user.name || user.username}</b><span>{user.status}</span></div><p className="mt-1 text-[#667085]">{user.username} · {user.department || "管理员"}</p>{!user.isAdmin && <div className="mt-2 flex gap-2"><button onClick={() => { updateDemoUserStatus(user.id, "active", currentUserId); refresh(); }} className="rounded bg-emerald-50 px-2 py-1 text-emerald-700">启用</button><button onClick={() => { updateDemoUserStatus(user.id, "disabled", currentUserId); refresh(); }} className="rounded bg-red-50 px-2 py-1 text-red-700">禁用</button></div>}</div>)}</div></Panel><Panel title={"登录记录（" + logs.length + "）"}><div className="max-h-[420px] space-y-2 overflow-auto">{logs.map((log) => <div key={log.id} className="border-b pb-2 text-xs"><b>{log.username}</b><span className={log.success ? "ml-2 text-emerald-600" : "ml-2 text-red-600"}>{log.success ? "成功" : "失败"}</span><p className="text-[#98A2B3]">{new Date(log.createdAt).toLocaleString("zh-CN")}</p></div>)}</div></Panel><Panel title={"反馈处理（" + feedback.length + "）"}><div className="max-h-[420px] space-y-2 overflow-auto">{feedback.map((item) => <div key={item.id} className="rounded-lg border p-3 text-xs"><div className="flex justify-between"><b>{item.category}</b><span>{item.status}</span></div><p className="mt-1 text-[#475467]">{item.message}</p>{item.status === "pending" && <button onClick={() => { updateDemoFeedbackStatus(item.id, "processed"); refresh(); }} className="mt-2 rounded bg-blue-50 px-2 py-1 text-blue-700">标记已处理</button>}</div>)}</div></Panel></div></div></main>;
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return <section className="rounded-xl border border-[#E4E9F0] bg-white p-4 shadow-sm"><h2 className="mb-3 border-b pb-3 text-sm font-bold text-[#172033]">{title}</h2>{children}</section>;
}
