import { requestJson } from "./core";
import type {
  ApplyUserInput,
  ApplyUserResponse,
  AuditContextInput,
  FeedbackCreateInput,
  FeedbackResponse,
  LoginResponse,
} from "./contracts";

export function loginAdmin(
  username: string,
  password: string,
  auditContext: AuditContextInput = {},
): Promise<LoginResponse> {
  return requestJson<LoginResponse>("/api/login", {
    method: "POST",
    body: JSON.stringify({ username, password, ...auditContext }),
  });
}

export function applyForUser(input: ApplyUserInput & AuditContextInput): Promise<ApplyUserResponse> {
  return requestJson<ApplyUserResponse>("/api/users/apply", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function recordQrVisit(context: Required<AuditContextInput>): Promise<{ recorded: boolean }> {
  return requestJson<{ recorded: boolean }>("/api/audit/qr-visit", {
    method: "POST",
    body: JSON.stringify(context),
  });
}

export function recordDashboardView(
  token: string,
  context: AuditContextInput,
): Promise<{ recorded: boolean }> {
  return requestJson<{ recorded: boolean }>(
    "/api/audit/dashboard-view",
    { method: "POST", body: JSON.stringify(context) },
    token,
  );
}

export function submitFeedback(token: string, input: FeedbackCreateInput): Promise<FeedbackResponse> {
  return requestJson<FeedbackResponse>(
    "/api/feedback",
    { method: "POST", body: JSON.stringify(input) },
    token,
  );
}
