import type {
  AdminTaskLogLine,
} from "@/components/admin-task-log-dialog";
import type {
  AdminTaskProgressState,
} from "@/components/admin-task-progress";
import { BackendApiError, type JobStatus, type JobType } from "@/lib/api/backend-client";


export type CardId = "crawler" | "llm" | "ai" | "app-watch";
export type OperationId =
  | "scraper"
  | "llm"
  | "pipeline"
  | "llm-external"
  | "publish"
  | "ai_analysis"
  | "app-watch";

export interface TaskCardState {
  status: JobStatus;
  summary: string;
  logs: AdminTaskLogLine[];
  lastOperationLabel: string;
}

export interface ActiveOperation {
  id: OperationId;
  cardId: CardId;
  label: string;
}

const MAX_LOG_LINES = 300;
const ACTIVE_JOB_STORAGE_KEY = "broker-admin-active-job";

export const PROGRESS_RESET_DELAY_MS = 4000;

export const INITIAL_CARD_STATE: Record<CardId, TaskCardState> = {
  crawler: {
    status: "idle",
    summary: "可选择仅抓取采购与结果公告，或运行完整 Pipeline。",
    logs: [],
    lastOperationLabel: "公告采集",
  },
  llm: {
    status: "idle",
    summary: "默认完成双公告 LLM、匹配与汇总，再由管理员手动推送到正式看板。",
    logs: [],
    lastOperationLabel: "LLM 数据处理",
  },
  ai: {
    status: "idle",
    summary: "基于当前正式看板数据生成 AI 情报分析。",
    logs: [],
    lastOperationLabel: "AI 情报分析",
  },
  "app-watch": {
    status: "idle",
    summary: "抓取各券商 App 更新并做 LLM 结构化，写入 App 更新看板。",
    logs: [],
    lastOperationLabel: "券商App更新",
  },
};

export const IDLE_PROGRESS: AdminTaskProgressState = {
  status: "idle",
  taskName: "统一任务进度",
  message: "当前没有运行中的任务",
};

export function backendErrorMessage(error: BackendApiError) {
  if (error.status === 0) {
    return "无法连接后端 API，请确认 FastAPI 或 Nginx 网关已启动。";
  }
  return error.message;
}

export function trimLogs(logs: AdminTaskLogLine[]) {
  return logs.slice(-MAX_LOG_LINES);
}

export function cardIdForJob(jobType: JobType): CardId {
  if (jobType === "scraper" || jobType === "pipeline") return "crawler";
  if (jobType === "app-watch") return "app-watch";
  return "llm";
}

export function labelForOperation(operationId: OperationId): string {
  if (operationId === "scraper") return "双公告爬取";
  if (operationId === "llm") return "LLM 数据处理";
  if (operationId === "llm-external") return "外来公告导入";
  if (operationId === "pipeline") return "自动化 Pipeline";
  if (operationId === "app-watch") return "券商App更新";
  if (operationId === "publish") return "推送";
  return "AI 情报分析";
}

export function isActiveJobStatus(status: string) {
  return status === "pending" || status === "running";
}

export function isTerminalJobStatus(status: string) {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

export function jobSuccessSummary(jobType: JobType, label: string): string {
  if (jobType === "llm-external") {
    return "LLM 处理完成，候选数据已生成，请点击‘推送’更新正式看板。";
  }
  if (jobType === "llm") {
    return "双公告 LLM 结构化、规则匹配、LLM 双复核与 merger 已完成；请审核最终合并表后推送正式看板。";
  }
  if (jobType === "pipeline") {
    return "双公告爬取、双 LLM 结构化、规则匹配、LLM 双复核与 merger 已完成；请审核最终合并表后推送正式看板。";
  }
  if (jobType === "scraper") {
    return "采购公告与结果公告爬取完成；尚未运行 LLM、匹配或汇总。";
  }
  if (jobType === "app-watch") {
    return "券商 App 更新采集与 LLM 结构化已完成，可在 App 更新看板查看最新数据。";
  }
  return `${label}已完成。`;
}

export function saveActiveJob(jobId: string, jobType: JobType) {
  sessionStorage.setItem(ACTIVE_JOB_STORAGE_KEY, JSON.stringify({ job_id: jobId, job_type: jobType }));
}

export function readActiveJob(): { job_id: string; job_type: JobType } | null {
  try {
    const raw = sessionStorage.getItem(ACTIVE_JOB_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { job_id?: unknown; job_type?: unknown };
    if (
      typeof parsed.job_id === "string" &&
      (parsed.job_type === "scraper" ||
        parsed.job_type === "llm" ||
        parsed.job_type === "pipeline" ||
        parsed.job_type === "llm-external" ||
        parsed.job_type === "app-watch")
    ) {
      return { job_id: parsed.job_id, job_type: parsed.job_type };
    }
  } catch {
    // Ignore malformed state from an older frontend build.
  }
  return null;
}

export function clearActiveJob(jobId?: string) {
  const stored = readActiveJob();
  if (!jobId || stored?.job_id === jobId) {
    sessionStorage.removeItem(ACTIVE_JOB_STORAGE_KEY);
  }
}
