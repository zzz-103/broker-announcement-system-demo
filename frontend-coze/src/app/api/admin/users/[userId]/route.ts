import { NextResponse } from "next/server";

import { requireAdmin, routeError } from "@/lib/route-auth";
import { updateUserStatus } from "@/lib/server-platform";

export async function PATCH(request: Request, context: { params: Promise<{ userId: string }> }) {
  try {
    const admin = await requireAdmin();
    const { userId } = await context.params;
    const body = await request.json() as { status?: "pending" | "active" | "disabled" };
    if (!body.status) return NextResponse.json({ detail: "用户状态无效" }, { status: 400 });
    return NextResponse.json({ user: await updateUserStatus(userId, body.status, admin.id) });
  } catch (error) {
    return routeError(error, "用户状态更新失败");
  }
}
