"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { applyForUser, BackendApiError, recordQrVisit } from "@/lib/api/backend-client";
import {
  clearQrVisitMarker,
  getAuditContext,
  hasRecordedQrVisit,
  markQrVisitRecorded,
} from "@/lib/audit-context";
import { useAuthStore } from "@/store/auth-store";
import {
  ArrowLeft,
  AlertTriangle,
  CheckCircle2,
  Clipboard,
  Eye,
  EyeOff,
  Lock,
  LogIn,
  BrainCircuit,
  LayoutDashboard,
  ScanLine,
  User,
  UserPlus,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type LoginMode = "login" | "apply" | "success";

const ANIMATION_MS = 320;
const FIELD_BASE_CLASS =
  "w-full h-11 rounded-lg border bg-white text-sm text-[#172033] placeholder:text-[#98A2B3] shadow-[inset_0_0_0_1000px_white] focus:outline-none focus:ring-4 transition-all disabled:bg-[#F2F4F7] disabled:text-[#98A2B3] disabled:cursor-not-allowed";
const FIELD_NORMAL_CLASS =
  "border-[#D0D5DD] focus:border-[#2563EB] focus:ring-[#2563EB]/10";
const FIELD_ERROR_CLASS =
  "border-red-300 focus:border-red-500 focus:ring-red-500/10";
const EMAIL_DOMAINS = ["csco.com.cn", "qq.com", "126.com", "163.com", "sina.com"] as const;

function validateEmailParts(prefix: string, domain: string): string | null {
  const normalizedPrefix = prefix.trim();
  if (!normalizedPrefix) return "请输入邮箱前缀。";
  if (normalizedPrefix.length < 2 || normalizedPrefix.length > 30) return "邮箱前缀长度需为 2 至 30 个字符。";
  if (!/^[A-Za-z0-9_.-]+$/.test(normalizedPrefix)) return "邮箱前缀仅支持字母、数字、下划线、点和短横线。";
  if (/^[.-]|[.-]$/.test(normalizedPrefix)) return "邮箱前缀不能以点或短横线开头、结尾。";
  if (/\.\./.test(normalizedPrefix)) return "邮箱前缀不能包含连续两个点。";
  if (!domain) return "请输入邮箱域名。";
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) {
    return "请输入有效的邮箱域名。";
  }
  return null;
}

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
  const [applyEmailPrefix, setApplyEmailPrefix] = useState("");
  const [applyEmailDomain, setApplyEmailDomain] = useState<(typeof EMAIL_DOMAINS)[number] | "other">("csco.com.cn");
  const [customEmailDomain, setCustomEmailDomain] = useState("");
  const [emailError, setEmailError] = useState("");
  const [showExternalEmailConfirm, setShowExternalEmailConfirm] = useState(false);
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
  const applySubmittingRef = useRef(false);

  const login = useAuthStore((s) => s.login);
  const authError = useAuthStore((s) => s.error);

  useEffect(() => {
    const context = getAuditContext();
    if (!context.source || !context.visitor_id || hasRecordedQrVisit()) return;
    markQrVisitRecorded();
    void recordQrVisit({ visitor_id: context.visitor_id, source: context.source }).catch(() => {
      clearQrVisitMarker();
    });
  }, []);

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

  const getNormalizedEmail = () => {
    const prefix = applyEmailPrefix.trim();
    const domain = (applyEmailDomain === "other" ? customEmailDomain : applyEmailDomain)
      .trim()
      .replace(/^@+/, "")
      .toLowerCase();
    return { prefix, domain, email: `${prefix}@${domain}` };
  };

  const submitApplication = async () => {
    if (applySubmittingRef.current) return;
    applySubmittingRef.current = true;
    const { email } = getNormalizedEmail();
    setError("");
    setCopyState("idle");
    setApplyLoading(true);
    try {
      const result = await applyForUser({
        name: applyName,
        email,
        department: applyDepartment,
        ...getAuditContext(),
      });
      setCreatedCredential({
        username: result.username,
        password: result.initial_password,
      });
      setApplyName("");
      setApplyEmailPrefix("");
      setApplyEmailDomain("csco.com.cn");
      setCustomEmailDomain("");
      setApplyDepartment("");
      setShowExternalEmailConfirm(false);
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
      applySubmittingRef.current = false;
      setApplyLoading(false);
    }
  };

  const handleApply = async (event: React.FormEvent) => {
    event.preventDefault();
    const { prefix, domain } = getNormalizedEmail();
    const validationError = validateEmailParts(prefix, domain);
    setEmailError(validationError ?? "");
    if (validationError) return;
    if (domain !== "csco.com.cn") {
      setShowExternalEmailConfirm(true);
      return;
    }
    await submitApplication();
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
    <div
      translate="no"
      className="notranslate relative flex min-h-dvh items-start justify-center overflow-x-hidden bg-[#F5F7FA] px-3 py-3 sm:p-6 md:items-center md:p-8"
    >
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[10%] right-[15%] w-[45vw] h-[45vw] max-w-[600px] bg-blue-100/40 rounded-full opacity-60 blur-3xl" />
        <div className="absolute bottom-[10%] left-[10%] w-[40vw] h-[40vw] max-w-[500px] bg-indigo-100/50 rounded-full opacity-60 blur-3xl" />
      </div>
      <div className="relative flex w-full max-w-[1160px] flex-col overflow-hidden rounded-[20px] border border-[#E4E9F0] bg-white shadow-[0_24px_70px_rgba(15,32,56,0.16)] md:min-h-[640px] md:flex-row">
        <div
          onMouseMove={handleMouseMove}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          className="relative flex w-full shrink-0 flex-col overflow-hidden bg-[radial-gradient(circle_at_84%_20%,rgba(49,130,246,0.32),transparent_30%),linear-gradient(145deg,#071a38_0%,#0c2a58_52%,#0e4bb5_100%)] p-6 text-white md:w-[55%] md:p-12"
        >
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,#ffffff0d_1px,transparent_1px),linear-gradient(to_bottom,#ffffff0d_1px,transparent_1px)] bg-[size:28px_28px] opacity-60" />
          <div className="pointer-events-none absolute inset-x-[-12%] bottom-[-18%] h-[52%] rotate-[-8deg] bg-[radial-gradient(ellipse_at_center,rgba(37,99,235,0.72)_0%,rgba(37,99,235,0.16)_34%,transparent_68%)] blur-xl" />
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
          <div className="relative z-10 flex h-full flex-col">
            <div className="flex items-center gap-3">
              <Image src="/brand/company-icon.png" alt="世纪证券" width={52} height={52} className="size-11 rounded-xl shadow-[0_8px_18px_rgba(0,0,0,0.22)] md:size-[52px]" priority />
              <div className="leading-tight"><p className="text-lg font-semibold tracking-[0.12em] text-white">世纪证券</p><p className="mt-0.5 text-[10px] font-medium tracking-[0.18em] text-blue-100/80">CENTURY SECURITIES</p></div>
            </div>
            <div className="mt-10 max-w-[440px] md:mt-20">
              <h1 className="text-[32px] font-bold leading-[1.25] tracking-tight text-white md:text-[46px]">世纪证券<br className="hidden md:block" />业务信息平台</h1>
              <p className="mt-4 max-w-md text-sm leading-relaxed text-blue-100/85 md:text-base">聚合招采公告、券商 App 更新与业务动态分析</p>
            </div>
            <div className="mt-8 grid grid-cols-3 gap-2.5 md:mt-auto md:gap-5">
              {[
                { label: "自动采集", detail: "全网公告实时抓取", Icon: ScanLine },
                { label: "智能分析", detail: "AI结构化处理", Icon: BrainCircuit },
                { label: "数据看板", detail: "多维情报洞察", Icon: LayoutDashboard },
              ].map(({ label, detail, Icon }) => (
                <div key={label} className="min-w-0 border-t border-white/20 pt-3 md:pt-4">
                  <span className="flex size-8 items-center justify-center rounded-lg border border-blue-200/55 bg-white/10 text-blue-50 backdrop-blur-sm md:size-10"><Icon className="size-4 md:size-5" /></span>
                  <p className="mt-2 text-xs font-bold text-white md:text-sm">{label}</p>
                  <p className="mt-1 hidden text-[11px] leading-relaxed text-blue-100/70 md:block">{detail}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex w-full flex-col justify-center bg-white px-5 py-8 sm:px-8 md:w-[45%] md:px-12 md:py-12">
          <div className="relative mx-auto h-[470px] w-full max-w-[390px] overflow-hidden sm:h-[490px]">
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
                  <div className="group">
                    <label className="block text-sm font-medium text-[#344054] mb-1.5 group-focus-within:text-[#2563EB] transition-colors">工作邮箱</label>
                    <div className={`flex h-11 min-w-0 overflow-hidden rounded-lg border bg-white transition-all focus-within:ring-2 ${emailError ? "border-red-300 focus-within:border-red-500 focus-within:ring-red-500/10" : "border-[#D0D5DD] focus-within:border-[#2563EB] focus-within:ring-[#2563EB]/10"}`}>
                      <input
                        value={applyEmailPrefix}
                        onChange={(event) => {
                          setApplyEmailPrefix(event.target.value);
                          if (emailError) setEmailError("");
                        }}
                        placeholder="请输入邮箱前缀"
                        className="min-w-0 flex-1 border-0 bg-transparent px-3 text-sm text-[#172033] placeholder:text-[#98A2B3] outline-none"
                        aria-invalid={Boolean(emailError)}
                      />
                      <span className="flex w-7 shrink-0 items-center justify-center text-sm font-medium text-[#98A2B3]">@</span>
                      {applyEmailDomain === "other" ? (
                        <div className="flex w-[42%] max-w-[148px] min-w-0 shrink-0 items-center border-l border-[#EAECF0] bg-[#F8FAFC]">
                          <input
                            value={customEmailDomain}
                            onChange={(event) => {
                              setCustomEmailDomain(event.target.value.replace(/^@+/, "").trim().toLowerCase());
                              if (emailError) setEmailError("");
                            }}
                            placeholder="请输入邮箱域名"
                            className="min-w-0 flex-1 border-0 bg-transparent px-2.5 text-sm text-[#172033] placeholder:text-[#98A2B3] outline-none"
                            aria-label="自定义邮箱域名"
                          />
                          <button type="button" onClick={() => setApplyEmailDomain("csco.com.cn")} className="shrink-0 px-2 text-[11px] font-semibold text-[#2563EB] hover:text-blue-700">预设</button>
                        </div>
                      ) : (
                        <select
                          value={applyEmailDomain}
                          onChange={(event) => {
                            setApplyEmailDomain(event.target.value as (typeof EMAIL_DOMAINS)[number] | "other");
                            if (emailError) setEmailError("");
                          }}
                          className="w-[42%] max-w-[148px] shrink-0 border-l border-[#EAECF0] bg-[#F8FAFC] px-2.5 text-sm font-medium text-[#475467] outline-none"
                          aria-label="邮箱域名"
                        >
                          {EMAIL_DOMAINS.map((domain) => <option key={domain} value={domain}>{domain}</option>)}
                          <option value="other">其他（自定义）</option>
                        </select>
                      )}
                    </div>
                    <p className={`mt-1.5 flex items-start gap-1.5 text-xs leading-relaxed ${applyEmailDomain === "csco.com.cn" ? "text-[#667085]" : "text-amber-700"}`}>
                      {applyEmailDomain === "csco.com.cn" ? "当前仅开放世纪证券内部邮箱申请，请使用 @csco.com.cn 工作邮箱。" : <><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />当前体验仅对世纪证券内部开放，使用非 @csco.com.cn 邮箱可能无法通过资格审核。</>}
                    </p>
                    {emailError && <p className="mt-1.5 text-xs font-medium text-red-600">{emailError}</p>}
                  </div>
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
                    disabled={applyLoading || isTransitioning}
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
      <Dialog open={showExternalEmailConfirm} onOpenChange={(open) => !applyLoading && setShowExternalEmailConfirm(open)}>
        <DialogContent className="border-[#D9E2EC] bg-white sm:max-w-md" showCloseButton={!applyLoading}>
          <DialogHeader>
            <DialogTitle className="text-[#172033]">确认提交申请</DialogTitle>
            <DialogDescription className="text-[#667085]">您使用的是非世纪证券内部邮箱，当前体验优先审核 @csco.com.cn 邮箱申请。确定要使用该邮箱提交吗？</DialogDescription>
          </DialogHeader>
          {error && <ErrorMessage message={error} />}
          <DialogFooter>
            <button type="button" disabled={applyLoading} onClick={() => setShowExternalEmailConfirm(false)} className="h-10 rounded-lg border border-[#D0D5DD] px-4 text-sm font-semibold text-[#475467] hover:bg-[#F8FAFC] disabled:cursor-not-allowed disabled:opacity-60">取消</button>
            <button type="button" disabled={applyLoading} onClick={() => void submitApplication()} className="h-10 rounded-lg bg-[#2563EB] px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60">{applyLoading ? "正在提交..." : "确认提交"}</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
