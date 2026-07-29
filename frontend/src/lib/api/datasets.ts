import { requestJson } from "./core";
import type {
  AiAnalysisResponse,
  AnnouncementsResponse,
  AppReleasesResponse,
  PublishAnnouncementsResponse,
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
