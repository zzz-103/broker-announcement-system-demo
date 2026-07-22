import { NextResponse } from "next/server";

import { requireAdmin, routeError } from "@/lib/route-auth";
import { auditSummary } from "@/lib/server-platform";

export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json(await auditSummary());
  } catch (error) {
    return routeError(error, "审计摘要加载失败");
  }
}
