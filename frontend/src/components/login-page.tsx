"use client";

import { useState } from "react";
import { useAuthStore } from "@/store/auth-store";
import { Lock, User, Eye, EyeOff, LogIn } from "lucide-react";

export function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [coords, setCoords] = useState({ x: 0, y: 0 });
  const [isHovered, setIsHovered] = useState(false);
  const [btnCoords, setBtnCoords] = useState({ x: 0, y: 0 });
  const [btnHovered, setBtnHovered] = useState(false);

  const login = useAuthStore((s) => s.login);
  const authError = useAuthStore((s) => s.error);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    const success = await login(username, password);
    if (!success) {
      setError(useAuthStore.getState().error || authError || "登录失败，请检查后端服务和账号密码");
    }
    setLoading(false);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setCoords({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  };

  const handleBtnMouseMove = (e: React.MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setBtnCoords({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  };

  const circleX = isHovered ? (coords.x - 250) * 0.18 : 0;
  const circleY = isHovered ? (coords.y - 300) * 0.18 : 0;

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F5F7FA] p-4 sm:p-6 md:p-8 relative">
      {/* Background soft gradient glows */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[10%] right-[15%] w-[45vw] h-[45vw] max-w-[600px] bg-blue-100/40 rounded-full opacity-60 blur-3xl" />
        <div className="absolute bottom-[10%] left-[10%] w-[40vw] h-[40vw] max-w-[500px] bg-indigo-100/50 rounded-full opacity-60 blur-3xl" />
      </div>

      <div className="relative w-full max-w-[1080px] min-h-[600px] bg-white rounded-[20px] shadow-xl border border-[#E4E9F0] overflow-hidden flex flex-col md:flex-row">
        {/* Left: Brand Visual Area (52% width on desktop) */}
        <div
          onMouseMove={handleMouseMove}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          className="w-full md:w-[52%] bg-gradient-to-br from-[#0F2038] via-[#162B49] to-[#2563EB] p-8 md:p-12 text-white flex flex-col justify-between relative overflow-hidden shrink-0"
        >
          {/* Subtle grid pattern & glow effects */}
          <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff05_1px,transparent_1px),linear-gradient(to_bottom,#ffffff05_1px,transparent_1px)] bg-[size:24px_24px] pointer-events-none" />
          
          {/* Dynamic pointer tracker glow - enhanced */}
          {isHovered && (
            <div
              className="absolute pointer-events-none rounded-full bg-white/[0.15] blur-[70px] transition-opacity duration-300 pointer-events-none"
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

          {/* Top part: Icon & Brand title - enhanced glassmorphism */}
          <div className="relative z-10">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-white/15 backdrop-blur-lg border border-white/25 shadow-[inset_0_1px_1px_rgba(255,255,255,0.3)] mb-6 md:mb-10 transition-transform hover:scale-105 duration-300">
              <Lock className="w-10 h-10 text-white" />
            </div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-white leading-tight">
              券商金融科技招采情报平台
            </h1>
            <p className="text-sm md:text-base text-white/80 mt-3 font-normal max-w-sm">
              聚合招采公告、智能结构化处理与情报分析
            </p>
          </div>

          {/* Bottom part: Features list - enhanced glassmorphism */}
          <div className="relative z-10 mt-8 md:mt-0">
            <div className="flex flex-wrap gap-2.5">
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/15 border border-white/25 text-xs font-semibold text-white shadow-sm backdrop-blur-md shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                自动采集
              </div>
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/15 border border-white/25 text-xs font-semibold text-white shadow-sm backdrop-blur-md shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                智能分析
              </div>
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/15 border border-white/25 text-xs font-semibold text-white shadow-sm backdrop-blur-md shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]">
                <span className="w-1.5 h-1.5 rounded-full bg-fuchsia-400" />
                数据看板
              </div>
            </div>
          </div>
        </div>

        {/* Right: Login Form (48% width on desktop) */}
        <div className="w-full md:w-[48%] p-8 md:p-12 flex flex-col justify-center bg-white">
          <div className="w-full max-w-[420px] mx-auto space-y-6">
            <div>
              <h2 className="text-2xl font-bold text-[#172033]">欢迎登录</h2>
              <p className="text-sm text-[#667085] mt-1.5">
                使用管理员或已审批用户账号继续
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
                    onChange={(e) => setUsername(e.target.value)}
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
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="请输入密码"
                    className="w-full h-12 pl-11 pr-11 rounded-lg border border-[#E4E9F0] bg-[#F8FAFC] text-sm text-[#172033] placeholder:text-[#98A2B3] focus:outline-none focus:ring-4 focus:ring-[#2563EB]/10 focus:border-[#2563EB] focus:bg-white transition-all"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#98A2B3] hover:text-[#172033] transition-colors"
                  >
                    {showPassword ? (
                      <EyeOff className="w-5 h-5" />
                    ) : (
                      <Eye className="w-5 h-5" />
                    )}
                  </button>
                </div>
              </div>

              {error && (
                <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 flex items-start gap-1.5">
                  <span className="font-semibold select-none shrink-0">提示:</span>
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                onMouseMove={handleBtnMouseMove}
                onMouseEnter={() => setBtnHovered(true)}
                onMouseLeave={() => setBtnHovered(false)}
                className="relative overflow-hidden w-full h-12 rounded-lg bg-gradient-to-r from-[#162B49] to-[#2563EB] text-white text-sm font-semibold flex items-center justify-center gap-2 shadow-[0_4px_12px_rgba(37,99,235,0.2)] hover:shadow-[0_6px_20px_rgba(37,99,235,0.3)] active:scale-[0.99] transition-all disabled:opacity-60 disabled:cursor-not-allowed"
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
                <span className="relative z-10 flex items-center justify-center gap-2">
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
                </span>
              </button>
            </form>

            <div className="pt-4 border-t border-[#F0F2F5]">
              <p className="text-xs text-[#98A2B3] text-center">
                管理员账号可进入控制台并运行后端任务
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
