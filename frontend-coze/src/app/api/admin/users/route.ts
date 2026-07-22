import { NextResponse } from "next/server";

import { getPageParams, requireAdmin, routeError } from "@/lib/route-auth";
import { createManagedUser, listUsers } from "@/lib/server-platform";

export async function GET(request: Request) {
  try {
    await requireAdmin();
    const { page, pageSize, query } = getPageParams(request);
    return NextResponse.json(await listUsers(page, pageSize, query));
  } catch (error) {
    return routeError(error, "用户加载失败");
  }
}

export async function POST(request: Request) {
  try {
    await requireAdmin();
    const body = await request.json() as { name?: string; email?: string; department?: string };
    const user = await createManagedUser({ name: body.name || "", email: body.email || "", department: body.department || "" });
    return NextResponse.json({ user, initial_password_notice: "初始密码按本地规则为 123456。" });
  } catch (error) {
    return routeError(error, "用户创建失败");
  }
}
