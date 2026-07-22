import { NextResponse } from "next/server";

import { requireAdmin, routeError } from "@/lib/route-auth";
import { updateFeedbackStatus } from "@/lib/server-platform";

export async function PATCH(request: Request, context: { params: Promise<{ feedbackId: string }> }) {
  try {
    await requireAdmin();
    const { feedbackId } = await context.params;
    const body = await request.json() as { status?: "pending" | "processed" };
    if (!body.status) return NextResponse.json({ detail: "反馈状态无效" }, { status: 400 });
    return NextResponse.json({ feedback: await updateFeedbackStatus(feedbackId, body.status) });
  } catch (error) {
    return routeError(error, "反馈状态更新失败");
  }
}
