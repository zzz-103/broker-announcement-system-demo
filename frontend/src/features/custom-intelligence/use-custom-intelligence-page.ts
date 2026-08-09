"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuthStore } from "@/store/auth-store";
import { BackendApiError, isAbortError } from "@/lib/api/backend-client";
import { exportCustomIntelligenceCsv, exportCustomIntelligenceJson } from "@/lib/custom-intelligence-export";
import {
  createCustomIntelligenceExecution,
  createCustomIntelligenceTopic,
  deleteCustomIntelligenceTopic,
  downloadCustomIntelligenceReportPdf,
  executeCustomIntelligenceTopic,
  fetchCustomIntelligenceExecution,
  fetchCustomIntelligenceExecutions,
  fetchCustomIntelligenceOptions,
  fetchCustomIntelligenceTopic,
  fetchCustomIntelligenceTopics,
  reanalyzeCustomIntelligenceExecution,
  rerunCustomIntelligenceExecution,
  setCustomIntelligenceTopicEnabled,
  suggestCustomIntelligenceKeywords,
  updateCustomIntelligenceTopic,
} from "@/lib/api/custom-intelligence";
import type {
  CustomIntelligenceExecution,
  CustomIntelligenceOptionsResponse,
  IntelligenceTopic,
  InstantSearchRequest,
} from "@/lib/api/contracts";
import {
  DEFAULT_FORM,
  EXECUTIONS_PAGE_SIZE,
  EXPORT_PAGE_SIZE,
  FALLBACK_OPTIONS,
  TOPIC_LIMIT,
} from "./custom-intelligence-constants";
import {
  errorMessage,
  formFromExecution,
  formFromTopic,
  isActiveExecution,
  mergeExecution,
} from "./custom-intelligence-utils";
import type { CustomIntelligenceTab } from "./custom-intelligence-types";

export interface CustomIntelligencePageController {
  isHydrated: boolean;
  isLoggedIn: boolean;
  username: string;
  isAdmin: boolean;
  logout: () => void;
  activeTab: CustomIntelligenceTab;
  setActiveTab: (tab: CustomIntelligenceTab) => void;
  form: InstantSearchRequest;
  setForm: (value: InstantSearchRequest) => void;
  options: CustomIntelligenceOptionsResponse;
  visibleOptions: CustomIntelligenceOptionsResponse;
  optionsLoading: boolean;
  serviceAvailable: boolean;
  analysisAvailable: boolean;
  topics: IntelligenceTopic[];
  executions: CustomIntelligenceExecution[];
  executionsTotal: number;
  executionsPage: number;
  executionsTotalPages: number;
  loadingExecutions: boolean;
  activeExecutionId: number | null;
  pageError: string;
  notice: string;
  suggesting: boolean;
  keywordSuggestions: string[];
  selectedSuggestions: string[];
  setSelectedSuggestions: (value: string[]) => void;
  configDialogOpen: boolean;
  setConfigDialogOpen: (open: boolean) => void;
  configEditorId: number | null;
  configName: string;
  setConfigName: (value: string) => void;
  configDraft: InstantSearchRequest;
  setConfigDraft: (value: InstantSearchRequest) => void;
  configSaving: boolean;
  configSuggesting: boolean;
  configKeywordSuggestions: string[];
  selectedConfigSuggestions: string[];
  setSelectedConfigSuggestions: (value: string[]) => void;
  configUpdatingId: number | null;
  selectedExecution: CustomIntelligenceExecution | null;
  workspaceMode: boolean;
  workspaceExecution: CustomIntelligenceExecution | null;
  selectedConfigId: number | null;
  selectedConfig?: IntelligenceTopic;
  reportDialogOpen: boolean;
  setReportDialogOpen: (open: boolean) => void;
  reportLoading: boolean;
  pdfExporting: boolean;
  recentExecutionsByTopic: Map<number, CustomIntelligenceExecution>;
  configsLimitReached: boolean;
  clearMessages: () => void;
  loadExecutions: (page?: number, signal?: AbortSignal) => Promise<void>;
  submitInstant: () => Promise<void>;
  requestKeywordSuggestions: () => Promise<void>;
  mergeKeywordSuggestions: () => void;
  resetWorkspace: () => void;
  exportReportPdf: (execution: CustomIntelligenceExecution) => Promise<void>;
  exportAllExecutions: (kind: "csv" | "json") => Promise<void>;
  applySavedConfigValue: (value: string) => void;
  loadConfigIntoForm: (topic: IntelligenceTopic) => void;
  loadAndSearchConfig: (topic: IntelligenceTopic) => Promise<void>;
  openCreateConfig: () => void;
  openSaveCurrentConfig: () => void;
  openSaveConfigFromExecution: (execution: CustomIntelligenceExecution) => void;
  openEditConfig: (topic: IntelligenceTopic) => Promise<void>;
  requestConfigKeywordSuggestions: () => Promise<void>;
  mergeConfigKeywordSuggestions: () => void;
  saveConfig: () => Promise<void>;
  toggleConfig: (topic: IntelligenceTopic) => Promise<void>;
  deleteConfig: (topic: IntelligenceTopic) => Promise<void>;
  openReport: (execution: CustomIntelligenceExecution) => Promise<void>;
  rerun: (
    execution: CustomIntelligenceExecution,
    openReportAfterStart?: boolean,
    keepWorkspace?: boolean,
  ) => Promise<void>;
  reanalyze: (
    execution: CustomIntelligenceExecution,
    openReportAfterStart?: boolean,
    keepWorkspace?: boolean,
  ) => Promise<void>;
}

type KeywordSuggestionSource = Pick<
  InstantSearchRequest,
  "question" | "description" | "keywords" | "focus_objects" | "analysis_perspective"
>;

export function useCustomIntelligencePage(): CustomIntelligencePageController {
  const { isHydrated, isLoggedIn, token, username, isAdmin, logout, clearAuth, restoreSession } = useAuthStore();
  const [activeTab, setActiveTab] = useState<CustomIntelligenceTab>("instant");
  const [form, setForm] = useState<InstantSearchRequest>(DEFAULT_FORM);
  const [options, setOptions] = useState<CustomIntelligenceOptionsResponse>(FALLBACK_OPTIONS);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [topics, setTopics] = useState<IntelligenceTopic[]>([]);
  const [executions, setExecutions] = useState<CustomIntelligenceExecution[]>([]);
  const [executionsTotal, setExecutionsTotal] = useState(0);
  const [executionsPage, setExecutionsPage] = useState(1);
  const [executionsTotalPages, setExecutionsTotalPages] = useState(1);
  const [loadingExecutions, setLoadingExecutions] = useState(false);
  const [activeExecutionId, setActiveExecutionId] = useState<number | null>(null);
  const [pageError, setPageError] = useState("");
  const [notice, setNotice] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  const [keywordSuggestions, setKeywordSuggestions] = useState<string[]>([]);
  const [selectedSuggestions, setSelectedSuggestions] = useState<string[]>([]);
  const [configDialogOpen, setConfigDialogOpen] = useState(false);
  const [configEditorId, setConfigEditorId] = useState<number | null>(null);
  const [configName, setConfigName] = useState("");
  const [configDraft, setConfigDraft] = useState<InstantSearchRequest>(DEFAULT_FORM);
  const [configSaving, setConfigSaving] = useState(false);
  const [configSuggesting, setConfigSuggesting] = useState(false);
  const [configKeywordSuggestions, setConfigKeywordSuggestions] = useState<string[]>([]);
  const [selectedConfigSuggestions, setSelectedConfigSuggestions] = useState<string[]>([]);
  const [configUpdatingId, setConfigUpdatingId] = useState<number | null>(null);
  const [selectedExecution, setSelectedExecution] = useState<CustomIntelligenceExecution | null>(null);
  const [workspaceMode, setWorkspaceMode] = useState(false);
  const [workspaceExecution, setWorkspaceExecution] = useState<CustomIntelligenceExecution | null>(null);
  const [selectedConfigId, setSelectedConfigId] = useState<number | null>(null);
  const [reportDialogOpen, setReportDialogOpen] = useState(false);
  const [reportLoading, setReportLoading] = useState(false);
  const [pdfExporting, setPdfExporting] = useState(false);
  const reportRequestSequence = useRef(0);
  const serviceAvailable = !optionsLoading && options.service_status === "enabled";
  const analysisAvailable = !optionsLoading && options.analysis_configured;
  const configsLimitReached = topics.length >= TOPIC_LIMIT;
  const selectedConfig = selectedConfigId === null ? undefined : topics.find((topic) => topic.id === selectedConfigId);
  const visibleOptions = optionsLoading ? FALLBACK_OPTIONS : options;

  useEffect(() => {
    restoreSession();
  }, [restoreSession]);

  const handleError = useCallback((error: unknown, fallback?: string): boolean => {
    if (error instanceof BackendApiError && error.status === 401) {
      clearAuth("登录已失效，请重新登录");
      return true;
    }
    setPageError(errorMessage(error, fallback));
    return false;
  }, [clearAuth]);

  const loadExecutions = useCallback(async (page = 1, signal?: AbortSignal) => {
    if (!token) return;
    setLoadingExecutions(true);
    try {
      const response = await fetchCustomIntelligenceExecutions(token, page, EXECUTIONS_PAGE_SIZE, signal);
      setExecutions(response.executions);
      setExecutionsTotal(response.meta.total);
      setExecutionsPage(response.meta.page);
      setExecutionsTotalPages(response.meta.total_pages);
      const active = response.executions.find((execution) => isActiveExecution(execution.status));
      if (active) setActiveExecutionId(active.id);
    } catch (error) {
      if (!isAbortError(error)) handleError(error, "无法加载执行记录");
    } finally {
      if (!signal?.aborted) setLoadingExecutions(false);
    }
  }, [handleError, token]);

  const recentExecutionsByTopic = useMemo(() => {
    const latest = new Map<number, CustomIntelligenceExecution>();
    for (const topic of topics) {
      if (topic.latest_execution) latest.set(topic.id, topic.latest_execution);
    }
    for (const execution of executions) {
      if (execution.topic_id === null) continue;
      const current = latest.get(execution.topic_id);
      if (!current || new Date(execution.created_at).getTime() > new Date(current.created_at).getTime()) {
        latest.set(execution.topic_id, execution);
      }
    }
    return latest;
  }, [executions, topics]);

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    setOptionsLoading(true);
    Promise.all([
      fetchCustomIntelligenceOptions(token, controller.signal),
      fetchCustomIntelligenceTopics(token, controller.signal),
      fetchCustomIntelligenceExecutions(token, 1, EXECUTIONS_PAGE_SIZE, controller.signal),
    ]).then(([loadedOptions, loadedTopics, loadedExecutions]) => {
      setOptions(loadedOptions);
      setTopics(loadedTopics.topics);
      setExecutions(loadedExecutions.executions);
      setExecutionsTotal(loadedExecutions.meta.total);
      setExecutionsPage(loadedExecutions.meta.page);
      setExecutionsTotalPages(loadedExecutions.meta.total_pages);
      const active = loadedExecutions.executions.find((execution) => isActiveExecution(execution.status));
      if (active) {
        setActiveExecutionId(active.id);
        setWorkspaceExecution(active);
        setWorkspaceMode(true);
      }
    }).catch((error: unknown) => {
      if (!controller.signal.aborted && !isAbortError(error)) {
        handleError(error, "无法加载自定义情报配置");
      }
    }).finally(() => {
      if (!controller.signal.aborted) setOptionsLoading(false);
    });
    return () => controller.abort();
  }, [handleError, token]);

  useEffect(() => {
    if (!token || activeExecutionId === null) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let consecutiveFailures = 0;
    const poll = async () => {
      try {
        const response = await fetchCustomIntelligenceExecution(token, activeExecutionId);
        if (disposed) return;
        const execution = response.execution;
        consecutiveFailures = 0;
        setExecutions((current) => mergeExecution(current, execution));
        setSelectedExecution((current) => current?.id === execution.id ? execution : current);
        setWorkspaceExecution((current) => current?.id === execution.id ? execution : current);
        if (isActiveExecution(execution.status)) {
          timer = setTimeout(poll, 2000);
        } else {
          setActiveExecutionId(null);
          setNotice(execution.status === "succeeded" ? "情报报告已生成。" : execution.error_message || "本次情报执行已结束。");
          void loadExecutions(1);
        }
      } catch (error) {
        if (disposed) return;
        if (error instanceof BackendApiError && error.status === 401) {
          clearAuth("登录已失效，请重新登录");
          return;
        }
        consecutiveFailures += 1;
        if (consecutiveFailures >= 3) {
          setPageError("执行仍在后端继续，但状态连接暂时中断；系统会降低频率自动重试。");
        }
        const delay = Math.min(30000, 2000 * (2 ** Math.min(consecutiveFailures, 4)));
        timer = setTimeout(poll, delay);
      }
    };
    timer = setTimeout(poll, 2000);
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
    };
  }, [activeExecutionId, clearAuth, loadExecutions, token]);

  const startPolling = useCallback((execution: CustomIntelligenceExecution) => {
    setExecutions((current) => mergeExecution(current, execution));
    setActiveExecutionId(execution.id);
    setPageError("");
    setNotice("已提交执行，正在检索并整理来源（约每 2 秒更新一次）…");
  }, []);

  const runKeywordSuggestions = async (
    source: KeywordSuggestionSource,
    isBusy: boolean,
    setBusy: (busy: boolean) => void,
    applySuggestions: (suggestions: string[]) => void,
    emptyMessage: string,
    fallback: string,
    requireQuestionOrDescription: boolean,
  ) => {
    if (!token || isBusy) return;
    if (!analysisAvailable) {
      setPageError("LLM 分析服务未配置，请先联系管理员。");
      return;
    }
    if (requireQuestionOrDescription && !source.question.trim() && !source.description.trim()) {
      setPageError("请先填写业务问题或业务背景，再补充关键词。");
      return;
    }
    setBusy(true);
    setPageError("");
    try {
      const response = await suggestCustomIntelligenceKeywords(token, {
        question: source.question.trim(),
        description: source.description,
        keywords: source.keywords,
        focus_objects: source.focus_objects,
        analysis_perspective: source.analysis_perspective,
        max_suggestions: 8,
      });
      applySuggestions(response.suggestions);
      if (!response.suggestions.length) setNotice(emptyMessage);
    } catch (error) {
      handleError(error, fallback);
    } finally {
      setBusy(false);
    }
  };

  const mergeKeywordsInto = (
    updateDraft: (updater: (current: InstantSearchRequest) => InstantSearchRequest) => void,
    selected: string[],
    clearSuggestions: () => void,
    message: string,
  ) => {
    updateDraft((current) => ({
      ...current,
      keywords: [
        ...current.keywords,
        ...selected.filter((item) => !current.keywords.includes(item)),
      ],
    }));
    clearSuggestions();
    if (message) setNotice(message);
  };

  const submitInstant = async () => {
    if (!token || !serviceAvailable || activeExecutionId !== null || !form.question.trim()) {
      if (!form.question.trim()) setPageError("请先填写业务问题。");
      else if (!serviceAvailable) setPageError("当前情报搜索服务暂不可用，请联系管理员。");
      return;
    }
    setPageError("");
    setNotice("");
    try {
      const response = await createCustomIntelligenceExecution(token, { ...form, question: form.question.trim() });
      startPolling(response.execution);
      setSelectedExecution(response.execution);
      setWorkspaceExecution(response.execution);
      setWorkspaceMode(true);
      setNotice("搜索已提交，报告将在右侧区域生成。");
    } catch (error) {
      handleError(error, "无法启动即时情报搜索");
    }
  };

  const requestKeywordSuggestions = async () => {
    await runKeywordSuggestions(
      form,
      suggesting,
      setSuggesting,
      (suggestions) => {
        setKeywordSuggestions(suggestions);
        setSelectedSuggestions(suggestions);
      },
      "暂未生成新的关键词，可调整问题或关注对象后重试。",
      "补充关键词失败",
      true,
    );
  };

  const mergeKeywordSuggestions = () => {
    mergeKeywordsInto(
      setForm,
      selectedSuggestions,
      () => {
        setKeywordSuggestions([]);
        setSelectedSuggestions([]);
      },
      "已将确认的关键词合并到当前配置。",
    );
  };

  const resetWorkspace = () => {
    setWorkspaceMode(false);
    setWorkspaceExecution(null);
    setPageError("");
    setNotice("");
    document.getElementById("custom-intelligence-question")?.focus();
  };

  const exportReportPdf = async (execution: CustomIntelligenceExecution) => {
    if (!token || pdfExporting) return;
    setPdfExporting(true);
    setPageError("");
    try {
      const { blob, filename } = await downloadCustomIntelligenceReportPdf(token, execution.id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename || `情报报告_${execution.id}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      setNotice("报告 PDF 已开始下载。");
    } catch (error) {
      handleError(error, "导出 PDF 失败");
    } finally {
      setPdfExporting(false);
    }
  };

  const exportAllExecutions = async (kind: "csv" | "json") => {
    if (!token) return;
    try {
      const firstPage = await fetchCustomIntelligenceExecutions(token, 1, EXPORT_PAGE_SIZE);
      const executions = [...firstPage.executions];
      for (let page = 2; page <= firstPage.meta.total_pages && executions.length < firstPage.meta.total; page += 1) {
        const response = await fetchCustomIntelligenceExecutions(token, page, EXPORT_PAGE_SIZE);
        executions.push(...response.executions);
      }
      if (kind === "csv") exportCustomIntelligenceCsv(executions);
      else exportCustomIntelligenceJson(executions);
    } catch (error) {
      handleError(error, "导出执行记录失败");
    }
  };

  const applySavedConfigValue = (value: string) => {
    if (value === "none") {
      setSelectedConfigId(null);
      return;
    }
    const topic = topics.find((item) => String(item.id) === value);
    if (!topic) return;
    setForm(formFromTopic(topic));
    setSelectedConfigId(topic.id);
    setPageError("");
    setNotice(`已载入配置「${topic.name}」，可临时修改后开始搜索。`);
  };

  const loadConfigIntoForm = (topic: IntelligenceTopic) => {
    setForm(formFromTopic(topic));
    setSelectedConfigId(topic.id);
    setActiveTab("instant");
    setPageError("");
    setNotice(`已载入配置「${topic.name}」，可临时修改后开始搜索。`);
  };

  const loadAndSearchConfig = async (topic: IntelligenceTopic) => {
    if (!token || !serviceAvailable || activeExecutionId !== null) {
      if (!serviceAvailable) setPageError("当前情报搜索服务暂不可用，请联系管理员。");
      return;
    }
    setPageError("");
    setNotice("");
    try {
      const response = await executeCustomIntelligenceTopic(token, topic.id);
      setForm(formFromTopic(topic));
      setSelectedConfigId(topic.id);
      startPolling(response.execution);
      setSelectedExecution(response.execution);
      setWorkspaceExecution(response.execution);
      setWorkspaceMode(true);
      setActiveTab("instant");
    } catch (error) {
      handleError(error, "无法启动配置搜索");
    }
  };

  const openCreateConfig = () => {
    if (configsLimitReached) {
      setPageError(`已保存配置最多 ${TOPIC_LIMIT} 个，请先删除或修改已有配置。`);
      return;
    }
    setConfigEditorId(null);
    setConfigName("");
    setConfigDraft({
      ...form,
      question: form.question.trim(),
      description: form.description.trim() || form.question.trim(),
    });
    setConfigKeywordSuggestions([]);
    setSelectedConfigSuggestions([]);
    setConfigDialogOpen(true);
  };

  const openSaveCurrentConfig = () => {
    if (!selectedConfig && configsLimitReached) {
      setPageError(`已保存配置最多 ${TOPIC_LIMIT} 个，请先删除或修改已有配置。`);
      return;
    }
    setConfigEditorId(selectedConfig ? selectedConfig.id : null);
    setConfigName(selectedConfig ? selectedConfig.name : form.question.trim().slice(0, 40) || "我的搜索配置");
    setConfigDraft({ ...form });
    setConfigKeywordSuggestions([]);
    setSelectedConfigSuggestions([]);
    setConfigDialogOpen(true);
  };

  const openSaveConfigFromExecution = (execution: CustomIntelligenceExecution) => {
    if (configsLimitReached) {
      setPageError(`已保存配置最多 ${TOPIC_LIMIT} 个，请先删除或修改已有配置。`);
      return;
    }
    const snapshot = execution.snapshot;
    const question = String(snapshot.question || execution.original_query || "").trim();
    const suggestedName = String(execution.report?.title || question).trim().slice(0, 120);
    setConfigEditorId(null);
    setConfigName(suggestedName);
    setConfigDraft({
      question,
      description: String(snapshot.description || "").trim() || question,
      keywords: snapshot.keywords ?? [],
      focus_objects: snapshot.focus_objects ?? [],
      analysis_perspective: snapshot.analysis_perspective ?? DEFAULT_FORM.analysis_perspective,
      time_range: snapshot.time_range ?? DEFAULT_FORM.time_range,
      source_preference: snapshot.source_preference ?? DEFAULT_FORM.source_preference,
      specified_sites: snapshot.specified_sites ?? [],
      report_type: snapshot.report_type ?? DEFAULT_FORM.report_type,
      analysis_depth: snapshot.analysis_depth ?? DEFAULT_FORM.analysis_depth,
      extra_requirements: snapshot.extra_requirements ?? "",
    });
    setConfigKeywordSuggestions([]);
    setSelectedConfigSuggestions([]);
    setConfigDialogOpen(true);
  };

  const openEditConfig = async (topic: IntelligenceTopic) => {
    setConfigEditorId(topic.id);
    setConfigName(topic.name);
    setConfigDraft({ ...topic });
    setConfigKeywordSuggestions([]);
    setSelectedConfigSuggestions([]);
    setConfigDialogOpen(true);
    if (!token) return;
    try {
      const response = await fetchCustomIntelligenceTopic(token, topic.id);
      setConfigName(response.topic.name);
      setConfigDraft({ ...response.topic });
    } catch (error) {
      if (error instanceof BackendApiError && error.status === 401) clearAuth("登录已失效，请重新登录");
      else setPageError(errorMessage(error, "无法加载配置详情"));
    }
  };

  const requestConfigKeywordSuggestions = async () => {
    await runKeywordSuggestions(
      configDraft,
      configSuggesting,
      setConfigSuggesting,
      (suggestions) => {
        setConfigKeywordSuggestions(suggestions);
        setSelectedConfigSuggestions(suggestions);
      },
      "暂未生成新的配置关键词。",
      "配置关键词生成失败",
      false,
    );
  };

  const mergeConfigKeywordSuggestions = () => {
    mergeKeywordsInto(
      setConfigDraft,
      selectedConfigSuggestions,
      () => {
        setConfigKeywordSuggestions([]);
        setSelectedConfigSuggestions([]);
      },
      "",
    );
  };

  const saveConfig = async () => {
    if (!token || !configName.trim()) {
      setPageError("请填写配置名称。");
      return;
    }
    setConfigSaving(true);
    setPageError("");
    const configPayload = {
      name: configName.trim(),
      question: configDraft.question.trim(),
      description: configDraft.description,
      keywords: configDraft.keywords,
      focus_objects: configDraft.focus_objects,
      analysis_perspective: configDraft.analysis_perspective,
      time_range: configDraft.time_range,
      source_preference: configDraft.source_preference,
      specified_sites: configDraft.specified_sites,
      report_type: configDraft.report_type,
      analysis_depth: configDraft.analysis_depth,
      extra_requirements: configDraft.extra_requirements,
    };
    const isUpdate = configEditorId !== null;
    try {
      const response = isUpdate
        ? await updateCustomIntelligenceTopic(token, configEditorId, configPayload)
        : await createCustomIntelligenceTopic(token, configPayload);
      setTopics((current) => isUpdate
        ? current.map((topic) => topic.id === response.topic.id ? response.topic : topic)
        : [response.topic, ...current]);
      setSelectedConfigId(response.topic.id);
      setConfigDialogOpen(false);
      setNotice(isUpdate ? "已保存配置已更新。" : "搜索配置已保存，可在“已保存配置”中管理。");
    } catch (error) {
      handleError(error, isUpdate ? "无法更新已保存配置" : "无法保存搜索配置");
    } finally {
      setConfigSaving(false);
    }
  };

  const toggleConfig = async (topic: IntelligenceTopic) => {
    if (!token || configUpdatingId !== null) return;
    setConfigUpdatingId(topic.id);
    try {
      const response = await setCustomIntelligenceTopicEnabled(token, topic.id, !topic.enabled);
      setTopics((current) => current.map((item) => item.id === topic.id ? response.topic : item));
    } catch (error) {
      handleError(error, "无法更新配置状态");
    } finally {
      setConfigUpdatingId(null);
    }
  };

  const deleteConfig = async (topic: IntelligenceTopic) => {
    if (!token || configUpdatingId !== null) return;
    if (!window.confirm(`确定删除配置「${topic.name}」吗？删除后不可恢复。`)) return;
    setConfigUpdatingId(topic.id);
    try {
      await deleteCustomIntelligenceTopic(token, topic.id);
      setTopics((current) => current.filter((item) => item.id !== topic.id));
      if (selectedConfigId === topic.id) setSelectedConfigId(null);
      setNotice(`已删除配置「${topic.name}」。`);
    } catch (error) {
      handleError(error, "无法删除配置");
    } finally {
      setConfigUpdatingId(null);
    }
  };

  const openReport = async (execution: CustomIntelligenceExecution) => {
    const requestSequence = ++reportRequestSequence.current;
    setSelectedExecution(execution);
    setReportDialogOpen(true);
    if (!token) return;
    setReportLoading(true);
    try {
      const response = await fetchCustomIntelligenceExecution(token, execution.id);
      if (requestSequence !== reportRequestSequence.current) return;
      setSelectedExecution(response.execution);
      setExecutions((current) => mergeExecution(current, response.execution));
    } catch (error) {
      if (error instanceof BackendApiError && error.status === 401) clearAuth("登录已失效，请重新登录");
      else setPageError(errorMessage(error, "无法加载完整报告"));
    } finally {
      if (requestSequence === reportRequestSequence.current) setReportLoading(false);
    }
  };

  const rerun = async (
    execution: CustomIntelligenceExecution,
    openReportAfterStart = true,
    keepWorkspace = false,
  ) => {
    if (!token || !serviceAvailable || activeExecutionId !== null) {
      if (!serviceAvailable) setPageError("当前情报搜索服务暂不可用，请联系管理员。");
      return;
    }
    setPageError("");
    try {
      const response = await rerunCustomIntelligenceExecution(token, execution.id);
      setForm(formFromExecution(execution));
      setSelectedConfigId(execution.topic_id);
      setActiveTab("instant");
      startPolling(response.execution);
      setSelectedExecution(response.execution);
      if (keepWorkspace) {
        setWorkspaceExecution(response.execution);
        setWorkspaceMode(true);
      }
      if (openReportAfterStart) setReportDialogOpen(true);
    } catch (error) {
      handleError(error, "无法重新执行情报记录");
    }
  };

  const reanalyze = async (
    execution: CustomIntelligenceExecution,
    openReportAfterStart = true,
    keepWorkspace = false,
  ) => {
    if (!token || activeExecutionId !== null || !options.analysis_configured) {
      if (!options.analysis_configured) setPageError("LLM 分析服务未配置，请先联系管理员。");
      return;
    }
    setPageError("");
    try {
      const response = await reanalyzeCustomIntelligenceExecution(token, execution.id);
      startPolling(response.execution);
      setSelectedExecution(response.execution);
      if (keepWorkspace) {
        setWorkspaceExecution(response.execution);
        setWorkspaceMode(true);
      }
      if (openReportAfterStart) setReportDialogOpen(true);
    } catch (error) {
      handleError(error, "无法重新分析情报记录");
    }
  };

  return {
    isHydrated,
    isLoggedIn,
    username,
    isAdmin,
    logout,
    activeTab,
    setActiveTab,
    form,
    setForm,
    options,
    visibleOptions,
    optionsLoading,
    serviceAvailable,
    analysisAvailable,
    topics,
    executions,
    executionsTotal,
    executionsPage,
    executionsTotalPages,
    loadingExecutions,
    activeExecutionId,
    pageError,
    notice,
    suggesting,
    keywordSuggestions,
    selectedSuggestions,
    setSelectedSuggestions,
    configDialogOpen,
    setConfigDialogOpen,
    configEditorId,
    configName,
    setConfigName,
    configDraft,
    setConfigDraft,
    configSaving,
    configSuggesting,
    configKeywordSuggestions,
    selectedConfigSuggestions,
    setSelectedConfigSuggestions,
    configUpdatingId,
    selectedExecution,
    workspaceMode,
    workspaceExecution,
    selectedConfigId,
    selectedConfig,
    reportDialogOpen,
    setReportDialogOpen,
    reportLoading,
    pdfExporting,
    recentExecutionsByTopic,
    configsLimitReached,
    clearMessages: () => {
      setPageError("");
      setNotice("");
    },
    loadExecutions,
    submitInstant,
    requestKeywordSuggestions,
    mergeKeywordSuggestions,
    resetWorkspace,
    exportReportPdf,
    exportAllExecutions,
    applySavedConfigValue,
    loadConfigIntoForm,
    loadAndSearchConfig,
    openCreateConfig,
    openSaveCurrentConfig,
    openSaveConfigFromExecution,
    openEditConfig,
    requestConfigKeywordSuggestions,
    mergeConfigKeywordSuggestions,
    saveConfig,
    toggleConfig,
    deleteConfig,
    openReport,
    rerun,
    reanalyze,
  };
}
