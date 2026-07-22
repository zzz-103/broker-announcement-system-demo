"use client";

import { ArrowLeft, Brain, LogOut, Sparkles } from "lucide-react";
import { AuditRecordsManager } from "@/components/audit-records-manager";
import { FeedbackManager } from "@/components/feedback-manager";
import { UserApprovalManager } from "@/components/user-approval-manager";
import { useAuthStore } from "@/store/auth-store";

interface DashboardProps {
  onBack: () => void;
  onDataRefresh?: () => void;
}

export function AdminDashboard({ onBack }: DashboardProps) {
  const { username, logout } = useAuthStore();

  return (
    <div className="min-h-screen bg-[#F5F7FA]">
      <header className="sticky top-0 z-40 border-b border-white/5 bg-[#162B49]/90 text-white backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-[1600px] items-center justify-between px-4 sm:px-8">
          <div className="flex items-center gap-3">
            <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-white/70 transition-colors hover:text-white">
              <ArrowLeft className="size-4" />
              返回看板
            </button>
            <div className="h-5 w-px bg-white/20" />
            <div className="flex items-center gap-2">
              <Sparkles className="size-4 text-amber-400" />
              <span className="text-sm font-medium">管理控制台</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-white/60">{username}</span>
            <button onClick={logout} className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-white/60 transition-colors hover:bg-white/10 hover:text-white">
              <LogOut className="size-3.5" />
              退出
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1280px] px-4 py-8 sm:px-8">
        <div className="mb-8 flex flex-col gap-4 border-b border-[#E4E9F0] pb-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[#172033]">管理控制台</h1>
            <p className="mt-1 text-xs text-[#667085]">管理用户资格、访问记录与用户反馈</p>
          </div>
          <div className="flex items-center gap-3 text-xs text-[#667085]">
            <span className="flex items-center gap-1 rounded-full border border-white/40 bg-white/70 px-2.5 py-1 shadow-sm backdrop-blur-md">
              <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
              本地预览
            </span>
            <span className="rounded-full border border-white/40 bg-white/70 px-2.5 py-1 shadow-sm backdrop-blur-md">当前管理员：<span className="font-semibold text-[#172033]">{username}</span></span>
          </div>
        </div>

        <section className="rounded-2xl border border-[#E4E9F0] bg-white shadow-sm transition-all duration-200 hover:-translate-y-[2px] hover:shadow-md">
          <div className="flex flex-col p-6">
            <div className="flex items-start justify-between">
              <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-fuchsia-500 to-pink-600 shadow-sm">
                <Brain className="size-5 text-white" />
              </div>
              <span className="rounded-full border border-blue-100 bg-blue-50 px-2.5 py-0.5 text-[10px] font-semibold text-blue-600">静态展示</span>
            </div>
            <div className="mt-4">
              <h3 className="text-base font-bold text-[#172033]">AI 情报分析</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-[#667085]">当前分析内容来自 public/data/ai-analysis.json，仅用于迁移预览。</p>
            </div>
            <div className="mt-6 min-h-[76px] rounded-xl border border-[#E4E9F0] bg-[#F8FAFC]/85 p-4">
              <div className="flex items-start gap-2 text-xs leading-relaxed text-[#35537A]"><Sparkles className="mt-0.5 size-3.5 shrink-0 text-fuchsia-500" />管理员端不执行在线生成，主看板直接读取静态分析文件。</div>
            </div>
          </div>
        </section>

        <UserApprovalManager />
        <AuditRecordsManager />
        <FeedbackManager />
      </main>
    </div>
  );
}
