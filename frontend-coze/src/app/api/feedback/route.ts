import { NextResponse } from "next/server";

import { requireUser, routeError } from "@/lib/route-auth";
import { createFeedback } from "@/lib/server-platform";

const CATEGORIES = new Set(["broker_request", "data_issue", "product_suggestion"]);

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = await request.json() as { category?: string; brokerName?: string; message?: string; relatedContext?: string };
    if (!body.category || !CATEGORIES.has(body.category)) return NextResponse.json({ detail: "反馈类型无效" }, { status: 400 });
    const feedback = await createFeedback({
      userId: user.id,
      category: body.category as "broker_request" | "data_issue" | "product_suggestion",
      brokerName: String(body.brokerName || "").trim().slice(0, 100),
      message: String(body.message || "").trim().slice(0, 1000),
      relatedContext: String(body.relatedContext || "").trim().slice(0, 200),
    });
    return NextResponse.json({ feedback });
  } catch (error) {
    return routeError(error, "反馈提交失败");
  }
}
