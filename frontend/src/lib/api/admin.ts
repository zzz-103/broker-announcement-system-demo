import { requestJson } from "./core";
import type {
  AdminFeedbackResponse,
  AdminListQuery,
  AdminUsersResponse,
  AuditEventType,
  AuditEventsResponse,
  AuditSummaryResponse,
  CreateAdminUserInput,
  CreateAdminUserResponse,
  FeedbackResponse,
  FeedbackStatus,
} from "./contracts";

function listQuery(options: AdminListQuery): URLSearchParams {
  const query = new URLSearchParams({
    page: String(options.page),
    page_size: String(options.pageSize),
  });
  if (options.query.trim()) query.set("q", options.query.trim());
  return query;
}

export function getAdminUsers(token: string, options: AdminListQuery, signal?: AbortSignal): Promise<AdminUsersResponse> {
  return requestJson<AdminUsersResponse>(`/api/admin/users?${listQuery(options)}`, { signal }, token);
}

export function getAdminAuditSummary(token: string): Promise<AuditSummaryResponse> {
  return requestJson<AuditSummaryResponse>("/api/admin/audit/summary", {}, token);
}

export function getAdminAuditEvents(
  token: string,
  eventType: AuditEventType | "",
  options: AdminListQuery,
): Promise<AuditEventsResponse> {
  const query = listQuery(options);
  if (eventType) query.set("type", eventType);
  return requestJson<AuditEventsResponse>(`/api/admin/audit/events?${query}`, {}, token);
}

export function createAdminUser(
  token: string,
  input: CreateAdminUserInput,
): Promise<CreateAdminUserResponse> {
  return requestJson<CreateAdminUserResponse>(
    "/api/admin/users",
    { method: "POST", body: JSON.stringify(input) },
    token,
  );
}

export function deleteAdminUser(token: string, userId: number): Promise<{ deleted: boolean }> {
  return requestJson<{ deleted: boolean }>(
    `/api/admin/users/${encodeURIComponent(String(userId))}`,
    { method: "DELETE" },
    token,
  );
}

export function promoteAdminUser(token: string, userId: number): Promise<{ user: AdminUsersResponse["users"][number] }> {
  return requestJson<{ user: AdminUsersResponse["users"][number] }>(
    `/api/admin/users/${encodeURIComponent(String(userId))}/promote`,
    { method: "POST" },
    token,
  );
}

export function demoteAdminUser(token: string, userId: number): Promise<{ user: AdminUsersResponse["users"][number] }> {
  return requestJson<{ user: AdminUsersResponse["users"][number] }>(
    `/api/admin/users/${encodeURIComponent(String(userId))}/demote`,
    { method: "POST" },
    token,
  );
}

export function getAdminFeedback(token: string): Promise<AdminFeedbackResponse> {
  return requestJson<AdminFeedbackResponse>("/api/admin/feedback", {}, token);
}

export function updateAdminFeedbackStatus(
  token: string,
  feedbackId: number,
  feedbackStatus: FeedbackStatus,
): Promise<FeedbackResponse> {
  return requestJson<FeedbackResponse>(
    `/api/admin/feedback/${encodeURIComponent(String(feedbackId))}/status`,
    { method: "POST", body: JSON.stringify({ status: feedbackStatus }) },
    token,
  );
}
