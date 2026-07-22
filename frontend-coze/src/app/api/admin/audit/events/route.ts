import { NextResponse } from "next/server";

import { getPageParams, requireAdmin, routeError } from "@/lib/route-auth";
import { listAuditEvents } from "@/lib/server-platform";
import type { AuditEventType } from "@/lib/local-platform-service";

export async function GET(request: Request) {
  try {
    await requireAdmin();
    const { page, pageSize, query } = getPageParams(request);
    const type = new URL(request.url).searchParams.get("event_type") || "";
    return NextResponse.json(await listAuditEvents(type as AuditEventType | "", page, pageSize, query));
  } catch (error) {
    return routeError(error, "审计记录加载失败");
  }
}
