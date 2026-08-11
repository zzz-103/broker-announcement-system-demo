"use client";

import { useCallback, useEffect, useState } from "react";
import { BackendApiError, isAbortError } from "@/lib/api/backend-client";
import {
  createAssistantExecution,
  createAssistantTopic,
  deleteAssistantTopic,
  downloadCustomIntelligenceReportPdf,
  executeAssistantTopic,
  fetchAssistantExecution,
  fetchAssistantExecutions,
  fetchAssistantTopics,
  fetchCustomIntelligenceOptions,
  reanalyzeAssistantExecution,
  rerunAssistantExecution,
  sendAssistantExecutionEmail,
  updateAssistantTopic,
} from "@/lib/api/custom-intelligence";
import type {
  IntelligenceAssistantEmailInput,
  IntelligenceAssistantExecution,
  IntelligenceAssistantRequest,
  IntelligenceAssistantTopic,
} from "@/lib/api/contracts";
import { useAuthStore } from "@/store/auth-store";
import { DEFAULT_FORM, EXECUTIONS_PAGE_SIZE, TOPIC_LIMIT } from "./custom-intelligence-constants";
import type { CustomIntelligenceTab } from "./custom-intelligence-types";

function isActive(execution: IntelligenceAssistantExecution): boolean {
  return execution.status === "pending" || execution.status === "running";
}
function mergeExecution(list: IntelligenceAssistantExecution[], incoming: IntelligenceAssistantExecution): IntelligenceAssistantExecution[] {
  const index = list.findIndex((item) => item.id === incoming.id);
  if (index < 0) return [incoming, ...list];
  const next = [...list];
  next[index] = incoming;
  return next;
}
function formFromTopic(topic: IntelligenceAssistantTopic): IntelligenceAssistantRequest {
  return { audience: topic.audience, audience_detail: topic.audience_detail, focus_tags: [...topic.focus_tags], focus: topic.focus, extra_focus: topic.extra_focus, time_range: topic.time_range, report_length: topic.report_length };
}
function formFromExecution(execution: IntelligenceAssistantExecution): IntelligenceAssistantRequest {
  const snapshot = execution.snapshot;
  return {
    audience: snapshot.audience ?? DEFAULT_FORM.audience,
    audience_detail: snapshot.audience_detail ?? "",
    focus_tags: [...(snapshot.focus_tags ?? [])],
    focus: snapshot.focus ?? execution.original_query ?? "",
    extra_focus: snapshot.extra_focus ?? "",
    time_range: snapshot.time_range ?? DEFAULT_FORM.time_range,
    report_length: snapshot.report_length ?? DEFAULT_FORM.report_length,
  };
}
function readableError(error: unknown, fallback: string): string {
  if (error instanceof BackendApiError) {
    if (error.status === 401) return "登录已失效，请重新登录。";
    if (error.status === 409) return error.message || "已有一条报告正在生成，请稍后再试。";
    if (error.status === 422) return `请求参数有误：${error.message}`;
    if (error.status === 0) return "无法访问后端服务，请检查服务状态后重试。";
    return error.message || fallback;
  }
  return error instanceof Error && error.message ? error.message : fallback;
}

export interface CustomIntelligencePageController {
  isHydrated: boolean; isLoggedIn: boolean; isAdmin: boolean; username: string; logout: () => void;
  activeTab: CustomIntelligenceTab; setActiveTab: (tab: CustomIntelligenceTab) => void;
  form: IntelligenceAssistantRequest; setForm: (value: IntelligenceAssistantRequest) => void;
  optionsLoading: boolean; serviceAvailable: boolean;
  topics: IntelligenceAssistantTopic[]; executions: IntelligenceAssistantExecution[]; executionsTotal: number; executionsPage: number; executionsTotalPages: number; loadingExecutions: boolean;
  activeExecutionId: number | null; pageError: string; notice: string;
  workspaceMode: boolean; workspaceExecution: IntelligenceAssistantExecution | null; selectedConfigId: number | null;
  configDialogOpen: boolean; setConfigDialogOpen: (open: boolean) => void; configEditorId: number | null; configName: string; setConfigName: (value: string) => void; configDraft: IntelligenceAssistantRequest; setConfigDraft: (value: IntelligenceAssistantRequest) => void; configSaving: boolean; configsLimitReached: boolean;
  selectedExecution: IntelligenceAssistantExecution | null; reportDialogOpen: boolean; setReportDialogOpen: (open: boolean) => void; reportLoading: boolean; pdfExporting: boolean;
  emailDialogOpen: boolean; emailExecution: IntelligenceAssistantExecution | null; emailSending: boolean;
  clearMessages: () => void; loadExecutions: (page?: number, signal?: AbortSignal) => Promise<void>; submitInstant: () => Promise<void>; resetWorkspace: () => void; exportReportPdf: (execution: IntelligenceAssistantExecution) => Promise<void>;
  applySavedConfigValue: (value: string) => void; loadConfigIntoForm: (topic: IntelligenceAssistantTopic) => void; loadAndSearchConfig: (topic: IntelligenceAssistantTopic) => Promise<void>; openCreateConfig: () => void; openSaveCurrentConfig: () => void; openEditConfig: (topic: IntelligenceAssistantTopic) => void; saveConfig: () => Promise<void>; deleteConfig: (topic: IntelligenceAssistantTopic) => Promise<void>; openReport: (execution: IntelligenceAssistantExecution) => Promise<void>; rerun: (execution: IntelligenceAssistantExecution) => Promise<void>; reanalyze: (execution: IntelligenceAssistantExecution) => Promise<void>; openEmail: (execution: IntelligenceAssistantExecution | null) => void; sendEmail: (recipients: string[], format: "html" | "pdf", externalConfirmed: boolean) => Promise<void>;
}

export function useCustomIntelligencePage(): CustomIntelligencePageController {
  const { isHydrated, isLoggedIn, isAdmin, username, token, logout, clearAuth, restoreSession } = useAuthStore();
  const [activeTab, setActiveTab] = useState<CustomIntelligenceTab>("generate");
  const [form, setForm] = useState(DEFAULT_FORM);
  const [topics, setTopics] = useState<IntelligenceAssistantTopic[]>([]);
  const [executions, setExecutions] = useState<IntelligenceAssistantExecution[]>([]);
  const [executionsTotal, setExecutionsTotal] = useState(0);
  const [executionsPage, setExecutionsPage] = useState(1);
  const [executionsTotalPages, setExecutionsTotalPages] = useState(1);
  const [loadingExecutions, setLoadingExecutions] = useState(false);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [serviceAvailable, setServiceAvailable] = useState(true);
  const [activeExecutionId, setActiveExecutionId] = useState<number | null>(null);
  const [pageError, setPageError] = useState("");
  const [notice, setNotice] = useState("");
  const [workspaceMode, setWorkspaceMode] = useState(false);
  const [workspaceExecution, setWorkspaceExecution] = useState<IntelligenceAssistantExecution | null>(null);
  const [selectedConfigId, setSelectedConfigId] = useState<number | null>(null);
  const [selectedExecution, setSelectedExecution] = useState<IntelligenceAssistantExecution | null>(null);
  const [reportDialogOpen, setReportDialogOpen] = useState(false);
  const [reportLoading, setReportLoading] = useState(false);
  const [pdfExporting, setPdfExporting] = useState(false);
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [emailExecution, setEmailExecution] = useState<IntelligenceAssistantExecution | null>(null);
  const [emailSending, setEmailSending] = useState(false);
  const [configDialogOpen, setConfigDialogOpen] = useState(false);
  const [configEditorId, setConfigEditorId] = useState<number | null>(null);
  const [configName, setConfigName] = useState("");
  const [configDraft, setConfigDraft] = useState<IntelligenceAssistantRequest>(DEFAULT_FORM);
  const [configSaving, setConfigSaving] = useState(false);
  const configsLimitReached = topics.length >= TOPIC_LIMIT;

  useEffect(() => { restoreSession(); }, [restoreSession]);

  const handleError = useCallback((error: unknown, fallback: string) => {
    if (error instanceof BackendApiError && error.status === 401) { clearAuth("登录已失效，请重新登录"); return; }
    setPageError(readableError(error, fallback));
  }, [clearAuth]);

  const loadExecutions = useCallback(async (page = 1, signal?: AbortSignal) => {
    if (!token) return;
    setLoadingExecutions(true);
    try {
      const response = await fetchAssistantExecutions(token, page, EXECUTIONS_PAGE_SIZE, signal);
      setExecutions(response.executions); setExecutionsTotal(response.meta.total); setExecutionsPage(response.meta.page); setExecutionsTotalPages(response.meta.total_pages);
      const active = response.executions.find(isActive); if (active) { setActiveExecutionId(active.id); setWorkspaceExecution(active); setWorkspaceMode(true); }
    } catch (error) { if (!isAbortError(error)) handleError(error, "无法加载历史报告"); }
    finally { if (!signal?.aborted) setLoadingExecutions(false); }
  }, [handleError, token]);

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    setOptionsLoading(true);
    Promise.allSettled([
      fetchCustomIntelligenceOptions(token, controller.signal),
      fetchAssistantTopics(token, controller.signal),
      fetchAssistantExecutions(token, 1, EXECUTIONS_PAGE_SIZE, controller.signal),
    ]).then((results) => {
      if (controller.signal.aborted) return;
      const options = results[0];
      if (options.status === "fulfilled") setServiceAvailable(options.value.service_status === "enabled");
      else setServiceAvailable(true);
      const topicResult = results[1];
      if (topicResult.status === "fulfilled") setTopics(topicResult.value.topics);
      const executionResult = results[2];
      if (executionResult.status === "fulfilled") {
        setExecutions(executionResult.value.executions); setExecutionsTotal(executionResult.value.meta.total); setExecutionsPage(executionResult.value.meta.page); setExecutionsTotalPages(executionResult.value.meta.total_pages);
        const active = executionResult.value.executions.find(isActive);
        if (active) { setActiveExecutionId(active.id); setWorkspaceExecution(active); setWorkspaceMode(true); }
      }
      if (results.some((result) => result.status === "rejected" && !isAbortError(result.reason))) setNotice("部分助手数据暂时不可用，可以稍后刷新重试。");
    }).finally(() => { if (!controller.signal.aborted) setOptionsLoading(false); });
    return () => controller.abort();
  }, [token]);

  useEffect(() => {
    if (!token || activeExecutionId === null) return;
    let disposed = false; let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const response = await fetchAssistantExecution(token, activeExecutionId);
        if (disposed) return;
        const execution = response.execution;
        setExecutions((current) => mergeExecution(current, execution)); setSelectedExecution((current) => current?.id === execution.id ? execution : current); setWorkspaceExecution((current) => current?.id === execution.id ? execution : current);
        if (isActive(execution)) timer = setTimeout(poll, 2000);
        else { setActiveExecutionId(null); setNotice(execution.status === "succeeded" ? "报告已生成。" : execution.error_message || "本次生成已结束。"); void loadExecutions(1); }
      } catch (error) {
        if (!disposed) { setPageError(readableError(error, "报告状态暂时无法更新；系统会继续重试。")); timer = setTimeout(poll, 5000); }
      }
    };
    timer = setTimeout(poll, 1200);
    return () => { disposed = true; if (timer) clearTimeout(timer); };
  }, [activeExecutionId, loadExecutions, token]);

  const startExecution = (execution: IntelligenceAssistantExecution) => { setExecutions((current) => mergeExecution(current, execution)); setActiveExecutionId(execution.id); setWorkspaceExecution(execution); setSelectedExecution(execution); setWorkspaceMode(true); setPageError(""); };
  const submitInstant = async () => {
    if (!token || activeExecutionId !== null) return;
    if (!serviceAvailable) { setPageError("情报搜索服务暂不可用，请联系管理员。"); return; }
    if (!form.focus.trim()) { setPageError("请先填写你想了解的业务问题。"); return; }
    if (form.audience === "custom" && !form.audience_detail.trim()) { setPageError("选择自定义受众后，请补充读者背景。"); return; }
    try { const response = await createAssistantExecution(token, { ...form, focus: form.focus.trim(), focus_tags: form.focus_tags.slice(0, 3) }); startExecution(response.execution); setNotice("已提交，正在检索和整理资料…"); }
    catch (error) { handleError(error, "无法生成情报报告"); }
  };
  const resetWorkspace = () => { setWorkspaceMode(false); setWorkspaceExecution(null); setPageError(""); setNotice(""); document.getElementById("custom-intelligence-focus")?.focus(); };
  const exportReportPdf = async (execution: IntelligenceAssistantExecution) => {
    if (!token || pdfExporting) return;
    setPdfExporting(true); setPageError("");
    try { const { blob, filename } = await downloadCustomIntelligenceReportPdf(token, execution.id); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename || `情报报告_${execution.id}.pdf`; document.body.appendChild(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 5000); setNotice("PDF 已开始下载。"); }
    catch (error) { handleError(error, "下载 PDF 失败"); }
    finally { setPdfExporting(false); }
  };
  const applySavedConfigValue = (value: string) => { if (value === "none") { setSelectedConfigId(null); return; } const topic = topics.find((item) => String(item.id) === value); if (!topic) return; setForm(formFromTopic(topic)); setSelectedConfigId(topic.id); setNotice(`已载入「${topic.name}」`); };
  const loadConfigIntoForm = (topic: IntelligenceAssistantTopic) => { setForm(formFromTopic(topic)); setSelectedConfigId(topic.id); setActiveTab("generate"); setNotice(`已载入「${topic.name}」`); };
  const loadAndSearchConfig = async (topic: IntelligenceAssistantTopic) => { if (!token || activeExecutionId !== null) return; try { const response = await executeAssistantTopic(token, topic.id); setForm(formFromTopic(topic)); setSelectedConfigId(topic.id); setActiveTab("generate"); startExecution(response.execution); } catch (error) { handleError(error, "无法生成助手报告"); } };
  const openCreateConfig = () => { if (configsLimitReached) { setPageError(`最多保存 ${TOPIC_LIMIT} 个助手，请先编辑或删除已有助手。`); return; } setConfigEditorId(null); setConfigName(form.focus.trim().slice(0, 40) || "我的情报助手"); setConfigDraft({ ...form }); setConfigDialogOpen(true); };
  const openSaveCurrentConfig = () => { if (configsLimitReached && selectedConfigId === null) { setPageError(`最多保存 ${TOPIC_LIMIT} 个助手，请先编辑或删除已有助手。`); return; } setConfigEditorId(selectedConfigId); setConfigName(topics.find((topic) => topic.id === selectedConfigId)?.name || form.focus.trim().slice(0, 40) || "我的情报助手"); setConfigDraft({ ...form }); setConfigDialogOpen(true); };
  const openEditConfig = (topic: IntelligenceAssistantTopic) => { setConfigEditorId(topic.id); setConfigName(topic.name); setConfigDraft(formFromTopic(topic)); setConfigDialogOpen(true); };
  const saveConfig = async () => { if (!token || !configName.trim() || !configDraft.focus.trim()) { setPageError("请填写助手名称和业务问题。"); return; } if (configDraft.audience === "custom" && !configDraft.audience_detail.trim()) { setPageError("选择自定义受众后，请补充读者背景。"); return; } setConfigSaving(true); try { const payload = { ...configDraft, name: configName.trim(), focus_tags: configDraft.focus_tags.slice(0, 3) }; const response = configEditorId === null ? await createAssistantTopic(token, payload) : await updateAssistantTopic(token, configEditorId, payload); setTopics((current) => configEditorId === null ? [response.topic, ...current] : current.map((topic) => topic.id === response.topic.id ? response.topic : topic)); setSelectedConfigId(response.topic.id); setConfigDialogOpen(false); setNotice(configEditorId === null ? "已保存为我的助手。" : "助手已更新。"); } catch (error) { handleError(error, "无法保存助手"); } finally { setConfigSaving(false); } };
  const deleteConfig = async (topic: IntelligenceAssistantTopic) => { if (!token || !window.confirm(`确定删除「${topic.name}」吗？删除后不可恢复。`)) return; try { await deleteAssistantTopic(token, topic.id); setTopics((current) => current.filter((item) => item.id !== topic.id)); if (selectedConfigId === topic.id) setSelectedConfigId(null); setNotice(`已删除「${topic.name}」。`); } catch (error) { handleError(error, "无法删除助手"); } };
  const openReport = async (execution: IntelligenceAssistantExecution) => { setSelectedExecution(execution); setReportDialogOpen(true); if (!token) return; setReportLoading(true); try { const response = await fetchAssistantExecution(token, execution.id); setSelectedExecution(response.execution); setExecutions((current) => mergeExecution(current, response.execution)); } catch (error) { handleError(error, "无法加载报告"); } finally { setReportLoading(false); } };
  const rerun = async (execution: IntelligenceAssistantExecution) => { if (!token || activeExecutionId !== null) return; try { const response = await rerunAssistantExecution(token, execution.id); setForm(formFromExecution(execution)); setActiveTab("generate"); startExecution(response.execution); setReportDialogOpen(false); } catch (error) { handleError(error, "无法再次生成报告"); } };
  const reanalyze = async (execution: IntelligenceAssistantExecution) => { if (!token || activeExecutionId !== null) return; try { const response = await reanalyzeAssistantExecution(token, execution.id); startExecution(response.execution); setReportDialogOpen(false); } catch (error) { handleError(error, "无法重新分析报告"); } };
  const openEmail = (execution: IntelligenceAssistantExecution | null) => { setEmailExecution(execution); setEmailDialogOpen(execution !== null); };
  const sendEmail = async (recipients: string[], format: "html" | "pdf", externalConfirmed: boolean) => { if (!token || !emailExecution) return; setEmailSending(true); try { const payload: IntelligenceAssistantEmailInput = { recipients, format, external_confirmed: externalConfirmed }; const response = await sendAssistantExecutionEmail(token, emailExecution.id, payload); if (response.status === "partial_failed") throw new Error("部分收件人发送失败，请联系管理员查看投递记录。"); setEmailDialogOpen(false); setNotice("邮件发送成功。"); } catch (error) { handleError(error, "发送邮件失败"); } finally { setEmailSending(false); } };

  return { isHydrated, isLoggedIn, isAdmin, username, logout, activeTab, setActiveTab, form, setForm, optionsLoading, serviceAvailable, topics, executions, executionsTotal, executionsPage, executionsTotalPages, loadingExecutions, activeExecutionId, pageError, notice, workspaceMode, workspaceExecution, selectedConfigId, configDialogOpen, setConfigDialogOpen, configEditorId, configName, setConfigName, configDraft, setConfigDraft, configSaving, configsLimitReached, selectedExecution, reportDialogOpen, setReportDialogOpen, reportLoading, pdfExporting, emailDialogOpen, emailExecution, emailSending, clearMessages: () => { setPageError(""); setNotice(""); }, loadExecutions, submitInstant, resetWorkspace, exportReportPdf, applySavedConfigValue, loadConfigIntoForm, loadAndSearchConfig, openCreateConfig, openSaveCurrentConfig, openEditConfig, saveConfig, deleteConfig, openReport, rerun, reanalyze, openEmail, sendEmail };
}
