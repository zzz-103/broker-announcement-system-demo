import { NextResponse } from "next/server";

import { requireAdmin, routeError } from "@/lib/route-auth";
import { listFeedback } from "@/lib/server-platform";

export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json({ feedback: await listFeedback() });
  } catch (error) {
    return routeError(error, "反馈加载失败");
  }
}
