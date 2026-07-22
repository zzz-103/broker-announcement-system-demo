"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clipboard,
  ChevronLeft,
  ChevronRight,
  Loader2,
  RefreshCw,
  Search,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import { useAuthStore } from "@/store/auth-store";
import {
  createAdminUser,
  listDemoUsers,
  updateDemoUserStatus,
  type AdminListMeta,
  type DemoUser,
} from "@/lib/local-platform-service";

interface CreatedCredential {
  username: string;
  password: string;
}

const USER_PAGE_SIZE = 4;
const EMPTY_META: AdminListMeta = { page: 1, page_size: USER_PAGE_SIZE, total: 0, total_pages: 1, q: "" };

function formatCreatedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "操作失败";
}

export function UserApprovalManager() {
  const { user: currentUser } = useAuthStore();
  const [users, setUsers] = useState<DemoUser[]>([]);
  const [meta, setMeta] = useState<AdminListMeta>(EMPTY_META);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [department, setDepartment] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [createdCredential, setCreatedCredential] = useState<CreatedCredential | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [btnCoords, setBtnCoords] = useState({ x: 0, y: 0 });
  const [btnHovered, setBtnHovered] = useState(false);

  const handleBtnMouseMove = (e: React.MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setBtnCoords({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  };

  const loadUsers = useCallback(async (requestedPage = page, query = searchQuery) => {
    setIsLoading(true);
    setError("");
    try {
      const normalizedQuery = query.toLowerCase();
      const allUsers = listDemoUsers().filter((item) => !normalizedQuery || [item.name, item.username, item.email, item.department].join(" ").toLowerCase().includes(normalizedQuery));
      const totalPages = Math.max(1, Math.ceil(allUsers.length / USER_PAGE_SIZE));
      const effectivePage = Math.min(Math.max(1, requestedPage), totalPages);
      setUsers(allUsers.slice((effectivePage - 1) * USER_PAGE_SIZE, effectivePage * USER_PAGE_SIZE));
      setMeta({ page: effectivePage, page_size: USER_PAGE_SIZE, total: allUsers.length, total_pages: totalPages, q: query });
      if (effectivePage !== page) setPage(effectivePage);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }, [page, searchQuery]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearchQuery(searchInput.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isCreating) return;

    setIsCreating(true);
    setError("");
    setCopyState("idle");
    try {
      const result = await createAdminUser({ name, email, department });
      setCreatedCredential({
        username: result.user.username,
        password: result.initial_password,
      });
      setName("");
      setEmail("");
      setDepartment("");
      setSearchInput("");
      setSearchQuery("");
      setPage(1);
      await loadUsers(1, "");
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setIsCreating(false);
    }
  };

  const handleDelete = async (user: DemoUser) => {
    if (deletingId !== null || user.id === currentUser?.id) return;

    setDeletingId(user.id);
    setError("");
    try {
      updateDemoUserStatus(user.id, user.status === "active" ? "disabled" : "active", currentUser?.id ?? "");
      await loadUsers();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setDeletingId(null);
    }
  };

  const handleCopy = async () => {
    if (!createdCredential) return;
    try {
      await navigator.clipboard.writeText(
        `用户名：${createdCredential.username}\n初始密码：${createdCredential.password}`,
      );
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };

  return (
    <section className="mt-6 bg-white rounded-xl border border-[#E4E9F0] shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-[#E4E9F0] flex items-center justify-between gap-3 bg-white">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-[#162B49] to-[#2563EB] flex items-center justify-center shadow-sm">
            <UserPlus className="w-4 h-4 text-white" />
          </div>
          <div>
            <h2 className="text-base font-bold text-[#172033]">用户资格审批录入</h2>
            <p className="text-xs text-[#667085] mt-0.5">审批后自动生成用户名和一次性初始密码</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void loadUsers()}
          disabled={isLoading}
          className="h-8 px-3 rounded-lg border border-[#E4E9F0] text-xs text-[#344054] hover:bg-[#F5F7FA] active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-1.5 transition-all"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
          刷新
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[36%_64%] gap-0">
        {/* Left Column: Form (36% width, light gray background) */}
        <div className="p-6 border-b lg:border-b-0 lg:border-r border-[#E4E9F0] bg-[#F8FAFC]/80 backdrop-blur-sm">
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="group">
              <label className="block text-xs font-semibold text-[#475467] mb-1.5 group-focus-within:text-[#2563EB] transition-colors">
                姓名
              </label>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="w-full h-11 pl-3.5 pr-3.5 rounded-lg border border-[#E4E9F0] bg-white text-sm text-[#172033] placeholder:text-[#98A2B3] focus:outline-none focus:ring-4 focus:ring-[#2563EB]/10 focus:border-[#2563EB] transition-all"
                placeholder="张三"
                disabled={isCreating}
                required
              />
            </div>
            <div className="group">
              <label className="block text-xs font-semibold text-[#475467] mb-1.5 group-focus-within:text-[#2563EB] transition-colors">
                邮箱
              </label>
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="w-full h-11 pl-3.5 pr-3.5 rounded-lg border border-[#E4E9F0] bg-white text-sm text-[#172033] placeholder:text-[#98A2B3] focus:outline-none focus:ring-4 focus:ring-[#2563EB]/10 focus:border-[#2563EB] transition-all"
                placeholder="name@csco.com"
                type="email"
                disabled={isCreating}
                required
              />
            </div>
            <div className="group">
              <label className="block text-xs font-semibold text-[#475467] mb-1.5 group-focus-within:text-[#2563EB] transition-colors">
                部门
              </label>
              <input
                value={department}
                onChange={(event) => setDepartment(event.target.value)}
                className="w-full h-11 pl-3.5 pr-3.5 rounded-lg border border-[#E4E9F0] bg-white text-sm text-[#172033] placeholder:text-[#98A2B3] focus:outline-none focus:ring-4 focus:ring-[#2563EB]/10 focus:border-[#2563EB] transition-all"
                placeholder="信息技术部"
                disabled={isCreating}
                required
              />
            </div>
            <button
              type="submit"
              disabled={isCreating}
              onMouseMove={handleBtnMouseMove}
              onMouseEnter={() => setBtnHovered(true)}
              onMouseLeave={() => setBtnHovered(false)}
              className="relative overflow-hidden w-full h-11 rounded-lg bg-gradient-to-r from-[#162B49] to-[#2563EB] text-white text-sm font-semibold hover:shadow-lg hover:shadow-blue-500/10 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-all"
            >
              {btnHovered && !isCreating && (
                <span
                  className="absolute pointer-events-none rounded-full bg-white/20 blur-md transition-opacity duration-300"
                  style={{
                    width: "80px",
                    height: "80px",
                    left: `${btnCoords.x - 40}px`,
                    top: `${btnCoords.y - 40}px`,
                    transform: "translate3d(0, 0, 0)",
                    pointerEvents: "none",
                  }}
                />
              )}
              <span className="relative z-10 flex items-center justify-center gap-2">
                {isCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                审批并创建用户
              </span>
            </button>
          </form>

          {createdCredential && (
            <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50/70 p-4">
              <div className="flex items-start gap-2 text-amber-800">
                <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-bold">创建成功</p>
                  <p className="text-xs mt-1 text-amber-700">初始密码仅显示一次，请立即保存。</p>
                </div>
              </div>
              <div className="mt-3 rounded-lg bg-white border border-amber-200 p-3 text-sm text-[#172033] space-y-1">
                <p>
                  <span className="text-[#667085] text-xs">用户名：</span>
                  <span className="font-mono font-semibold text-[#172033]">{createdCredential.username}</span>
                </p>
                <p>
                  <span className="text-[#667085] text-xs">初始密码：</span>
                  <span className="font-mono font-semibold tracking-wide text-[#172033]">{createdCredential.password}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => void handleCopy()}
                className="mt-3 h-8 px-3 rounded-lg bg-amber-600 text-white text-xs font-semibold hover:bg-amber-700 active:scale-[0.98] flex items-center gap-1.5 transition-all"
              >
                <Clipboard className="w-3.5 h-3.5" />
                {copyState === "copied" ? "已复制" : "复制密码"}
              </button>
              {copyState === "failed" && <p className="mt-2 text-xs text-red-600 font-medium">复制失败，请手动保存。</p>}
            </div>
          )}
        </div>

        {/* Right Column: User List (64% width, white background) */}
        <div className="p-6 min-w-0 bg-white">
          {error && (
            <div className="mb-4 rounded-lg bg-red-50 text-red-600 px-3 py-2 text-xs flex items-start gap-2 border border-red-100">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex items-center justify-between mb-4 border-b border-[#F0F2F5] pb-3">
            <div className="flex items-center gap-2 text-sm font-bold text-[#172033]">
              <Users className="w-4 h-4 text-[#667085]" />
              已审批用户
            </div>
            <span className="text-xs text-[#667085] font-semibold bg-[#F5F7FA] px-2.5 py-0.5 rounded-full">
              {meta.total} 人
            </span>
          </div>

          <div className="relative mb-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-[#98A2B3]" />
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="搜索姓名、账号、邮箱或部门"
              className="h-9 w-full rounded-lg border border-[#E4E9F0] bg-[#F8FAFC] pl-9 pr-3 text-xs text-[#172033] outline-none transition-all placeholder:text-[#98A2B3] focus:border-[#2563EB] focus:bg-white focus:ring-4 focus:ring-[#2563EB]/10"
            />
          </div>

          <div className="space-y-3">
            {users.length === 0 && !isLoading && (
              <div className="rounded-xl border border-dashed border-[#E4E9F0] py-16 text-center text-xs text-[#98A2B3] bg-[#F8FAFC]">
                {searchQuery ? "未找到匹配的已审批用户" : "暂无已审批用户"}
              </div>
            )}
            {isLoading && users.length === 0 && (
              <div className="rounded-xl border border-[#E4E9F0] py-16 text-center text-xs text-[#667085] bg-[#F8FAFC]">
                正在加载用户列表...
              </div>
            )}

            {/* Desktop View: Compact Table */}
            {users.length > 0 && (
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-[#F0F2F5] text-[11px] font-bold text-[#98A2B3] uppercase tracking-wider">
                      <th className="py-2.5 px-3">姓名 / 账号</th>
                      <th className="py-2.5 px-3">邮箱</th>
                      <th className="py-2.5 px-3">部门</th>
                      <th className="py-2.5 px-3">创建时间</th>
                      <th className="py-2.5 px-3">状态</th>
                      <th className="py-2.5 px-3 text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F0F2F5] text-xs text-[#344054]">
                    {users.map((user) => (
                      <tr key={user.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="py-3 px-3">
                          <div className="font-bold text-[#172033]">{user.name}</div>
                          <div className="text-[10px] text-[#2563EB] font-mono mt-0.5 bg-blue-50/60 border border-blue-100 rounded px-1.5 py-0.5 inline-block leading-none">
                            {user.username}
                          </div>
                        </td>
                        <td className="py-3 px-3">
                          <span className="truncate max-w-[160px] block font-medium text-[#475467]" title={user.email}>
                            {user.email}
                          </span>
                        </td>
                        <td className="py-3 px-3 font-semibold text-[#667085]">
                          {user.department || "-"}
                        </td>
                        <td className="py-3 px-3 text-[#98A2B3] font-medium whitespace-nowrap">
                          {formatCreatedAt(user.createdAt)}
                        </td>
                        <td className="py-3 px-3">
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${user.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
                            {user.status === "active" ? "启用" : user.status === "disabled" ? "禁用" : "待审批"}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-right">
                          <button
                            type="button"
                            onClick={() => void handleDelete(user)}
                            disabled={deletingId !== null}
                            title={user.status === "active" ? "禁用用户" : "启用用户"}
                            className="h-8 w-8 inline-flex items-center justify-center rounded-lg border border-red-100 text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors"
                          >
                            {deletingId === user.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Mobile View: Card List */}
            {users.length > 0 && (
              <div className="block md:hidden space-y-3">
                {users.map((user) => (
                  <div key={user.id} className="rounded-xl border border-[#E4E9F0] p-4 bg-white shadow-sm space-y-2.5">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-bold text-[#172033]">{user.name}</h3>
                      <span className="text-[10px] px-2 py-0.5 rounded bg-blue-50 text-blue-700 font-mono border border-blue-100">
                        {user.username}
                      </span>
                    </div>
                    <div className="text-xs text-[#667085] space-y-1 leading-relaxed">
                      <p className="truncate" title={user.email}>
                        <span className="text-[#98A2B3] font-medium">邮箱：</span>{user.email}
                      </p>
                      <p>
                        <span className="text-[#98A2B3] font-medium">部门：</span>{user.department || "-"}
                      </p>
                      <p>
                        <span className="text-[#98A2B3] font-medium">创建：</span>{formatCreatedAt(user.createdAt)}
                      </p>
                      <p>
                        <span className="text-[#98A2B3] font-medium">状态：</span>{user.status === "active" ? "启用" : user.status === "disabled" ? "禁用" : "待审批"}
                      </p>
                    </div>
                    <div className="pt-2 border-t border-[#F0F2F5] flex justify-end">
                      <button
                        type="button"
                        onClick={() => void handleDelete(user)}
                        disabled={deletingId !== null}
                        className="h-8 px-3 rounded-lg border border-red-200 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-1.5 transition-all"
                      >
                        {deletingId === user.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <>
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>{user.status === "active" ? "禁用" : "启用"}</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {meta.total > 0 && (
              <div className="flex items-center justify-between gap-3 border-t border-[#F0F2F5] pt-3 text-xs text-[#667085]">
                <span>第 {meta.page} / {meta.total_pages} 页</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                    disabled={isLoading || meta.page <= 1}
                    className="inline-flex h-8 items-center gap-1 rounded-lg border border-[#E4E9F0] px-2.5 text-xs text-[#475467] hover:bg-[#F5F7FA] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <ChevronLeft className="size-3.5" />上一页
                  </button>
                  <button
                    type="button"
                    onClick={() => setPage((current) => Math.min(meta.total_pages, current + 1))}
                    disabled={isLoading || meta.page >= meta.total_pages}
                    className="inline-flex h-8 items-center gap-1 rounded-lg border border-[#E4E9F0] px-2.5 text-xs text-[#475467] hover:bg-[#F5F7FA] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    下一页<ChevronRight className="size-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
