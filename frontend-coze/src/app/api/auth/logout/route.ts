import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { platformConstants, deleteSession } from "@/lib/server-platform";

export async function POST() {
  const cookieStore = await cookies();
  await deleteSession(cookieStore.get(platformConstants.SESSION_COOKIE)?.value);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(platformConstants.SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  return response;
}
