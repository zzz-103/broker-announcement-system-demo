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
  lastExecutedAt: string | null;
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
    summary: "可选择仅采集公告，或运行完整流程。",
    logs: [],
    lastOperationLabel: "公告采集",
    lastExecutedAt: null,
  },
  llm: {
    status: "idle",
    summary: "完成公告数据处理、匹配与汇总，再由管理员更新看板。",
    logs: [],
    lastOperationLabel: "数据处理",
    lastExecutedAt: null,
  },
  ai: {
    status: "idle",
    summary: "基于当前数据生成招采分析。",
    logs: [],
    lastOperationLabel: "招采分析",
    lastExecutedAt: null,
  },
  "app-watch": {
    status: "idle",
    summary: "采集并整理券商 App 更新，写入 App 更新看板。",
    logs: [],
    lastOperationLabel: "App 更新采集",
    lastExecutedAt: null,
  },
};

export const IDLE_PROGRESS: AdminTaskProgressState = {
  status: "idle",
  taskName: "任务进度",
  message: "当前无运行任务",
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
  if (operationId === "scraper") return "公告采集";
  if (operationId === "llm") return "数据处理";
  if (operationId === "llm-external") return "外来公告处理";
  if (operationId === "pipeline") return "完整流程";
  if (operationId === "app-watch") return "App 更新采集";
  if (operationId === "publish") return "更新看板";
  return "招采分析";
}

export function isActiveJobStatus(status: string) {
  return status === "pending" || status === "running";
}

export function isTerminalJobStatus(status: string) {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

export function jobSuccessSummary(jobType: JobType, label: string): string {
  if (jobType === "llm-external") {
    return "数据处理完成，候选数据已生成，请更新看板。";
  }
  if (jobType === "llm") {
    return "数据处理、规则匹配与汇总已完成；请审核结果后更新看板。";
  }
  if (jobType === "pipeline") {
    return "公告采集、数据处理、匹配与汇总已完成，正式数据已自动安全发布。";
  }
  if (jobType === "scraper") {
    return "采购公告与结果公告采集完成；尚未运行数据处理与匹配。";
  }
  if (jobType === "app-watch") {
    return "券商 App 更新采集与整理已完成，可前往 App 更新看板查看最新数据。";
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
