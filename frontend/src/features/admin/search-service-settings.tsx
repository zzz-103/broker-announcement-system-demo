"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  KeyRound,
  Loader2,
  Lock,
  RefreshCw,
  Save,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { BackendApiError, isAbortError } from "@/lib/api/backend-client";
import {
  fetchAdminSearchConfig,
  revealAdminSearchConfigKey,
  saveAdminSearchConfig,
  testAdminSearchConfig,
} from "@/lib/api/custom-intelligence";
import type {
  IntelligenceSearchConfigResponse,
  IntelligenceSearchTestRecord,
} from "@/lib/api/contracts";
import { formatDateTime } from "@/lib/display";
import { cn } from "@/lib/utils";

const INPUT_CLASS =
  "w-full rounded-md border border-[#D0D5DD] bg-white px-3 py-2.5 text-sm text-[#172033] outline-none transition placeholder:text-[#98A2B3] focus:border-[#4F7CFF] focus:ring-2 focus:ring-[#4F7CFF]/15";

interface SearchServiceSettingsProps {
  token: string | null;
  onAuthError: () => void;
}

export function SearchServiceSettings({ token, onAuthError }: SearchServiceSettingsProps) {
  const [config, setConfig] = useState<IntelligenceSearchConfigResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(true);
  const [endpoint, setEndpoint] = useState(
    "https://qianfan.baidubce.com/v2/ai_search/web_search",
  );
  const [authHeader, setAuthHeader] = useState("Authorization");
  const [timeoutSeconds, setTimeoutSeconds] = useState(120);
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [apiKeyTouched, setApiKeyTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [revealOpen, setRevealOpen] = useState(false);
  const [revealPassword, setRevealPassword] = useState("");
  const [revealing, setRevealing] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [lastTest, setLastTest] = useState<IntelligenceSearchTestRecord | null>(null);

  const handleError = useCallback(
    (err: unknown, fallback: string) => {
      if (err instanceof BackendApiError && err.status === 401) {
        onAuthError();
        return;
      }
      setError(err instanceof Error ? err.message : fallback);
    },
    [onAuthError],
  );

  const applyConfig = useCallback((next: IntelligenceSearchConfigResponse) => {
    setConfig(next);
    setEnabled(next.enabled);
    setEndpoint(next.endpoint);
    setAuthHeader(next.auth_header);
    setTimeoutSeconds(next.timeout_seconds);
    setApiKeyDraft("");
    setApiKeyTouched(false);
    setLastTest(next.last_test);
  }, []);

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    fetchAdminSearchConfig(token, controller.signal)
      .then(applyConfig)
      .catch((err: unknown) => {
        if (!isAbortError(err)) handleError(err, "无法加载情报搜索服务配置");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [applyConfig, handleError, token]);

  const handleSave = async () => {
    if (!token || saving) return;
    if (!/^https?:\/\/[^\s]+$/i.test(endpoint.trim())) {
      setError("Endpoint 必须是有效的 HTTP 或 HTTPS 地址。");
      return;
    }
    if (!authHeader.trim() || /[\r\n:]/.test(authHeader)) {
      setError("鉴权请求头包含无效字符。");
      return;
    }
    const timeout = Number(timeoutSeconds);
    if (!Number.isFinite(timeout) || timeout < 1 || timeout > 600) {
      setError("请求超时必须为 1-600 秒。");
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const next = await saveAdminSearchConfig(
        token,
        {
          enabled,
          endpoint: endpoint.trim().replace(/\/+$/, ""),
          auth_header: authHeader.trim(),
          timeout_seconds: timeout,
          api_key: apiKeyTouched && apiKeyDraft.trim() ? apiKeyDraft.trim() : undefined,
        },
      );
      applyConfig(next);
      setMessage("配置已保存，无需重启即可生效。");
    } catch (err) {
      handleError(err, "无法保存情报搜索服务配置");
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!token || testing) return;
    setTesting(true);
    setError("");
    setMessage("");
    try {
      const result = await testAdminSearchConfig(token);
      setLastTest(result);
      if (result.status === "success") {
        setMessage(result.message);
      } else {
        setError(result.message);
      }
    } catch (err) {
      handleError(err, "连接测试失败");
    } finally {
      setTesting(false);
    }
  };

  const handleReveal = async () => {
    if (!token || revealing || !revealPassword) return;
    setRevealing(true);
    setError("");
    try {
      const result = await revealAdminSearchConfigKey(token, revealPassword);
      setApiKeyDraft(result.api_key);
      setApiKeyTouched(true);
      setRevealPassword("");
      setRevealOpen(false);
      setMessage("已显示完整 API Key，请勿复制到聊天或外部文档。");
    } catch (err) {
      handleError(err, "无法查看 API Key");
    } finally {
      setRevealing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-[#D9E2EC] bg-white px-4 py-6 text-sm text-[#667085]">
        <Loader2 className="size-4 animate-spin" />
        正在加载情报搜索服务配置…
      </div>
    );
  }

  return (
    <section className="rounded-lg border border-[#D9E2EC] bg-white shadow-[var(--workspace-shadow)]">
      <div className="border-b border-[#E4E9F0] p-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-base font-bold text-[#172033]">百度网页检索服务</h2>
            <p className="mt-1 text-xs leading-5 text-[#667085]">
              仅调用百度 `/v2/ai_search/web_search`，不调用百度模型或智能搜索生成。
            </p>
          </div>
          <label className="inline-flex shrink-0 items-center gap-2 rounded-md border border-[#D0D5DD] bg-white px-3 py-2 text-xs font-semibold text-[#344054]">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
              className="size-4 accent-[#2563EB]"
            />
            {enabled ? "已启用" : "已停用"}
          </label>
        </div>
        {config?.config_source === "env" && (
          <p className="mt-2 text-[11px] text-[#667085]">
            当前尚未保存管理员配置，正在兼容读取环境变量。
          </p>
        )}
      </div>

      <div className="space-y-4 p-5">
        {(message || error) && (
          <div
            role={error ? "alert" : "status"}
            className={cn(
              "flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm",
              error ? "border-red-100 bg-red-50 text-red-700" : "border-blue-100 bg-blue-50 text-blue-700",
            )}
          >
            {error ? <AlertTriangle className="mt-0.5 size-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 size-4 shrink-0" />}
            <span className="whitespace-pre-wrap break-words">{error || message}</span>
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-[#344054]">API Key</label>
            <div className="flex gap-2">
              <div className="relative min-w-0 flex-1">
                <KeyRound className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#98A2B3]" />
                <input
                  type="password"
                  value={apiKeyTouched ? apiKeyDraft : config?.api_key_mask || ""}
                  readOnly={!apiKeyTouched}
                  onChange={(event) => {
                    setApiKeyDraft(event.target.value);
                    setApiKeyTouched(true);
                  }}
                  placeholder="留空保存时保留当前 Key"
                  className={cn(INPUT_CLASS, "pl-9")}
                />
              </div>
              <button
                type="button"
                onClick={() => setRevealOpen(true)}
                disabled={!config?.has_api_key}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[#C8D7F0] px-3 py-2 text-xs font-semibold text-[#315EA8] hover:bg-[#EEF4FF] disabled:cursor-not-allowed disabled:opacity-45"
                title="输入管理员密码查看完整 Key"
              >
                <Eye className="size-3.5" />
                查看
              </button>
            </div>
            <p className="mt-1 text-[10px] text-[#98A2B3]">
              管理员界面只显示掩码；查看完整 Key 需要重新输入管理员密码。
            </p>
          </div>

          <div className="lg:col-span-2">
            <label className="mb-1.5 block text-xs font-semibold text-[#344054]">Endpoint</label>
            <input
              value={endpoint}
              onChange={(event) => setEndpoint(event.target.value)}
              className={INPUT_CLASS}
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold text-[#344054]">鉴权请求头</label>
            <input
              value={authHeader}
              onChange={(event) => setAuthHeader(event.target.value)}
              className={INPUT_CLASS}
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold text-[#344054]">请求超时（秒）</label>
            <input
              type="number"
              min={1}
              max={600}
              value={timeoutSeconds}
              onChange={(event) => setTimeoutSeconds(Number(event.target.value))}
              className={INPUT_CLASS}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-[#E4E9F0] pt-4">
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || testing}
            className="inline-flex items-center gap-1.5 rounded-md bg-[#2563EB] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1D4ED8] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
            保存配置
          </button>
          <button
            type="button"
            onClick={() => void handleTest()}
            disabled={saving || testing}
            className="inline-flex items-center gap-1.5 rounded-md border border-[#C8D7F0] bg-[#F8FAFD] px-4 py-2 text-xs font-semibold text-[#315EA8] hover:bg-[#EEF4FF] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {testing ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            测试连接
          </button>
          <span className="text-[11px] text-[#98A2B3]">
            测试连接会向百度接口发送一次最小请求。
          </span>
        </div>

        <div className="rounded-lg border border-[#E4EAF2] bg-[#F8FAFD] p-4">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-[#344054]">
            <RefreshCw className="size-3.5 text-[#315EA8]" />
            最近测试
          </div>
          <p className="mt-2 text-sm text-[#344054]">
            {lastTest ? lastTest.message : config?.last_test?.message || "尚未执行测试连接。"}
          </p>
          <p className="mt-1 text-[11px] text-[#98A2B3]">
            状态：{lastTest ? (lastTest.status === "success" ? "成功" : "失败") : config?.last_test?.status === "success" ? "成功" : config?.last_test?.status === "failed" ? "失败" : "暂无"}
            {config?.last_test?.tested_at ? ` · ${formatDateTime(config.last_test.tested_at)}` : lastTest?.tested_at ? ` · ${formatDateTime(lastTest.tested_at)}` : ""}
          </p>
        </div>

        <div className="rounded-lg border border-[#E4EAF2] bg-[#F8FAFD] p-4">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-[#344054]">
            <CheckCircle2 className="size-3.5 text-[#2563EB]" />
            DeepSeek 分析服务
          </div>
          <p className="mt-2 text-sm text-[#344054]">
            {config?.analysis_configured ? "已复用现有 LLM 配置，状态可用。" : "未检测到可用 LLM 配置，结构化分析暂不可用。"}
          </p>
        </div>
      </div>

      <Dialog open={revealOpen} onOpenChange={(open) => !revealing && setRevealOpen(open)}>
        <DialogContent className="max-w-md border-[#D9E2EC] bg-white">
          <DialogHeader>
            <DialogTitle className="text-base text-[#172033]">查看完整 API Key</DialogTitle>
            <DialogDescription className="text-[#667085]">
              请输入管理员密码以确认身份，完整 Key 仅显示在当前管理员界面。
            </DialogDescription>
          </DialogHeader>
          <div className="relative">
            <Lock className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[#98A2B3]" />
            <input
              type="password"
              value={revealPassword}
              onChange={(event) => setRevealPassword(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void handleReveal();
              }}
              placeholder="请输入管理员密码"
              autoComplete="current-password"
              className={cn(INPUT_CLASS, "pl-9")}
            />
          </div>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setRevealOpen(false)}
              disabled={revealing}
              className="rounded-md border border-[#D0D5DD] px-3.5 py-2 text-sm font-semibold text-[#475467] hover:bg-white"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => void handleReveal()}
              disabled={revealing || !revealPassword}
              className="inline-flex items-center gap-1.5 rounded-md bg-[#2563EB] px-3.5 py-2 text-sm font-semibold text-white hover:bg-[#1D4ED8] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {revealing && <Loader2 className="size-3.5 animate-spin" />}
              确认并显示
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
