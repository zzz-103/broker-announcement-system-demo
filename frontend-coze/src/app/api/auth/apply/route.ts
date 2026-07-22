import { NextResponse } from "next/server";

import { routeError } from "@/lib/route-auth";
import { registerUser } from "@/lib/server-platform";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { name?: string; email?: string; department?: string };
    const result = await registerUser({ name: body.name || "", email: body.email || "", department: body.department || "" });
    return NextResponse.json({ username: result.username, user: result.user, initial_password_notice: "初始密码为 123456，账号需管理员审批后登录。" });
  } catch (error) {
    return routeError(error, "申请失败");
  }
}
