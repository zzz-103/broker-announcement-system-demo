import { NextResponse } from "next/server";

import { recordAudit } from "@/lib/server-platform";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { visitor_id?: string; source?: string };
  if (!body.visitor_id || !body.source) return NextResponse.json({ detail: "audit context is invalid" }, { status: 400 });
  await recordAudit("qr_visit", null, {}, { visitor_id: body.visitor_id, source: body.source });
  return NextResponse.json({ ok: true });
}
