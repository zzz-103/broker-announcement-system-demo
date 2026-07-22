import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { platformConstants, sessionUser } from "@/lib/server-platform";
import type { DemoUser } from "@/lib/local-platform-service";

export async function currentUser(): Promise<DemoUser | null> {
  const cookieStore = await cookies();
  return sessionUser(cookieStore.get(platformConstants.SESSION_COOKIE)?.value);
}

export async function requireUser(): Promise<DemoUser> {
  const user = await currentUser();
  if (!user) throw new AuthRouteError("请先登录", 401);
  return user;
}

export async function requireAdmin(): Promise<DemoUser> {
  const user = await requireUser();
  if (!user.isAdmin) throw new AuthRouteError("无管理员权限", 403);
  return user;
}

export class AuthRouteError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export function routeError(error: unknown, fallback = "操作失败") {
  if (error instanceof AuthRouteError) return NextResponse.json({ detail: error.message }, { status: error.status });
  if (error instanceof Error) return NextResponse.json({ detail: error.message }, { status: 400 });
  return NextResponse.json({ detail: fallback }, { status: 500 });
}

export function getPageParams(request: Request) {
  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page") || "1") || 1);
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("page_size") || "20") || 20));
  return { page, pageSize, query: url.searchParams.get("q") || "" };
}
