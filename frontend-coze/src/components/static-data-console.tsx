"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, FolderOpen, RefreshCw, CheckCircle2, AlertCircle } from "lucide-react";
import type { DashboardManifest, DashboardOverview } from "@dashboard-data/contracts";
import { DashboardDataError, getImportedPackage, importStaticPackage, invalidateStaticPackageCache, loadStaticManifest, loadStaticDataset, resetStaticPackage } from "@/lib/static-dashboard-data";

export function StaticDataConsole({ onBack, onDataRefresh }: { onBack: () => void; onDataRefresh: () => void }) {
  const [manifest, setManifest] = useState<DashboardManifest | null>(null);
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("正在读取数据包...");
  const inputRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setStatus("loading");
    try {
      const [nextManifest, nextOverview] = await Promise.all([loadStaticManifest(), loadStaticDataset("overview")]);
      setManifest(nextManifest); setOverview(nextOverview); setMessage(getImportedPackage() ? "当前使用浏览器导入的数据包（刷新后恢复部署数据）。" : "当前使用站点部署的数据包。"); setStatus("ready");
    } catch (error) {
      setManifest(null); setOverview(null); setMessage(error instanceof DashboardDataError ? error.message : error instanceof Error ? error.message : "数据包读取失败"); setStatus("error");
    }
  };

  useEffect(() => { void load(); }, []);

  const handleImport = async (files: FileList | null) => {
    if (!files?.length) return;
    try { importStaticPackage(files); await load(); onDataRefresh(); }
    catch (error) { setStatus("error"); setMessage(error instanceof Error ? error.message : "数据包导入失败"); }
  };

  const handleReset = async () => { resetStaticPackage(); await load(); onDataRefresh(); };
  const handleReload = async () => { invalidateStaticPackageCache(); await load(); onDataRefresh(); };

  return (
    <div className="min-h-screen bg-[#F4F7FB]">
      <header className="sticky top-0 z-40 border-b border-white/5 bg-[#162B49]/95 text-white">
        <div className="mx-auto flex h-16 max-w-[1280px] items-center justify-between px-4 sm:px-8">
          <button type="button" onClick={onBack} className="flex items-center gap-1.5 text-sm text-white/75 hover:text-white"><ArrowLeft className="size-4" />返回看板</button>
          <span className="text-sm font-semibold">纯前端数据包</span>
        </div>
      </header>
      <main className="mx-auto max-w-[1100px] space-y-5 px-4 py-8 sm:px-8">
        <div>
          <h1 className="text-2xl font-bold text-[#172033]">数据包信息</h1>
          <p className="mt-1 text-xs text-[#667085]">纯前端只读取标准化静态文件，不连接后端、数据库或用户系统。</p>
        </div>
        <div className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${status === "error" ? "border-red-100 bg-red-50 text-red-700" : status === "loading" ? "border-amber-100 bg-amber-50 text-amber-700" : "border-emerald-100 bg-emerald-50 text-emerald-700"}`}>
          {status === "error" ? <AlertCircle className="mt-0.5 size-4 shrink-0" /> : status === "ready" ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : <RefreshCw className="mt-0.5 size-4 shrink-0 animate-spin" />}
          <span>{message}</span>
        </div>
        {manifest && overview && <>
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <InfoCard label="数据包版本" value={manifest.package_version} />
            <InfoCard label="生成时间" value={formatDateTime(manifest.generated_at)} />
            <InfoCard label="招采记录" value={String(overview.tender_projects.record_count)} />
            <InfoCard label="App 更新" value={String(overview.app_updates.record_count)} />
          </section>
          <section className="rounded-2xl border border-[#E4E9F0] bg-white p-5 shadow-sm">
            <h2 className="text-base font-bold text-[#172033]">文件状态</h2>
            <div className="mt-4 divide-y divide-[#F0F2F5]">
              {Object.entries(manifest.datasets).map(([key, dataset]) => <div key={key} className="flex flex-col gap-1 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"><span className="font-medium text-[#344054]">{dataset.file}</span><span className={dataset.available ? "text-emerald-600" : "text-amber-600"}>{dataset.available ? `可用 · ${dataset.record_count ?? 0} 条` : dataset.reason || "不可用"}</span></div>)}
            </div>
          </section>
        </>}
        <section className="rounded-2xl border border-[#E4E9F0] bg-white p-5 shadow-sm">
          <h2 className="text-base font-bold text-[#172033]">切换或重新加载本地数据</h2>
          <p className="mt-2 text-xs leading-relaxed text-[#667085]">将完整的 <code>dashboard-data</code> 目录拖入选择器。导入仅在当前浏览器会话内生效，刷新页面后恢复站点默认数据。</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={() => inputRef.current?.click()} className="inline-flex items-center gap-1.5 rounded-lg bg-[#162B49] px-3 py-2 text-xs font-semibold text-white hover:bg-[#1e3a5f]"><FolderOpen className="size-3.5" />选择数据包目录</button>
            <button type="button" onClick={() => void handleReload()} className="inline-flex items-center gap-1.5 rounded-lg border border-[#D7E5FF] px-3 py-2 text-xs font-semibold text-[#2563EB] hover:bg-blue-50"><RefreshCw className="size-3.5" />重新读取</button>
            {getImportedPackage() && <button type="button" onClick={() => void handleReset()} className="inline-flex items-center gap-1.5 rounded-lg border border-[#E4E9F0] px-3 py-2 text-xs font-semibold text-[#667085] hover:bg-slate-50">恢复部署数据</button>}
          </div>
          <input ref={inputRef} type="file" multiple className="hidden" onChange={(event) => { void handleImport(event.target.files); event.currentTarget.value = ""; }} {...({ webkitdirectory: "", directory: "" } as { webkitdirectory?: string; directory?: string })} />
        </section>
        <section className="rounded-2xl border border-blue-100 bg-blue-50/50 p-4 text-xs leading-relaxed text-blue-800"><strong>导入说明：</strong>完整版本管理员导出 ZIP 后先解压，再选择其中的 <code>dashboard-data</code> 文件夹；开发人员也可以直接将该目录整体复制到 <code>frontend-coze/public/dashboard-data</code>，无需修改代码或转换字段。</section>
      </main>
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) { return <div className="rounded-xl border border-[#E4E9F0] bg-white p-4 shadow-sm"><div className="text-xs text-[#667085]">{label}</div><div className="mt-1 truncate text-lg font-bold text-[#172033]" title={value}>{value}</div></div>; }
function formatDateTime(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? "未识别" : date.toLocaleString("zh-CN"); }
