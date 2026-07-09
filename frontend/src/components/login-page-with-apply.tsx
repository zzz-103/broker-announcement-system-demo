"use client";

import { useEffect, useState } from "react";
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

const ANIMATION_MS = 320;
const FIELD_BASE_CLASS =
  "w-full h-11 rounded-lg border bg-white text-sm text-[#172033] placeholder:text-[#98A2B3] shadow-[inset_0_0_0_1000px_white] focus:outline-none focus:ring-4 transition-all disabled:bg-[#F2F4F7] disabled:text-[#98A2B3] disabled:cursor-not-allowed";
const FIELD_NORMAL_CLASS =
  "border-[#D0D5DD] focus:border-[#2563EB] focus:ring-[#2563EB]/10";
const FIELD_ERROR_CLASS =
  "border-red-300 focus:border-red-500 focus:ring-red-500/10";

export function LoginPageWithApply() {
  const [mode, setMode] = useState<LoginMode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [applyLoading, setApplyLoading] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [applyName, setApplyName] = useState("");
  const [applyEmail, setApplyEmail] = useState("");
  const [applyDepartment, setApplyDepartment] = useState("");
  const [createdCredential, setCreatedCredential] = useState<{
    username: string;
    password: string;
  } | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "username" | "password" | "failed">("idle");
  const [coords, setCoords] = useState({ x: 0, y: 0 });
  const [isHovered, setIsHovered] = useState(false);
  const [btnCoords, setBtnCoords] = useState({ x: 0, y: 0 });
  const [btnHovered, setBtnHovered] = useState(false);

  const login = useAuthStore((s) => s.login);
  const authError = useAuthStore((s) => s.error);

  useEffect(() => {
    if (!isTransitioning) return;
    const timer = window.setTimeout(() => setIsTransitioning(false), ANIMATION_MS);
    return () => window.clearTimeout(timer);
  }, [isTransitioning, mode]);

  const transitionToMode = (nextMode: LoginMode, force = false) => {
    if ((!force && isTransitioning) || nextMode === mode) return;
    setIsTransitioning(true);
    setMode(nextMode);
  };

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
      transitionToMode("success", true);
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
    transitionToMode("login");
    setError("");
    setCopyState("idle");
  };

  const handleMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setCoords({
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });
  };

  const handleBtnMouseMove = (event: React.MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setBtnCoords({
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });
  };

  const circleX = isHovered ? (coords.x - 250) * 0.18 : 0;
  const circleY = isHovered ? (coords.y - 300) * 0.18 : 0;
  const modeIndex = mode === "login" ? 0 : 1;

  const getPanelClass = (panelMode: LoginMode) => {
    const panelIndex = panelMode === "login" ? 0 : 1;
    const isActive = mode === panelMode;
    const translate =
      panelIndex === modeIndex ? "translate-x-0" : panelIndex < modeIndex ? "-translate-x-full" : "translate-x-full";
    return `absolute inset-0 overflow-y-auto pr-1 transition-all duration-300 ease-out motion-reduce:transition-opacity motion-reduce:duration-150 ${translate} ${
      isActive ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
    }`;
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F5F7FA] p-4 sm:p-6 md:p-8 relative">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[10%] right-[15%] w-[45vw] h-[45vw] max-w-[600px] bg-blue-100/40 rounded-full opacity-60 blur-3xl" />
        <div className="absolute bottom-[10%] left-[10%] w-[40vw] h-[40vw] max-w-[500px] bg-indigo-100/50 rounded-full opacity-60 blur-3xl" />
      </div>
      <div className="relative w-full max-w-[1080px] min-h-[560px] bg-white rounded-[20px] shadow-xl border border-[#E4E9F0] overflow-hidden flex flex-col md:flex-row">
        <div
          onMouseMove={handleMouseMove}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          className="w-full md:w-[52%] bg-gradient-to-br from-[#0F2038] via-[#162B49] to-[#2563EB] p-8 md:p-12 text-white flex flex-col justify-start relative overflow-hidden shrink-0"
        >
          <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff08_1px,transparent_1px),linear-gradient(to_bottom,#ffffff08_1px,transparent_1px)] bg-[size:24px_24px] pointer-events-none" />
          {isHovered && (
            <div
              className="absolute pointer-events-none rounded-full bg-white/[0.15] blur-[70px] transition-opacity duration-300"
              style={{
                width: "320px",
                height: "320px",
                left: `${coords.x - 160}px`,
                top: `${coords.y - 160}px`,
                transform: "translate3d(0, 0, 0)",
              }}
            />
          )}
          <div
            className="absolute -top-20 -left-20 w-60 h-60 bg-blue-500/18 rounded-full blur-3xl pointer-events-none transition-transform duration-500 ease-out"
            style={{ transform: `translate3d(${circleX}px, ${circleY}px, 0)` }}
          />
          <div
            className="absolute -bottom-20 -right-20 w-60 h-60 bg-indigo-500/22 rounded-full blur-3xl pointer-events-none transition-transform duration-700 ease-out"
            style={{ transform: `translate3d(${-circleX}px, ${-circleY}px, 0)` }}
          />
          <div className="relative z-10 max-w-md space-y-6 md:mt-8">
            <div className="inline-flex items-center justify-center w-16 h-16 md:w-[72px] md:h-[72px] rounded-2xl bg-white/15 backdrop-blur-lg border border-white/25 shadow-[inset_0_1px_1px_rgba(255,255,255,0.3)]">
              <Lock className="w-10 h-10 text-white" />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-white leading-tight">
                券商金融科技招采情报平台
              </h1>
              <p className="text-sm md:text-base text-white/80 mt-3 font-normal max-w-sm">
                聚合采购公告、智能结构化处理与情报分析
              </p>
            </div>
            <div className="flex flex-wrap gap-2.5 pt-1">
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

        <div className="w-full md:w-[48%] p-6 sm:p-8 md:p-12 flex flex-col justify-center bg-white">
          <div className="relative w-full max-w-[420px] mx-auto h-[410px] sm:h-[430px] max-h-[calc(100vh-7rem)] overflow-hidden">
            <div className={getPanelClass("login")} aria-hidden={mode !== "login"}>
              <div className="space-y-5">
                <div className="space-y-1">
                  <h2 className="text-2xl font-bold text-[#172033]">欢迎登录</h2>
                  <p className="text-sm text-[#667085]">
                    使用管理员或已开通用户账号继续
                  </p>
                </div>
                <form onSubmit={handleSubmit} className="space-y-3.5">
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
                        className={`${FIELD_BASE_CLASS} ${error ? FIELD_ERROR_CLASS : FIELD_NORMAL_CLASS} pl-11 pr-4`}
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
                        className={`${FIELD_BASE_CLASS} ${error ? FIELD_ERROR_CLASS : FIELD_NORMAL_CLASS} pl-11 pr-11`}
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
                    onMouseMove={handleBtnMouseMove}
                    onMouseEnter={() => setBtnHovered(true)}
                    onMouseLeave={() => setBtnHovered(false)}
                    className="relative overflow-hidden w-full h-11 rounded-lg bg-gradient-to-r from-[#162B49] to-[#2563EB] text-white text-sm font-semibold flex items-center justify-center gap-2 shadow-[0_4px_12px_rgba(37,99,235,0.2)] hover:shadow-[0_6px_20px_rgba(37,99,235,0.3)] active:scale-[0.99] transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {btnHovered && !loading && (
                      <span
                        className="absolute pointer-events-none rounded-full bg-white/20 blur-md transition-opacity duration-300"
                        style={{
                          width: "80px",
                          height: "80px",
                          left: `${btnCoords.x - 40}px`,
                          top: `${btnCoords.y - 40}px`,
                          transform: "translate3d(0, 0, 0)",
                        }}
                      />
                    )}
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
                <div className="pt-3 border-t border-[#F0F2F5] space-y-3">
                  <button
                    type="button"
                    onClick={() => {
                      transitionToMode("apply");
                      setError("");
                    }}
                    disabled={isTransitioning}
                    className="w-full h-10 rounded-lg border border-[#D0D5DD] text-sm font-semibold text-[#162B49] hover:bg-[#F8FAFC] active:scale-[0.99] transition-all flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    <UserPlus className="w-4 h-4" />
                    申请体验
                  </button>
                </div>
              </div>
            </div>

            <div className={getPanelClass("apply")} aria-hidden={mode !== "apply"}>
              <div className="space-y-5">
                <div className="space-y-1">
                  <button
                    type="button"
                    onClick={showLogin}
                    disabled={isTransitioning}
                    className="mb-3 inline-flex items-center gap-1.5 text-xs font-semibold text-[#667085] hover:text-[#172033] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    返回登录
                  </button>
                  <h2 className="text-2xl font-bold text-[#172033]">资格体验</h2>
                  <p className="text-sm text-[#667085]">
                    请使用公司工作邮箱提交资格申请
                  </p>
                </div>
                <form onSubmit={handleApply} className="space-y-3.5">
                  <TextField label="姓名" value={applyName} onChange={setApplyName} placeholder="示例：张三" hasError={Boolean(error)} />
                  <TextField
                    label="工作邮箱"
                    value={applyEmail}
                    onChange={setApplyEmail}
                    placeholder="示例：example@csco.com.cn"
                    type="email"
                    hasError={Boolean(error)}
                  />
                  <TextField
                    label="部门"
                    value={applyDepartment}
                    onChange={setApplyDepartment}
                    placeholder="示例：信息技术部"
                    hasError={Boolean(error)}
                  />
                  {error && <ErrorMessage message={error} />}
                  <button
                    type="submit"
                    disabled={applyLoading}
                    onMouseMove={handleBtnMouseMove}
                    onMouseEnter={() => setBtnHovered(true)}
                    onMouseLeave={() => setBtnHovered(false)}
                    className="relative overflow-hidden w-full h-11 rounded-lg bg-gradient-to-r from-[#162B49] to-[#2563EB] text-white text-sm font-semibold flex items-center justify-center gap-2 shadow-[0_4px_12px_rgba(37,99,235,0.2)] hover:shadow-[0_6px_20px_rgba(37,99,235,0.3)] active:scale-[0.99] transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {btnHovered && !applyLoading && (
                      <span
                        className="absolute pointer-events-none rounded-full bg-white/20 blur-md transition-opacity duration-300"
                        style={{
                          width: "80px",
                          height: "80px",
                          left: `${btnCoords.x - 40}px`,
                          top: `${btnCoords.y - 40}px`,
                          transform: "translate3d(0, 0, 0)",
                        }}
                      />
                    )}
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
              </div>
            </div>

            <div className={getPanelClass("success")} aria-hidden={mode !== "success"}>
              {createdCredential && (
                <div className="space-y-5">
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
                  disabled={isTransitioning}
                  className="w-full h-11 rounded-lg bg-gradient-to-r from-[#162B49] to-[#2563EB] text-white text-sm font-semibold flex items-center justify-center gap-2 shadow-[0_4px_12px_rgba(37,99,235,0.2)] hover:shadow-[0_6px_20px_rgba(37,99,235,0.3)] active:scale-[0.99] transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <ArrowLeft className="w-4 h-4" />
                  返回登录
                </button>
                </div>
              )}
            </div>
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
  hasError = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  type?: string;
  hasError?: boolean;
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
        className={`${FIELD_BASE_CLASS} ${hasError ? FIELD_ERROR_CLASS : FIELD_NORMAL_CLASS} px-4`}
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
