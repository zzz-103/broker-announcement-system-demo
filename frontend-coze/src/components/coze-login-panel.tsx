"use client";

import { FormEvent, useState } from "react";
import { hasDemoAdmin } from "@/lib/local-platform-service";
import { useAuthStore } from "@/store/auth-store";

type Mode = "login" | "register" | "admin";

export function CozeLoginPanel() {
  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [department, setDepartment] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const { login, register, createAdmin, error } = useAuthStore();
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      if (mode === "login") await login(username, password);
      else if (mode === "register") { await register({ username, password, name, email, department }); setMessage("申请已保存到本浏览器，等待演示管理员审批。"); setMode("login"); }
      else { await createAdmin({ username, password, name }); setMessage("演示管理员已创建，请返回登录。"); setMode("login"); }
    } catch (reason: unknown) { setMessage(reason instanceof Error ? reason.message : "操作失败"); } finally { setBusy(false); }
  }
  const title = mode === "login" ? "登录展示版" : mode === "register" ? "注册申请" : "创建演示管理员";
  return <main className="flex min-h-screen items-center justify-center bg-[#F5F7FA] px-4 py-8"><section className="grid w-full max-w-[1020px] overflow-hidden rounded-2xl border border-[#E4E9F0] bg-white shadow-xl md:grid-cols-[45%_55%]"><div className="bg-gradient-to-br from-[#071a38] via-[#0c2a58] to-[#0e4bb5] p-8 text-white sm:p-12"><div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/15 text-2xl">券</div><h1 className="mt-8 text-3xl font-bold leading-tight">世纪证券<br />招采情报平台</h1><p className="mt-4 text-sm leading-7 text-blue-100">对公展示版仅用于看板预览。用户服务当前为浏览器本地演示实现，正式部署前必须替换为 Coze 服务端认证。</p></div><div className="p-7 sm:p-12"><div className="mb-6 flex flex-wrap gap-3 border-b border-[#E4E9F0] pb-3"><button onClick={() => setMode("login")} className={mode === "login" ? "font-bold text-[#2563EB]" : "text-[#667085]"}>登录</button><button onClick={() => setMode("register")} className={mode === "register" ? "font-bold text-[#2563EB]" : "text-[#667085]"}>注册申请</button>{!hasDemoAdmin() && <button onClick={() => setMode("admin")} className={mode === "admin" ? "font-bold text-[#2563EB]" : "text-[#667085]"}>首次建管</button>}</div><h2 className="text-xl font-bold text-[#172033]">{title}</h2><p className="mt-2 text-xs text-[#98A2B3]">本地预览模式 · 不代表生产安全认证</p><form onSubmit={submit} className="mt-6 space-y-4">{mode !== "login" && <Input label="姓名" value={name} onChange={setName} />}{mode === "register" && <><Input label="邮箱" value={email} onChange={setEmail} type="email" /><Input label="部门" value={department} onChange={setDepartment} /></>}<Input label="用户名" value={username} onChange={setUsername} /><Input label="密码（至少 8 位）" value={password} onChange={setPassword} type="password" />{(error || message) && <p className={error ? "rounded-lg bg-red-50 p-3 text-xs text-red-700" : "rounded-lg bg-emerald-50 p-3 text-xs text-emerald-700"}>{error || message}</p>}<button disabled={busy} className="w-full rounded-lg bg-[#162B49] px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">{busy ? "处理中..." : title}</button></form></div></section></main>;
}

function Input({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return <label className="block text-xs font-semibold text-[#475467]">{label}<input required type={type} value={value} onChange={(event) => onChange(event.target.value)} className="mt-1.5 h-11 w-full rounded-lg border border-[#E4E9F0] px-3 text-sm outline-none focus:border-[#2563EB] focus:ring-4 focus:ring-blue-500/10" /></label>;
}
