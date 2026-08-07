"use client";

import { AlertCircle, Loader2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { LoginPageWithApply } from "@/components/login-page-with-apply";
import { DashboardHeader } from "@/components/dashboard-header";
import {
  CustomIntelligenceTabs,
  ExecutionList,
  SavedConfigList,
} from "./custom-intelligence-sections";
import { TOPIC_LIMIT } from "./custom-intelligence-constants";
import { InstantSearchPanel } from "./instant-search-panel";
import { ReportPanel } from "./report-panel";
import { SavedConfigDialog } from "./saved-config-dialog";
import { ReportDialog } from "./report-dialog";
import { useCustomIntelligencePage } from "./use-custom-intelligence-page";

export default function CustomIntelligencePage() {
  const router = useRouter();
  const page = useCustomIntelligencePage();

  if (!page.isLoggedIn) return <LoginPageWithApply />;

  return (
    <div className="min-h-screen min-w-0 overflow-x-hidden bg-[#F4F7FB]">
      <DashboardHeader
        username={page.username}
        isAdmin={page.isAdmin}
        activeModule="custom-intelligence"
        statusLabel="当前状态"
        statusText={
          page.activeExecutionId !== null
            ? "执行中"
            : page.optionsLoading
              ? "加载中"
              : page.serviceAvailable
                ? "服务正常"
                : "服务不可用"
        }
        statusTone={page.activeExecutionId !== null || page.optionsLoading ? "loading" : page.serviceAvailable ? "ready" : "unavailable"}
        statusDescription={
          page.activeExecutionId !== null
            ? "当前有一条自定义情报正在执行"
            : page.serviceAvailable
              ? "自定义情报搜索服务可用"
              : "当前情报搜索服务暂不可用"
        }
        exportOptions={[
          {
            id: "executions-csv",
            label: "执行记录（表格）",
            description: `最近 ${page.executionsTotal} 条记录`,
            disabled: page.executionsTotal === 0,
            onSelect: () => void page.exportAllExecutions("csv"),
          },
          {
            id: "executions-json",
            label: "执行记录（完整数据）",
            description: "保留结构化报告与来源",
            disabled: page.executionsTotal === 0,
            onSelect: () => void page.exportAllExecutions("json"),
          },
        ]}
        onOpenAdmin={() => router.push("/admin")}
        onLogout={page.logout}
      />

      <main className="mx-auto max-w-[1600px] min-w-0 space-y-4 px-3 py-4 sm:px-8 sm:py-5">
        {(page.pageError || page.notice) && (
          <div role={page.pageError ? "alert" : "status"} aria-live={page.pageError ? "assertive" : "polite"} className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm ${page.pageError ? "border-red-100 bg-red-50 text-red-700" : "border-blue-100 bg-blue-50 text-blue-700"}`}>
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0 whitespace-pre-wrap break-words">{page.pageError || page.notice}</span>
            <button type="button" className="ml-auto shrink-0 opacity-60 hover:opacity-100" onClick={page.clearMessages} aria-label="关闭提示">
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
        )}
        {!page.optionsLoading && !page.serviceAvailable && <div role="status" className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">当前情报搜索服务暂不可用，请联系管理员。</div>}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-[#172033] sm:text-[26px]">自定义情报</h2>
            <p className="mt-1 text-xs text-[#667085]">按业务问题检索公开信息，并保存常用搜索与分析配置。</p>
          </div>
          {page.activeExecutionId !== null && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              <span className="inline-flex items-center gap-1.5" role="status" aria-live="polite"><Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />有一条情报正在执行</span>
            </div>
          )}
        </div>

        <CustomIntelligenceTabs activeTab={page.activeTab} executionCount={page.executionsTotal} onChange={page.setActiveTab} />

        {page.activeTab === "instant" && (
          <section id="custom-intelligence-panel-instant" role="tabpanel" aria-label="即时搜索" aria-busy={page.optionsLoading} className="surface-panel px-3 py-4 sm:px-4">
            <InstantSearchPanel
              topics={page.topics}
              selectedConfigId={page.selectedConfigId}
              selectedConfig={page.selectedConfig}
              form={page.form}
              options={page.visibleOptions}
              optionsLoading={page.optionsLoading}
              serviceAvailable={page.serviceAvailable}
              analysisAvailable={page.analysisAvailable}
              activeExecutionId={page.activeExecutionId}
              workspaceMode={page.workspaceMode}
              suggesting={page.suggesting}
              keywordSuggestions={page.keywordSuggestions}
              selectedSuggestions={page.selectedSuggestions}
              onFormChange={page.setForm}
              onApplyConfig={page.applySavedConfigValue}
              onStartSearch={() => void page.submitInstant()}
              onSuggestKeywords={() => void page.requestKeywordSuggestions()}
              onSelectedSuggestionsChange={page.setSelectedSuggestions}
              onMergeKeywords={page.mergeKeywordSuggestions}
              onSaveCurrentConfig={page.openSaveCurrentConfig}
              onResetWorkspace={page.resetWorkspace}
            >
              {page.workspaceMode && (
                <ReportPanel
                  execution={page.workspaceExecution}
                  options={page.visibleOptions}
                  analysisAvailable={page.analysisAvailable}
                  serviceAvailable={page.serviceAvailable}
                  activeExecutionId={page.activeExecutionId}
                  pdfExporting={page.pdfExporting}
                  onExpand={(execution) => void page.openReport(execution)}
                  onExportPdf={(execution) => void page.exportReportPdf(execution)}
                  onRerun={(execution) => void page.rerun(execution, false, true)}
                  onReanalyze={(execution) => void page.reanalyze(execution, false, true)}
                  onSaveConfig={page.openSaveConfigFromExecution}
                  onNewSearch={page.resetWorkspace}
                />
              )}
            </InstantSearchPanel>
          </section>
        )}

        {page.activeTab === "topics" && (
          <section id="custom-intelligence-panel-topics" role="tabpanel" aria-label="已保存配置" className="surface-panel px-3 py-4 sm:px-4">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-[#172033]">已保存配置</h3>
                <p className="mt-1 text-xs text-[#667085]">保存常用的搜索与分析参数组合，最多 {TOPIC_LIMIT} 个。</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] tabular-nums text-[#98A2B3]">{page.topics.length}/{TOPIC_LIMIT}</span>
                <button type="button" onClick={page.openCreateConfig} disabled={page.configsLimitReached} title={page.configsLimitReached ? `已达上限（${TOPIC_LIMIT} 个），请先删除或修改已有配置` : undefined} className="inline-flex items-center gap-1.5 rounded-md bg-[#2563EB] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1D4ED8] disabled:cursor-not-allowed disabled:opacity-50">
                  <span aria-hidden="true">＋</span>新建配置
                </button>
              </div>
            </div>
            <SavedConfigList
              topics={page.topics}
              loading={page.optionsLoading}
              options={page.visibleOptions}
              serviceAvailable={page.serviceAvailable}
              activeExecutionId={page.activeExecutionId}
              topicUpdatingId={page.configUpdatingId}
              recentExecutionsByTopic={page.recentExecutionsByTopic}
              onCreate={page.openCreateConfig}
              onToggle={(topic) => void page.toggleConfig(topic)}
              onEdit={(topic) => void page.openEditConfig(topic)}
              onDelete={(topic) => void page.deleteConfig(topic)}
              onLoad={page.loadConfigIntoForm}
              onLoadAndSearch={(topic) => void page.loadAndSearchConfig(topic)}
              onOpenReport={(execution) => void page.openReport(execution)}
            />
          </section>
        )}

        {page.activeTab === "executions" && (
          <section id="custom-intelligence-panel-executions" role="tabpanel" aria-label="执行记录" className="surface-panel px-3 py-4 sm:px-4">
            <ExecutionList
              executions={page.executions}
              loading={page.loadingExecutions}
              serviceAvailable={page.serviceAvailable}
              analysisAvailable={page.analysisAvailable}
              page={page.executionsPage}
              totalPages={page.executionsTotalPages}
              total={page.executionsTotal}
              onPageChange={(nextPage) => void page.loadExecutions(nextPage)}
              onRefresh={() => void page.loadExecutions(page.executionsPage)}
              onStartSearch={() => page.setActiveTab("instant")}
              onSaveTopic={page.openSaveConfigFromExecution}
              onOpenReport={(execution) => void page.openReport(execution)}
              onRerun={(execution) => void page.rerun(execution)}
              onReanalyze={(execution) => void page.reanalyze(execution)}
              activeExecutionId={page.activeExecutionId}
            />
          </section>
        )}
      </main>

      <SavedConfigDialog
        open={page.configDialogOpen}
        saving={page.configSaving}
        editorId={page.configEditorId}
        name={page.configName}
        draft={page.configDraft}
        options={page.visibleOptions}
        analysisAvailable={page.analysisAvailable}
        suggesting={page.configSuggesting}
        keywordSuggestions={page.configKeywordSuggestions}
        selectedSuggestions={page.selectedConfigSuggestions}
        onOpenChange={page.setConfigDialogOpen}
        onNameChange={page.setConfigName}
        onDraftChange={page.setConfigDraft}
        onRequestSuggestions={() => void page.requestConfigKeywordSuggestions()}
        onSelectedSuggestionsChange={page.setSelectedConfigSuggestions}
        onMergeSuggestions={page.mergeConfigKeywordSuggestions}
        onSave={() => void page.saveConfig()}
      />

      <ReportDialog
        execution={page.selectedExecution}
        open={page.reportDialogOpen}
        loading={page.reportLoading}
        options={page.visibleOptions}
        pdfExporting={page.pdfExporting}
        onOpenChange={page.setReportDialogOpen}
        onExportPdf={(execution) => void page.exportReportPdf(execution)}
        onRerun={(execution) => {
          page.setReportDialogOpen(false);
          void page.rerun(execution);
        }}
        onSaveConfig={(execution) => {
          page.setReportDialogOpen(false);
          page.openSaveConfigFromExecution(execution);
        }}
        onReanalyze={(execution) => {
          page.setReportDialogOpen(false);
          void page.reanalyze(execution);
        }}
        analysisAvailable={page.analysisAvailable}
      />
    </div>
  );
}
