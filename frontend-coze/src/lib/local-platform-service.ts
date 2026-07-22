export type DemoUserStatus = "pending" | "active" | "disabled";
export type FeedbackStatus = "pending" | "processed";
export type FeedbackCategory = "broker_request" | "data_issue" | "product_suggestion";
export type AuditEventType = "qr_visit" | "qualification_application" | "login_success" | "dashboard_view";

export interface DemoUser {
  id: string;
  username: string;
  name: string;
  email: string;
  department: string;
  status: DemoUserStatus;
  isAdmin: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LoginLog {
  id: string;
  userId: string | null;
  username: string;
  success: boolean;
  createdAt: string;
}

export interface AuditEventRecord {
  id: string;
  event_type: AuditEventType;
  user_id: string | null;
  username: string | null;
  role: "admin" | "user" | null;
  source: string | null;
  created_at: string;
  metadata: Record<string, string>;
}

export interface AdminListMeta {
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
  q: string;
}

export interface FeedbackRecord {
  id: string;
  userId: string;
  category: FeedbackCategory;
  brokerName: string;
  message: string;
  relatedContext: string;
  status: FeedbackStatus;
  createdAt: string;
  processedAt: string | null;
}

interface ApiErrorPayload {
  detail?: string;
}

async function request<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as ApiErrorPayload | null;
    throw new Error(payload?.detail || "请求失败，请稍后重试");
  }
  return response.json() as Promise<T>;
}

export async function getCurrentUser(): Promise<DemoUser | null> {
  const response = await fetch("/api/auth/session", { credentials: "include", cache: "no-store" });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error("会话恢复失败");
  const payload = await response.json() as { user: DemoUser };
  return payload.user;
}

export async function loginDemoUser(username: string, password: string): Promise<DemoUser> {
  const payload = await request<{ user: DemoUser }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  return payload.user;
}

export async function logoutDemoUser(): Promise<void> {
  await request<{ ok: boolean }>("/api/auth/logout", { method: "POST", body: "{}" });
}

export async function applyForUser(input: { name: string; email: string; department: string; visitor_id?: string; source?: string }): Promise<{ username: string; initial_password: string; user: DemoUser }> {
  const payload = await request<{ username: string; user: DemoUser; initial_password_notice?: string }>("/api/auth/apply", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return { username: payload.username, user: payload.user, initial_password: "123456" };
}

export async function recordQrVisit(context: { visitor_id: string; source: string }): Promise<void> {
  await request<{ ok: boolean }>("/api/audit/qr-visit", { method: "POST", body: JSON.stringify(context) });
}

export async function recordDashboardView(_userId: string, context: { visitor_id?: string; source?: string }): Promise<void> {
  await request<{ ok: boolean }>("/api/audit/dashboard-view", { method: "POST", body: JSON.stringify(context) });
}

export async function listDemoUsers(page = 1, query = ""): Promise<{ users: DemoUser[]; meta: AdminListMeta }> {
  const params = new URLSearchParams({ page: String(page), page_size: "4", q: query });
  return request<{ users: DemoUser[]; meta: AdminListMeta }>(`/api/admin/users?${params.toString()}`);
}

export async function createAdminUser(input: { name: string; email: string; department: string }): Promise<{ user: DemoUser; initial_password: string }> {
  const payload = await request<{ user: DemoUser }>("/api/admin/users", { method: "POST", body: JSON.stringify(input) });
  return { user: payload.user, initial_password: "123456" };
}

export async function updateDemoUserStatus(userId: string, status: DemoUserStatus, _currentUserId: string): Promise<DemoUser> {
  const payload = await request<{ user: DemoUser }>(`/api/admin/users/${encodeURIComponent(userId)}`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
  return payload.user;
}

export async function listAuditEvents(eventType: AuditEventType | "", options: { page: number; pageSize: number; query: string }): Promise<{ events: AuditEventRecord[]; meta: AdminListMeta }> {
  const params = new URLSearchParams({ page: String(options.page), page_size: String(options.pageSize), q: options.query });
  if (eventType) params.set("event_type", eventType);
  return request<{ events: AuditEventRecord[]; meta: AdminListMeta }>(`/api/admin/audit/events?${params.toString()}`);
}

export async function getAuditSummary() {
  return request<{
    timezone: string;
    today_qr_visits: number;
    today_qualification_applicants: number;
    today_login_users: number;
    today_dashboard_users: number;
    total_events: number;
    qr_visits: number;
    qualification_applications: number;
    successful_logins: number;
    dashboard_views: number;
  }>("/api/admin/audit/summary");
}

export async function submitDemoFeedback(input: Omit<FeedbackRecord, "id" | "status" | "createdAt" | "processedAt">): Promise<FeedbackRecord> {
  const payload = await request<{ feedback: FeedbackRecord }>("/api/feedback", {
    method: "POST",
    body: JSON.stringify({
      category: input.category,
      brokerName: input.brokerName,
      message: input.message,
      relatedContext: input.relatedContext,
    }),
  });
  return payload.feedback;
}

export async function listDemoFeedback(): Promise<FeedbackRecord[]> {
  const payload = await request<{ feedback: FeedbackRecord[] }>("/api/admin/feedback");
  return payload.feedback;
}

export async function updateDemoFeedbackStatus(feedbackId: string, status: FeedbackStatus): Promise<FeedbackRecord> {
  const payload = await request<{ feedback: FeedbackRecord }>(`/api/admin/feedback/${encodeURIComponent(feedbackId)}`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
  return payload.feedback;
}
