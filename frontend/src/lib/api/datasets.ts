import { requestJson } from "./core";
import type {
  AppUpdateData,
  AiAnalysisResponse,
  DashboardAiAnalysis,
  DashboardExportResponse,
  DashboardFilters,
  DashboardManifest,
  DashboardOverview,
  PublishAnnouncementsResponse,
  TenderProjectData,
} from "./contracts";

export function generateAiAnalysis(token: string, signal?: AbortSignal): Promise<AiAnalysisResponse> {
  return requestJson<AiAnalysisResponse>("/api/ai-analysis", { method: "POST", signal }, token);
}

export function publishAnnouncements(
  token: string,
  signal?: AbortSignal,
): Promise<PublishAnnouncementsResponse> {
  return requestJson<PublishAnnouncementsResponse>(
    "/api/data/announcements/publish",
    { method: "POST", signal },
    token,
  );
}

export function fetchDashboardManifest(token: string, signal?: AbortSignal): Promise<DashboardManifest> {
  return requestJson<DashboardManifest>("/api/dashboard-data/manifest", { cache: "reload", signal }, token);
}

export function fetchDashboardOverview(token: string, signal?: AbortSignal): Promise<DashboardOverview> {
  return requestJson<DashboardOverview>("/api/dashboard-data/files/overview", { cache: "reload", signal }, token);
}

export function fetchDashboardFilters(token: string, signal?: AbortSignal): Promise<DashboardFilters> {
  return requestJson<DashboardFilters>("/api/dashboard-data/files/filters", { cache: "reload", signal }, token);
}

export function fetchDashboardTenderProjects(token: string, signal?: AbortSignal): Promise<TenderProjectData[]> {
  return requestJson<TenderProjectData[]>("/api/dashboard-data/files/tender_projects", { cache: "reload", signal }, token);
}

export function fetchDashboardAppUpdates(token: string, signal?: AbortSignal): Promise<AppUpdateData[]> {
  return requestJson<AppUpdateData[]>("/api/dashboard-data/files/app_updates", { cache: "reload", signal }, token);
}

export function fetchDashboardAiAnalysis(token: string): Promise<DashboardAiAnalysis> {
  return requestJson<DashboardAiAnalysis>("/api/dashboard-data/files/ai_analysis", { cache: "reload" }, token);
}

export function exportDashboardData(token: string, signal?: AbortSignal): Promise<DashboardExportResponse> {
  return requestJson<DashboardExportResponse>("/api/dashboard-data/export", { method: "POST", signal }, token);
}
