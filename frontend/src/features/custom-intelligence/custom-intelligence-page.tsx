"use client";

import { AlertCircle, Loader2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { LoginPageWithApply } from "@/components/login-page-with-apply";
import { SessionLoading } from "@/components/session-loading";
import { DashboardHeader } from "@/components/dashboard-header";
import { TOPIC_LIMIT } from "./custom-intelligence-constants";
import { CustomIntelligenceTabs } from "./custom-intelligence-tabs";
import { EmailDialog } from "./email-dialog";
import { ExecutionList } from "./execution-list";
import { InstantSearchPanel } from "./instant-search-panel";
import { ReportDialog } from "./report-dialog";
import { ReportPanel } from "./report-panel";
import { SavedConfigDialog } from "./saved-config-dialog";
import { SavedConfigList } from "./saved-config-list";
import { useCustomIntelligencePage } from "./use-custom-intelligence-page";

export default function CustomIntelligencePage() {
  const router = useRouter();
  const page = useCustomIntelligencePage();

  if (!page.isHydrated) return <SessionLoading />;
  if (!page.isLoggedIn) return <LoginPageWithApply />;

  const running = page.activeExecutionId !== null;
  const statusText = running ? "执行中" : page.optionsLoading ? "加载中" : page.serviceAvailable ? "服务正常" : "服务不可用";
  const statusTone = running || page.optionsLoading ? "loading" : page.serviceAvailable ? "ready" : "unavailable";

  return (
    <div className="min-h-screen min-w-0 overflow-x-hidden bg-[#F4F7FB]">
      <DashboardHeader
        username={page.username}
        isAdmin={page.isAdmin}
        activeModule="custom-intelligence"
        statusLabel="当前状态"
        statusText={statusText}
        statusTone={statusTone}
        statusDescription={running ? "报告正在生成" : page.serviceAvailable ? "情报服务可用" : "情报服务暂不可用"}
        exportOptions={[]}
        onOpenAdmin={() => router.push("/admin")}
        onLogout={page.logout}
      />

      <main className="mx-auto max-w-[1600px] min-w-0 space-y-4 px-3 py-4 sm:px-8 sm:py-5">
        {(page.pageError || page.notice) && (
          <div
            role={page.pageError ? "alert" : "status"}
            aria-live={page.pageError ? "assertive" : "polite"}
            className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm ${page.pageError ? "border-red-100 bg-red-50 text-red-700" : "border-blue-100 bg-blue-50 text-blue-700"}`}
          >
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0 whitespace-pre-wrap break-words">{page.pageError || page.notice}</span>
            <button type="button" className="ml-auto shrink-0 opacity-60 hover:opacity-100" onClick={page.clearMessages} aria-label="关闭提示">
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
        )}

        {!page.optionsLoading && !page.serviceAvailable && (
          <div role="status" className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
            当前情报服务暂不可用，请联系管理员。
          </div>
        )}

        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-[#172033] sm:text-[26px]">情报助手</h2>
            <p className="mt-1 text-xs text-[#667085]">输入关注内容，系统将检索公开资料并生成报告。</p>
          </div>
          {running && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              <span className="inline-flex items-center gap-1.5" role="status" aria-live="polite">
                <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />报告生成中
              </span>
            </div>
          )}
        </div>

        <CustomIntelligenceTabs activeTab={page.activeTab} executionCount={page.executionsTotal} onChange={page.setActiveTab} />

        {page.activeTab === "generate" && (
          <section id="custom-intelligence-panel-generate" role="tabpanel" aria-label="生成报告" aria-busy={page.optionsLoading} className="surface-panel px-3 py-4 sm:px-4">
            <InstantSearchPanel
              topics={page.topics}
              selectedConfigId={page.selectedConfigId}
              form={page.form}
              activeExecutionId={page.activeExecutionId}
              workspaceMode={page.workspaceMode}
              optionsLoading={page.optionsLoading}
              serviceAvailable={page.serviceAvailable}
              onFormChange={page.setForm}
              onApplyConfig={page.applySavedConfigValue}
              onStartSearch={() => void page.submitInstant()}
              onSaveCurrentConfig={page.openSaveCurrentConfig}
              onResetWorkspace={page.resetWorkspace}
            >
              {page.workspaceMode && page.workspaceExecution && (
                <ReportPanel
                  execution={page.workspaceExecution}
                  pdfExporting={page.pdfExporting}
                  onExportPdf={(execution) => void page.exportReportPdf(execution)}
                  onEmail={page.openEmail}
                  onRerun={(execution) => void page.rerun(execution)}
                  onReanalyze={(execution) => void page.reanalyze(execution)}
                  onNewSearch={page.resetWorkspace}
                  onOpenReport={(execution) => void page.openReport(execution)}
                />
              )}
            </InstantSearchPanel>
          </section>
        )}

        {page.activeTab === "assistants" && (
          <section id="custom-intelligence-panel-assistants" role="tabpanel" aria-label="我的助手" className="surface-panel px-3 py-4 sm:px-4">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-[#172033]">我的助手</h3>
                <p className="mt-1 text-xs text-[#667085]">保存常用报告需求，最多 {TOPIC_LIMIT} 个。</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] tabular-nums text-[#98A2B3]">{page.topics.length}/{TOPIC_LIMIT}</span>
                <button type="button" onClick={page.openCreateConfig} disabled={page.configsLimitReached} className="rounded-md bg-[#2563EB] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1D4ED8] disabled:cursor-not-allowed disabled:opacity-50">
                  ＋新建助手
                </button>
              </div>
            </div>
            <SavedConfigList
              topics={page.topics}
              loading={page.optionsLoading}
              activeExecutionId={page.activeExecutionId}
              onCreate={page.openCreateConfig}
              onEdit={page.openEditConfig}
              onDelete={(topic) => void page.deleteConfig(topic)}
              onRun={(topic) => void page.loadAndSearchConfig(topic)}
            />
          </section>
        )}

        {page.activeTab === "history" && (
          <section id="custom-intelligence-panel-history" role="tabpanel" aria-label="历史报告" className="surface-panel px-3 py-4 sm:px-4">
            <ExecutionList
              executions={page.executions}
              loading={page.loadingExecutions}
              total={page.executionsTotal}
              page={page.executionsPage}
              totalPages={page.executionsTotalPages}
              activeExecutionId={page.activeExecutionId}
              onPageChange={(nextPage) => void page.loadExecutions(nextPage)}
              onRefresh={() => void page.loadExecutions(page.executionsPage)}
              onStartSearch={() => page.setActiveTab("generate")}
              onOpenReport={(execution) => void page.openReport(execution)}
              onRerun={(execution) => void page.rerun(execution)}
              onReanalyze={(execution) => void page.reanalyze(execution)}
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
        onOpenChange={page.setConfigDialogOpen}
        onNameChange={page.setConfigName}
        onDraftChange={page.setConfigDraft}
        onSave={() => void page.saveConfig()}
      />

      <ReportDialog
        execution={page.selectedExecution}
        open={page.reportDialogOpen}
        loading={page.reportLoading}
        pdfExporting={page.pdfExporting}
        onOpenChange={page.setReportDialogOpen}
        onExportPdf={(execution) => void page.exportReportPdf(execution)}
        onEmail={page.openEmail}
        onRerun={(execution) => void page.rerun(execution)}
        onReanalyze={(execution) => void page.reanalyze(execution)}
      />

      <EmailDialog
        execution={page.emailExecution}
        open={page.emailDialogOpen}
        sending={page.emailSending}
        onOpenChange={(open) => {
          if (!open) page.openEmail(null);
        }}
        onSend={page.sendEmail}
      />
    </div>
  );
}
