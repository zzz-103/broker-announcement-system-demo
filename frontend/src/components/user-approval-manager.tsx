"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clipboard,
  Loader2,
  RefreshCw,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import { useAuthStore } from "@/store/auth-store";
import {
  AdminUser,
  BackendApiError,
  createAdminUser,
  deleteAdminUser,
  getAdminUsers,
} from "@/lib/api/backend-client";

interface CreatedCredential {
  username: string;
  password: string;
}

function formatCreatedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

function errorMessage(error: unknown) {
  if (error instanceof BackendApiError) {
    if (error.status === 0) return "无法连接 FastAPI 后端，请确认服务已启动";
    return error.message;
  }
  return error instanceof Error ? error.message : "操作失败";
}

export function UserApprovalManager() {
  const { token, clearAuth } = useAuthStore();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [department, setDepartment] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [createdCredential, setCreatedCredential] = useState<CreatedCredential | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  const handleAuthError = useCallback(
    (error: unknown) => {
      if (error instanceof BackendApiError && error.status === 401) {
        clearAuth("登录已失效，请重新登录");
        return true;
      }
      return false;
    },
    [clearAuth],
  );

  const loadUsers = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    setError("");
    try {
      const data = await getAdminUsers(token);
      setUsers(data.users);
    } catch (error) {
      if (!handleAuthError(error)) setError(errorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }, [handleAuthError, token]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token || isCreating) return;

    setIsCreating(true);
    setError("");
    setCopyState("idle");
    try {
      const result = await createAdminUser(token, { name, email, department });
      setCreatedCredential({
        username: result.user.username,
        password: result.initial_password,
      });
      setName("");
      setEmail("");
      setDepartment("");
      await loadUsers();
    } catch (error) {
      if (!handleAuthError(error)) setError(errorMessage(error));
    } finally {
      setIsCreating(false);
    }
  };

  const handleDelete = async (user: AdminUser) => {
    if (!token || deletingId !== null) return;
    const confirmed = window.confirm(`确认删除已审批用户「${user.name}」吗？`);
    if (!confirmed) return;

    setDeletingId(user.id);
    setError("");
    try {
      await deleteAdminUser(token, user.id);
      await loadUsers();
    } catch (error) {
      if (!handleAuthError(error)) setError(errorMessage(error));
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
      <div className="px-5 py-4 border-b border-[#E4E9F0] flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-lg bg-[#162B49] flex items-center justify-center">
            <UserPlus className="w-4 h-4 text-white" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-[#172033]">用户资格审批录入</h2>
            <p className="text-xs text-[#667085] mt-0.5">审批后自动生成用户名和一次性初始密码</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void loadUsers()}
          disabled={isLoading}
          className="h-8 px-3 rounded-lg border border-[#D0D5DD] text-xs text-[#344054] hover:bg-[#F5F7FA] disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-1.5"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
          刷新
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-0">
        <div className="p-5 border-b lg:border-b-0 lg:border-r border-[#E4E9F0]">
          <form onSubmit={handleCreate} className="space-y-4">
            <label className="block">
              <span className="text-xs font-medium text-[#344054]">姓名</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="mt-1 w-full h-10 rounded-lg border border-[#D0D5DD] px-3 text-sm text-[#172033] outline-none focus:border-[#162B49]"
                placeholder="张三"
                disabled={isCreating}
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-[#344054]">邮箱</span>
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="mt-1 w-full h-10 rounded-lg border border-[#D0D5DD] px-3 text-sm text-[#172033] outline-none focus:border-[#162B49]"
                placeholder="name@gmail.com"
                disabled={isCreating}
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-[#344054]">部门</span>
              <input
                value={department}
                onChange={(event) => setDepartment(event.target.value)}
                className="mt-1 w-full h-10 rounded-lg border border-[#D0D5DD] px-3 text-sm text-[#172033] outline-none focus:border-[#162B49]"
                placeholder="技术部"
                disabled={isCreating}
              />
            </label>
            <button
              type="submit"
              disabled={isCreating}
              className="w-full h-10 rounded-lg bg-[#162B49] text-white text-sm font-medium hover:bg-[#1e3a5f] disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
              审批并创建用户
            </button>
          </form>

          {createdCredential && (
            <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4">
              <div className="flex items-start gap-2 text-amber-800">
                <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold">创建成功</p>
                  <p className="text-xs mt-1">初始密码仅显示一次，请立即保存。</p>
                </div>
              </div>
              <div className="mt-3 rounded-lg bg-white border border-amber-200 p-3 text-sm text-[#172033] space-y-1">
                <p>
                  <span className="text-[#667085]">用户名：</span>
                  <span className="font-mono font-semibold">{createdCredential.username}</span>
                </p>
                <p>
                  <span className="text-[#667085]">初始密码：</span>
                  <span className="font-mono font-semibold tracking-wide">{createdCredential.password}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => void handleCopy()}
                className="mt-3 h-8 px-3 rounded-lg bg-amber-600 text-white text-xs font-medium hover:bg-amber-700 flex items-center gap-1.5"
              >
                <Clipboard className="w-3.5 h-3.5" />
                {copyState === "copied" ? "已复制" : "复制"}
              </button>
              {copyState === "failed" && <p className="mt-2 text-xs text-red-600">复制失败，请手动保存。</p>}
            </div>
          )}
        </div>

        <div className="p-5 min-w-0">
          {error && (
            <div className="mb-4 rounded-lg bg-red-50 text-red-600 px-3 py-2 text-xs flex items-start gap-2">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 text-sm font-medium text-[#172033]">
              <Users className="w-4 h-4 text-[#667085]" />
              已审批用户
            </div>
            <span className="text-xs text-[#667085]">{users.length} 人</span>
          </div>

          <div className="space-y-3">
            {users.length === 0 && !isLoading && (
              <div className="rounded-lg border border-dashed border-[#D0D5DD] py-10 text-center text-sm text-[#667085]">
                暂无已审批用户
              </div>
            )}
            {isLoading && users.length === 0 && (
              <div className="rounded-lg border border-[#E4E9F0] py-10 text-center text-sm text-[#667085]">
                正在加载用户列表...
              </div>
            )}
            {users.map((user) => (
              <div key={user.id} className="rounded-lg border border-[#E4E9F0] p-4">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold text-[#172033]">{user.name}</h3>
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-mono">
                        {user.username}
                      </span>
                    </div>
                    <div className="mt-2 grid grid-cols-1 xl:grid-cols-2 gap-x-5 gap-y-1 text-xs text-[#667085]">
                      <span className="break-all">邮箱：{user.email}</span>
                      <span>部门：{user.department}</span>
                      <span>创建时间：{formatCreatedAt(user.created_at)}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleDelete(user)}
                    disabled={deletingId !== null}
                    className="h-8 px-3 rounded-lg border border-red-200 text-xs text-red-600 hover:bg-red-50 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 shrink-0"
                  >
                    {deletingId === user.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="w-3.5 h-3.5" />
                    )}
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
