import { requestJson } from "./core";
import type {
  AppUpdateData,
  AiAnalysisResponse,
  AnnouncementsResponse,
  AppReleasesResponse,
  DashboardAiAnalysis,
  DashboardExportResponse,
  DashboardFilters,
  DashboardManifest,
  DashboardOverview,
  PublishAnnouncementsResponse,
  TenderProjectData,
} from "./contracts";

export function fetchAnnouncements(token: string): Promise<AnnouncementsResponse> {
  return requestJson<AnnouncementsResponse>(
    "/api/data/announcements?view=dashboard",
    { cache: "no-cache" },
    token,
  );
}

export function fetchAppReleases(token: string): Promise<AppReleasesResponse> {
  return requestJson<AppReleasesResponse>("/api/app-releases", { cache: "no-cache" }, token);
}

export function getAiAnalysis(token: string): Promise<AiAnalysisResponse> {
  return requestJson<AiAnalysisResponse>("/api/ai-analysis", {}, token);
}

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

export function fetchDashboardManifest(token: string): Promise<DashboardManifest> {
  return requestJson<DashboardManifest>("/api/dashboard-data/manifest", { cache: "no-cache" }, token);
}

export function fetchDashboardOverview(token: string): Promise<DashboardOverview> {
  return requestJson<DashboardOverview>("/api/dashboard-data/files/overview", { cache: "no-cache" }, token);
}

export function fetchDashboardFilters(token: string): Promise<DashboardFilters> {
  return requestJson<DashboardFilters>("/api/dashboard-data/files/filters", { cache: "no-cache" }, token);
}

export function fetchDashboardTenderProjects(token: string): Promise<TenderProjectData[]> {
  return requestJson<TenderProjectData[]>("/api/dashboard-data/files/tender_projects", { cache: "no-cache" }, token);
}

export function fetchDashboardAppUpdates(token: string): Promise<AppUpdateData[]> {
  return requestJson<AppUpdateData[]>("/api/dashboard-data/files/app_updates", { cache: "no-cache" }, token);
}

export function fetchDashboardAiAnalysis(token: string): Promise<DashboardAiAnalysis> {
  return requestJson<DashboardAiAnalysis>("/api/dashboard-data/files/ai_analysis", { cache: "no-cache" }, token);
}

export function exportDashboardData(token: string, signal?: AbortSignal): Promise<DashboardExportResponse> {
  return requestJson<DashboardExportResponse>("/api/dashboard-data/export", { method: "POST", signal }, token);
}
