import { NextResponse } from "next/server";

import { routeError } from "@/lib/route-auth";
import { authenticate, platformConstants } from "@/lib/server-platform";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { username?: string; password?: string };
    if (!body.username?.trim() || !body.password) return NextResponse.json({ detail: "请输入用户名和密码" }, { status: 400 });
    const result = await authenticate(body.username, body.password);
    const response = NextResponse.json({ user: result.user });
    response.cookies.set(platformConstants.SESSION_COOKIE, result.token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: platformConstants.SESSION_MAX_AGE_SECONDS,
    });
    return response;
  } catch (error) {
    if (error instanceof Error && error.message.includes("密码")) return NextResponse.json({ detail: error.message }, { status: 401 });
    if (error instanceof Error && (error.message.includes("审批") || error.message.includes("禁用"))) return NextResponse.json({ detail: error.message }, { status: 403 });
    return routeError(error, "登录失败");
  }
}
