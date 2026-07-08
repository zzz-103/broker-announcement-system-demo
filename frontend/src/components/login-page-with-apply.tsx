"use client";

import { useState } from "react";
import { applyForUser, BackendApiError } from "@/lib/api/backend-client";
import { useAuthStore } from "@/store/auth-store";
import {
  ArrowLeft,
  CheckCircle2,
  Clipboard,
  Eye,
  EyeOff,
  Lock,
  LogIn,
  User,
  UserPlus,
} from "lucide-react";

type LoginMode = "login" | "apply" | "success";

export function LoginPageWithApply() {
  const [mode, setMode] = useState<LoginMode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [applyLoading, setApplyLoading] = useState(false);
  const [applyName, setApplyName] = useState("");
  const [applyEmail, setApplyEmail] = useState("");
  const [applyDepartment, setApplyDepartment] = useState("");
  const [createdCredential, setCreatedCredential] = useState<{
    username: string;
    password: string;
  } | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "username" | "password" | "failed">("idle");

  const login = useAuthStore((s) => s.login);
  const authError = useAuthStore((s) => s.error);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setLoading(true);
    const success = await login(username, password);
    if (!success) {
      setError(useAuthStore.getState().error || authError || "登录失败，请检查账号密码");
    }
    setLoading(false);
  };

  const handleApply = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setCopyState("idle");
    setApplyLoading(true);
    try {
      const result = await applyForUser({
        name: applyName,
        email: applyEmail,
        department: applyDepartment,
      });
      setCreatedCredential({
        username: result.username,
        password: result.initial_password,
      });
      setApplyName("");
      setApplyEmail("");
      setApplyDepartment("");
      setMode("success");
    } catch (error) {
      const message =
        error instanceof BackendApiError
          ? error.status === 0
            ? "无法连接 FastAPI 后端，请确认服务已启动"
            : error.message
          : "申请失败，请稍后重试";
      setError(message);
    } finally {
      setApplyLoading(false);
    }
  };

  const copyText = async (value: string, target: "username" | "password") => {
    try {
      await navigator.clipboard.writeText(value);
      setCopyState(target);
    } catch {
      setCopyState("failed");
    }
  };

  const showLogin = () => {
    setMode("login");
    setError("");
    setCopyState("idle");
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F5F7FA] p-4 sm:p-6 md:p-8">
      <div className="w-full max-w-[1080px] min-h-[600px] bg-white rounded-[20px] shadow-xl border border-[#E4E9F0] overflow-hidden flex flex-col md:flex-row">
        <div className="w-full md:w-[52%] bg-gradient-to-br from-[#0F2038] via-[#162B49] to-[#2563EB] p-8 md:p-12 text-white flex flex-col justify-between relative overflow-hidden shrink-0">
          <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff08_1px,transparent_1px),linear-gradient(to_bottom,#ffffff08_1px,transparent_1px)] bg-[size:24px_24px] pointer-events-none" />
          <div className="relative z-10">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-white/15 backdrop-blur-lg border border-white/25 shadow-[inset_0_1px_1px_rgba(255,255,255,0.3)] mb-6 md:mb-10">
              <Lock className="w-10 h-10 text-white" />
            </div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-white leading-tight">
              券商金融科技招采情报平台
            </h1>
            <p className="text-sm md:text-base text-white/80 mt-3 font-normal max-w-sm">
              聚合采购公告、智能结构化处理与情报分析
            </p>
          </div>

          <div className="relative z-10 mt-8 md:mt-0">
            <div className="flex flex-wrap gap-2.5">
              {["自动采集", "智能分析", "数据看板"].map((item) => (
                <div
                  key={item}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/15 border border-white/25 text-xs font-semibold text-white shadow-sm backdrop-blur-md"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  {item}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="w-full md:w-[48%] p-8 md:p-12 flex flex-col justify-center bg-white">
          <div className="w-full max-w-[420px] mx-auto space-y-6">
            {mode === "login" && (
              <>
                <div>
                  <h2 className="text-2xl font-bold text-[#172033]">欢迎登录</h2>
                  <p className="text-sm text-[#667085] mt-1.5">
                    使用管理员或已开通用户账号继续
                  </p>
                </div>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="group">
                    <label className="block text-sm font-medium text-[#344054] mb-1.5 group-focus-within:text-[#2563EB] transition-colors">
                      用户名
                    </label>
                    <div className="relative">
                      <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-[#98A2B3] group-focus-within:text-[#2563EB] transition-colors" />
                      <input
                        type="text"
                        value={username}
                        onChange={(event) => setUsername(event.target.value)}
                        placeholder="请输入用户名"
                        className="w-full h-12 pl-11 pr-4 rounded-lg border border-[#E4E9F0] bg-[#F8FAFC] text-sm text-[#172033] placeholder:text-[#98A2B3] focus:outline-none focus:ring-4 focus:ring-[#2563EB]/10 focus:border-[#2563EB] focus:bg-white transition-all"
                        required
                      />
                    </div>
                  </div>
                  <div className="group">
                    <label className="block text-sm font-medium text-[#344054] mb-1.5 group-focus-within:text-[#2563EB] transition-colors">
                      密码
                    </label>
                    <div className="relative">
                      <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-[#98A2B3] group-focus-within:text-[#2563EB] transition-colors" />
                      <input
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        placeholder="请输入密码"
                        className="w-full h-12 pl-11 pr-11 rounded-lg border border-[#E4E9F0] bg-[#F8FAFC] text-sm text-[#172033] placeholder:text-[#98A2B3] focus:outline-none focus:ring-4 focus:ring-[#2563EB]/10 focus:border-[#2563EB] focus:bg-white transition-all"
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#98A2B3] hover:text-[#172033] transition-colors"
                      >
                        {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                      </button>
                    </div>
                  </div>
                  {error && <ErrorMessage message={error} />}
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full h-12 rounded-lg bg-gradient-to-r from-[#162B49] to-[#2563EB] text-white text-sm font-semibold flex items-center justify-center gap-2 shadow-[0_4px_12px_rgba(37,99,235,0.2)] hover:shadow-[0_6px_20px_rgba(37,99,235,0.3)] active:scale-[0.99] transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {loading ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        <span>正在登录...</span>
                      </>
                    ) : (
                      <>
                        <LogIn className="w-4 h-4" />
                        <span>登录</span>
                      </>
                    )}
                  </button>
                </form>
                <div className="pt-4 border-t border-[#F0F2F5] space-y-3">
                  <button
                    type="button"
                    onClick={() => {
                      setMode("apply");
                      setError("");
                    }}
                    className="w-full h-10 rounded-lg border border-[#E4E9F0] text-sm font-semibold text-[#162B49] hover:bg-[#F8FAFC] active:scale-[0.99] transition-all flex items-center justify-center gap-2"
                  >
                    <UserPlus className="w-4 h-4" />
                    申请资格
                  </button>
                  <p className="text-xs text-[#98A2B3] text-center">
                    管理员账号可进入控制台并运行后端任务
                  </p>
                </div>
              </>
            )}

            {mode === "apply" && (
              <>
                <div>
                  <button
                    type="button"
                    onClick={showLogin}
                    className="mb-4 inline-flex items-center gap-1.5 text-xs font-semibold text-[#667085] hover:text-[#172033] transition-colors"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    返回登录
                  </button>
                  <h2 className="text-2xl font-bold text-[#172033]">申请资格</h2>
                  <p className="text-sm text-[#667085] mt-1.5">
                    请使用公司工作邮箱提交资格申请
                  </p>
                </div>
                <form onSubmit={handleApply} className="space-y-4">
                  <TextField label="姓名" value={applyName} onChange={setApplyName} placeholder="张三" />
                  <TextField
                    label="工作邮箱"
                    value={applyEmail}
                    onChange={setApplyEmail}
                    placeholder="example@csco.com.cn"
                    type="email"
                  />
                  <TextField
                    label="部门"
                    value={applyDepartment}
                    onChange={setApplyDepartment}
                    placeholder="信息技术部"
                  />
                  {error && <ErrorMessage message={error} />}
                  <button
                    type="submit"
                    disabled={applyLoading}
                    className="w-full h-12 rounded-lg bg-gradient-to-r from-[#162B49] to-[#2563EB] text-white text-sm font-semibold flex items-center justify-center gap-2 shadow-[0_4px_12px_rgba(37,99,235,0.2)] hover:shadow-[0_6px_20px_rgba(37,99,235,0.3)] active:scale-[0.99] transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {applyLoading ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        <span>正在提交...</span>
                      </>
                    ) : (
                      <>
                        <UserPlus className="w-4 h-4" />
                        <span>提交申请</span>
                      </>
                    )}
                  </button>
                </form>
              </>
            )}

            {mode === "success" && createdCredential && (
              <>
                <div className="text-center">
                  <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-100">
                    <CheckCircle2 className="h-6 w-6" />
                  </div>
                  <h2 className="text-2xl font-bold text-[#172033]">申请成功</h2>
                  <p className="text-sm text-[#667085] mt-1.5">
                    请使用以下账号返回登录页登录
                  </p>
                </div>
                <div className="rounded-xl border border-[#E4E9F0] bg-[#F8FAFC] p-4 space-y-3">
                  <CredentialRow
                    label="用户名"
                    value={createdCredential.username}
                    buttonLabel={copyState === "username" ? "已复制" : "复制用户名"}
                    onCopy={() => void copyText(createdCredential.username, "username")}
                  />
                  <CredentialRow
                    label="初始密码"
                    value={createdCredential.password}
                    buttonLabel={copyState === "password" ? "已复制" : "复制密码"}
                    onCopy={() => void copyText(createdCredential.password, "password")}
                  />
                  {copyState === "failed" && (
                    <p className="text-xs text-red-600 font-medium">复制失败，请手动复制。</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={showLogin}
                  className="w-full h-12 rounded-lg bg-gradient-to-r from-[#162B49] to-[#2563EB] text-white text-sm font-semibold flex items-center justify-center gap-2 shadow-[0_4px_12px_rgba(37,99,235,0.2)] hover:shadow-[0_6px_20px_rgba(37,99,235,0.3)] active:scale-[0.99] transition-all"
                >
                  <ArrowLeft className="w-4 h-4" />
                  返回登录
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  type?: string;
}) {
  return (
    <div className="group">
      <label className="block text-sm font-medium text-[#344054] mb-1.5 group-focus-within:text-[#2563EB] transition-colors">
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full h-12 px-4 rounded-lg border border-[#E4E9F0] bg-[#F8FAFC] text-sm text-[#172033] placeholder:text-[#98A2B3] focus:outline-none focus:ring-4 focus:ring-[#2563EB]/10 focus:border-[#2563EB] focus:bg-white transition-all"
        required
      />
    </div>
  );
}

function ErrorMessage({ message }: { message: string }) {
  return (
    <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 flex items-start gap-1.5">
      <span className="font-semibold select-none shrink-0">提示:</span>
      <span>{message}</span>
    </div>
  );
}

function CredentialRow({
  label,
  value,
  buttonLabel,
  onCopy,
}: {
  label: string;
  value: string;
  buttonLabel: string;
  onCopy: () => void;
}) {
  return (
    <div className="rounded-lg bg-white border border-[#E4E9F0] p-3">
      <p className="text-xs text-[#667085] mb-1">{label}</p>
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-sm font-semibold text-[#172033] truncate">
          {value}
        </span>
        <button
          type="button"
          onClick={onCopy}
          className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-[#E4E9F0] px-2.5 py-1.5 text-xs font-semibold text-[#344054] hover:bg-[#F8FAFC] transition-colors"
        >
          <Clipboard className="w-3.5 h-3.5" />
          {buttonLabel}
        </button>
      </div>
    </div>
  );
}
