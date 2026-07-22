import { createHash, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  AdminListMeta,
  AuditEventRecord,
  AuditEventType,
  DemoUser,
  DemoUserStatus,
  FeedbackRecord,
  FeedbackStatus,
  LoginLog,
} from "@/lib/local-platform-service";

type RuntimeUser = DemoUser & { passwordHash: string; updatedAt: string };
type RuntimeSession = { tokenHash: string; userId: string; createdAt: string; expiresAt: string };

const RUNTIME_DIR = path.resolve(process.env.COZE_RUNTIME_DIR ?? path.join(process.cwd(), ".runtime"));
const MIGRATION_PATH = path.resolve(process.cwd(), "migration", "users-import.json");
const SESSION_COOKIE = "coze_session";
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
const INITIAL_PASSWORD = "123456";
const ADMIN_PASSWORD = process.env.COZE_ADMIN_PASSWORD ?? "098765";

let initialization: Promise<void> | null = null;
let writeQueue = Promise.resolve();

const FILES = {
  users: "users.json",
  sessions: "sessions.json",
  loginLogs: "login-logs.json",
  audit: "audit.json",
  feedback: "feedback.json",
} as const;

function now(): string {
  return new Date().toISOString();
}

function hashPassword(password: string): string {
  const salt = Buffer.from(randomUUID().replaceAll("-", ""), "hex");
  const digest = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${digest.toString("hex")}`;
}

function verifyPassword(password: string, encoded: string): boolean {
  const [algorithm, saltHex, digestHex] = encoded.split("$");
  if (algorithm !== "scrypt" || !saltHex || !digestHex) return false;
  try {
    const actual = scryptSync(password, Buffer.from(saltHex, "hex"), 64);
    const expected = Buffer.from(digestHex, "hex");
    return expected.length === actual.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function hashSession(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function readJson<T>(name: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path.join(RUNTIME_DIR, name), "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(name: string, value: unknown): Promise<void> {
  await mkdir(RUNTIME_DIR, { recursive: true });
  const target = path.join(RUNTIME_DIR, name);
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, target);
}

async function enqueueWrite<T>(operation: () => Promise<T>): Promise<T> {
  let result!: T;
  const next = writeQueue.then(async () => {
    result = await operation();
  });
  writeQueue = next.then(() => undefined, () => undefined);
  await next;
  return result;
}

function publicUser(user: RuntimeUser): DemoUser {
  const { passwordHash: _passwordHash, ...safeUser } = user;
  return safeUser;
}

async function initializeRuntime(): Promise<void> {
  await mkdir(RUNTIME_DIR, { recursive: true });
  const users = await readJson<RuntimeUser[]>(FILES.users, []);
  if (users.length === 0) {
    let imported: Array<Record<string, unknown>> = [];
    try {
      imported = JSON.parse(await readFile(MIGRATION_PATH, "utf8")) as Array<Record<string, unknown>>;
    } catch {
      imported = [];
    }
    const importedUsers: RuntimeUser[] = imported.map((item) => {
      const createdAt = String(item.created_at ?? now());
      return {
        id: String(item.id),
        username: String(item.username ?? ""),
        name: String(item.name ?? ""),
        email: String(item.email ?? ""),
        department: String(item.department ?? ""),
        status: "active" as const,
        isAdmin: false,
        createdAt,
        updatedAt: String(item.updated_at ?? createdAt),
        passwordHash: hashPassword(INITIAL_PASSWORD),
      };
    }).filter((item) => item.username);
    const adminNow = now();
    importedUsers.push({
      id: "admin",
      username: "admin",
      name: "系统管理员",
      email: "",
      department: "",
      status: "active" as const,
      isAdmin: true,
      createdAt: adminNow,
      updatedAt: adminNow,
      passwordHash: hashPassword(ADMIN_PASSWORD),
    });
    await writeJson(FILES.users, importedUsers);
  } else if (!users.some((user) => user.username === "admin" && user.isAdmin)) {
    const adminNow = now();
    await writeJson(FILES.users, [...users, {
      id: "admin",
      username: "admin",
      name: "系统管理员",
      email: "",
      department: "",
      status: "active" as const,
      isAdmin: true,
      createdAt: adminNow,
      updatedAt: adminNow,
      passwordHash: hashPassword(ADMIN_PASSWORD),
    }]);
  }
  for (const [key, fallback] of Object.entries({
    [FILES.sessions]: [],
    [FILES.loginLogs]: [],
    [FILES.audit]: [],
    [FILES.feedback]: [],
  })) {
    const target = path.join(RUNTIME_DIR, key);
    try {
      await readFile(target, "utf8");
    } catch {
      await writeJson(key, fallback);
    }
  }
}

export async function ensureRuntime(): Promise<void> {
  if (!initialization) initialization = initializeRuntime();
  await initialization;
}

async function users(): Promise<RuntimeUser[]> {
  await ensureRuntime();
  return readJson<RuntimeUser[]>(FILES.users, []);
}

async function findUser(userId: string): Promise<RuntimeUser | null> {
  return (await users()).find((user) => user.id === userId) ?? null;
}

export async function authenticate(username: string, password: string): Promise<{ user: DemoUser; token: string }> {
  const normalizedUsername = username.trim();
  const allUsers = await users();
  const user = allUsers.find((item) => item.username === normalizedUsername);
  const success = Boolean(user && user.status === "active" && verifyPassword(password, user.passwordHash));
  await enqueueWrite(async () => {
    const logs = await readJson<LoginLog[]>(FILES.loginLogs, []);
    await writeJson(FILES.loginLogs, [...logs, {
      id: `login_${randomUUID()}`,
      userId: user?.id ?? null,
      username: normalizedUsername,
      success,
      createdAt: now(),
    }].slice(-500));
  });
  if (!user) throw new Error("用户名或密码错误");
  if (user.status === "pending") throw new Error("账号正在等待管理员审批");
  if (user.status === "disabled") throw new Error("账号已被禁用");
  if (!success) throw new Error("用户名或密码错误");

  const token = randomUUID() + randomUUID();
  const createdAt = now();
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000).toISOString();
  await enqueueWrite(async () => {
    const sessions = await readJson<RuntimeSession[]>(FILES.sessions, []);
    const activeSessions = sessions.filter((item) => new Date(item.expiresAt).getTime() > Date.now());
    await writeJson(FILES.sessions, [...activeSessions, { tokenHash: hashSession(token), userId: user.id, createdAt, expiresAt }]);
  });
  await recordAudit("login_success", user, {});
  return { user: publicUser(user), token };
}

export async function sessionUser(token: string | undefined): Promise<DemoUser | null> {
  if (!token) return null;
  const sessions = await readJson<RuntimeSession[]>(FILES.sessions, []);
  const session = sessions.find((item) => item.tokenHash === hashSession(token) && new Date(item.expiresAt).getTime() > Date.now());
  return session ? publicUser((await findUser(session.userId)) as RuntimeUser) : null;
}

export async function deleteSession(token: string | undefined): Promise<void> {
  if (!token) return;
  await ensureRuntime();
  await enqueueWrite(async () => {
    const sessions = await readJson<RuntimeSession[]>(FILES.sessions, []);
    await writeJson(FILES.sessions, sessions.filter((item) => item.tokenHash !== hashSession(token)));
  });
}

export async function registerUser(input: { name: string; email: string; department: string }): Promise<{ username: string; user: DemoUser }> {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  const department = input.department.trim();
  if (!name || !email || !department) throw new Error("请填写完整申请信息");
  const allUsers = await users();
  if (allUsers.some((user) => user.email.toLowerCase() === email)) throw new Error("邮箱已存在");
  const base = email.split("@", 1)[0].replace(/[^A-Za-z0-9_.-]/g, "_") || "user";
  let username = base;
  let suffix = 1;
  while (allUsers.some((user) => user.username === username)) username = `${base}${suffix++}`;
  const createdAt = now();
  const user: RuntimeUser = {
    id: `user_${randomUUID()}`,
    username,
    name,
    email,
    department,
    status: "pending",
    isAdmin: false,
    createdAt,
    updatedAt: createdAt,
    passwordHash: hashPassword(INITIAL_PASSWORD),
  };
  await enqueueWrite(async () => writeJson(FILES.users, [...allUsers, user]));
  await recordAudit("qualification_application", user, { result: "success" });
  return { username, user: publicUser(user) };
}

export async function recordAudit(eventType: AuditEventType, user: DemoUser | null, metadata: Record<string, string>, context?: { visitor_id?: string; source?: string }): Promise<void> {
  await enqueueWrite(async () => {
    const events = await readJson<AuditEventRecord[]>(FILES.audit, []);
    await writeJson(FILES.audit, [...events, {
      id: `audit_${randomUUID()}`,
      event_type: eventType,
      user_id: user?.id ?? null,
      username: user?.username ?? null,
      role: user?.isAdmin ? "admin" : user ? "user" : null,
      source: context?.source ?? null,
      created_at: now(),
      metadata: { ...metadata, ...(context?.visitor_id ? { visitor_id: context.visitor_id } : {}) },
    }].slice(-1000));
  });
}

export async function listUsers(page: number, pageSize: number, query: string): Promise<{ users: DemoUser[]; meta: AdminListMeta }> {
  const normalized = query.trim().toLowerCase();
  const filtered = (await users()).filter((user) => !normalized || [user.name, user.username, user.email, user.department].join(" ").toLowerCase().includes(normalized));
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const effectivePage = Math.min(Math.max(1, page), totalPages);
  const start = (effectivePage - 1) * pageSize;
  return {
    users: filtered.slice(start, start + pageSize).map(publicUser),
    meta: { page: effectivePage, page_size: pageSize, total: filtered.length, total_pages: totalPages, q: query },
  };
}

export async function createManagedUser(input: { name: string; email: string; department: string }): Promise<DemoUser> {
  const result = await registerUser(input);
  const allUsers = await users();
  const updated = allUsers.map((user) => user.id === result.user.id ? { ...user, status: "active" as const, updatedAt: now() } : user);
  await enqueueWrite(async () => writeJson(FILES.users, updated));
  return publicUser(updated.find((user) => user.id === result.user.id) as RuntimeUser);
}

export async function updateUserStatus(userId: string, status: DemoUserStatus, currentUserId: string): Promise<DemoUser> {
  if (userId === currentUserId && status !== "active") throw new Error("不能禁用当前登录管理员");
  const allUsers = await users();
  const target = allUsers.find((user) => user.id === userId);
  if (!target) throw new Error("用户不存在");
  const updated = allUsers.map((user) => user.id === userId ? { ...user, status, updatedAt: now() } : user);
  await enqueueWrite(async () => writeJson(FILES.users, updated));
  return publicUser(updated.find((user) => user.id === userId) as RuntimeUser);
}

export async function listAuditEvents(eventType: AuditEventType | "", page: number, pageSize: number, query: string): Promise<{ events: AuditEventRecord[]; meta: AdminListMeta }> {
  const normalized = query.trim().toLowerCase();
  const all = (await readJson<AuditEventRecord[]>(FILES.audit, [])).slice().reverse();
  const filtered = all.filter((event) => (!eventType || event.event_type === eventType) && (!normalized || JSON.stringify(event).toLowerCase().includes(normalized)));
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const effectivePage = Math.min(Math.max(1, page), totalPages);
  const start = (effectivePage - 1) * pageSize;
  return { events: filtered.slice(start, start + pageSize), meta: { page: effectivePage, page_size: pageSize, total: filtered.length, total_pages: totalPages, q: query } };
}

export async function auditSummary() {
  const events = await readJson<AuditEventRecord[]>(FILES.audit, []);
  const today = new Date().toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" });
  const todayEvents = events.filter((event) => new Date(event.created_at).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" }) === today);
  const count = (type: AuditEventType) => events.filter((event) => event.event_type === type).length;
  const todayCount = (type: AuditEventType) => todayEvents.filter((event) => event.event_type === type).length;
  return {
    timezone: "Asia/Shanghai",
    today_qr_visits: todayCount("qr_visit"),
    today_qualification_applicants: todayCount("qualification_application"),
    today_login_users: todayCount("login_success"),
    today_dashboard_users: todayCount("dashboard_view"),
    total_events: events.length,
    qr_visits: count("qr_visit"),
    qualification_applications: count("qualification_application"),
    successful_logins: count("login_success"),
    dashboard_views: count("dashboard_view"),
  };
}

export async function createFeedback(input: Omit<FeedbackRecord, "id" | "status" | "createdAt" | "processedAt">): Promise<FeedbackRecord> {
  const record: FeedbackRecord = { ...input, id: `feedback_${randomUUID()}`, status: "pending", createdAt: now(), processedAt: null };
  await enqueueWrite(async () => {
    const feedback = await readJson<FeedbackRecord[]>(FILES.feedback, []);
    await writeJson(FILES.feedback, [...feedback, record]);
  });
  return record;
}

export async function listFeedback(): Promise<FeedbackRecord[]> {
  return (await readJson<FeedbackRecord[]>(FILES.feedback, [])).slice().reverse();
}

export async function updateFeedbackStatus(feedbackId: string, status: FeedbackStatus): Promise<FeedbackRecord> {
  const feedback = await readJson<FeedbackRecord[]>(FILES.feedback, []);
  const target = feedback.find((item) => item.id === feedbackId);
  if (!target) throw new Error("反馈不存在");
  const updated = feedback.map((item) => item.id === feedbackId ? { ...item, status, processedAt: status === "processed" ? now() : null } : item);
  await enqueueWrite(async () => writeJson(FILES.feedback, updated));
  return updated.find((item) => item.id === feedbackId) as FeedbackRecord;
}

export const platformConstants = { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS };
