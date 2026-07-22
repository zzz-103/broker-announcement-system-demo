import { NextResponse } from "next/server";

import { currentUser } from "@/lib/route-auth";

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ detail: "未登录" }, { status: 401 });
  return NextResponse.json({ user });
}
