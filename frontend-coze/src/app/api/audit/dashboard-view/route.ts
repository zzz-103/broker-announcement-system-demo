import { NextResponse } from "next/server";

import { requireUser, routeError } from "@/lib/route-auth";
import { recordAudit } from "@/lib/server-platform";

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = await request.json().catch(() => ({})) as { visitor_id?: string; source?: string };
    await recordAudit("dashboard_view", user, {}, { visitor_id: body.visitor_id, source: body.source });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return routeError(error, "审计记录失败");
  }
}
