export type DemoUserStatus = "pending" | "active" | "disabled";
export type FeedbackStatus = "pending" | "processed";

export interface DemoUser {
  id: string;
  username: string;
  name: string;
  email: string;
  department: string;
  status: DemoUserStatus;
  isAdmin: boolean;
  createdAt: string;
}

export interface LoginLog {
  id: string;
  userId: string | null;
  username: string;
  success: boolean;
  createdAt: string;
}

export interface FeedbackRecord {
  id: string;
  userId: string;
  category: "broker_request" | "data_issue" | "product_suggestion";
  brokerName: string;
  message: string;
  relatedContext: string;
  status: FeedbackStatus;
  createdAt: string;
  processedAt: string | null;
}

interface StoredUser extends DemoUser {
  passwordHash: string;
}

const KEYS = {
  users: "broker-coze-demo-users",
  logs: "broker-coze-demo-login-logs",
  feedback: "broker-coze-demo-feedback",
  session: "broker-coze-demo-session",
} as const;

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T): void {
  window.localStorage.setItem(key, JSON.stringify(value));
}

function createId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return prefix + "_" + (uuid || String(Date.now()) + "_" + Math.random().toString(36).slice(2));
}

async function hashPassword(password: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(password));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function publicUser(user: StoredUser): DemoUser {
  const { passwordHash: _passwordHash, ...safeUser } = user;
  return safeUser;
}

function requireBrowser(): void {
  if (typeof window === "undefined") throw new Error("演示用户服务只能在浏览器中运行");
}

export function getSessionUserId(): string | null {
  return typeof window === "undefined" ? null : window.sessionStorage.getItem(KEYS.session);
}

export function setSessionUser(userId: string): void {
  window.sessionStorage.setItem(KEYS.session, userId);
}

export function clearSession(): void {
  window.sessionStorage.removeItem(KEYS.session);
}

export function getDemoUser(userId: string): DemoUser | null {
  const user = read<StoredUser[]>(KEYS.users, []).find((item) => item.id === userId);
  return user ? publicUser(user) : null;
}

export function listDemoUsers(): DemoUser[] {
  return read<StoredUser[]>(KEYS.users, []).map(publicUser);
}

export function hasDemoAdmin(): boolean {
  return read<StoredUser[]>(KEYS.users, []).some((user) => user.isAdmin);
}

export async function createDemoAdmin(input: { username: string; password: string; name: string }): Promise<DemoUser> {
  requireBrowser();
  const users = read<StoredUser[]>(KEYS.users, []);
  if (users.some((user) => user.isAdmin)) throw new Error("演示管理员已经存在");
  if (!input.username.trim() || input.password.length < 8 || !input.name.trim()) throw new Error("请输入姓名、用户名和至少 8 位密码");
  const user: StoredUser = { id: createId("user"), username: input.username.trim(), passwordHash: await hashPassword(input.password), name: input.name.trim(), email: "", department: "", status: "active", isAdmin: true, createdAt: new Date().toISOString() };
  write(KEYS.users, [...users, user]);
  return publicUser(user);
}

export async function registerDemoUser(input: { username: string; password: string; name: string; email: string; department: string }): Promise<DemoUser> {
  requireBrowser();
  const users = read<StoredUser[]>(KEYS.users, []);
  if (users.some((user) => user.username === input.username.trim())) throw new Error("用户名已存在");
  if (!input.username.trim() || input.password.length < 8 || !input.name.trim()) throw new Error("请填写完整信息，密码至少 8 位");
  const user: StoredUser = { id: createId("user"), username: input.username.trim(), passwordHash: await hashPassword(input.password), name: input.name.trim(), email: input.email.trim(), department: input.department.trim(), status: "pending", isAdmin: false, createdAt: new Date().toISOString() };
  write(KEYS.users, [...users, user]);
  return publicUser(user);
}

export async function loginDemoUser(username: string, password: string): Promise<DemoUser> {
  requireBrowser();
  const users = read<StoredUser[]>(KEYS.users, []);
  const user = users.find((item) => item.username === username.trim());
  const passwordHash = await hashPassword(password);
  const success = Boolean(user && user.status === "active" && user.passwordHash === passwordHash);
  const logs = read<LoginLog[]>(KEYS.logs, []);
  write(KEYS.logs, [...logs, { id: createId("login"), userId: user?.id || null, username: username.trim(), success, createdAt: new Date().toISOString() }].slice(-500));
  if (!user) throw new Error("用户名或密码错误");
  if (user.status === "pending") throw new Error("账号正在等待管理员审批");
  if (user.status === "disabled") throw new Error("账号已被禁用");
  if (!success) throw new Error("用户名或密码错误");
  return publicUser(user);
}

export function updateDemoUserStatus(userId: string, status: DemoUserStatus, currentUserId: string): void {
  requireBrowser();
  if (userId === currentUserId && status !== "active") throw new Error("不能禁用当前登录管理员");
  const users = read<StoredUser[]>(KEYS.users, []);
  write(KEYS.users, users.map((user) => user.id === userId ? { ...user, status } : user));
}

export function listLoginLogs(): LoginLog[] {
  return read<LoginLog[]>(KEYS.logs, []).slice().reverse();
}

export function submitDemoFeedback(input: Omit<FeedbackRecord, "id" | "status" | "createdAt" | "processedAt">): FeedbackRecord {
  requireBrowser();
  const record: FeedbackRecord = { ...input, id: createId("feedback"), status: "pending", createdAt: new Date().toISOString(), processedAt: null };
  write(KEYS.feedback, [...read<FeedbackRecord[]>(KEYS.feedback, []), record]);
  return record;
}

export function listDemoFeedback(): FeedbackRecord[] {
  return read<FeedbackRecord[]>(KEYS.feedback, []).slice().reverse();
}

export function updateDemoFeedbackStatus(feedbackId: string, status: FeedbackStatus): void {
  requireBrowser();
  const feedback = read<FeedbackRecord[]>(KEYS.feedback, []);
  write(KEYS.feedback, feedback.map((item) => item.id === feedbackId ? { ...item, status, processedAt: status === "processed" ? new Date().toISOString() : null } : item));
}
