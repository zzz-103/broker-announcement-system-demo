import { NextRequest, NextResponse } from "next/server";

const ADMIN_USER = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASS = process.env.ADMIN_PASSWORD;
const USER_PASS = process.env.USER_PASSWORD || "user2026";

export async function POST(request: NextRequest) {
  try {
    const { username, password } = await request.json();

    if (!username || !password) {
      return NextResponse.json(
        { error: "请输入用户名和密码" },
        { status: 400 }
      );
    }

    // Admin login
    if (ADMIN_PASS && username === ADMIN_USER && password === ADMIN_PASS) {
      return NextResponse.json({
        success: true,
        username: ADMIN_USER,
        isAdmin: true,
      });
    }

    // Regular user login (any username with user password)
    if (password === USER_PASS) {
      return NextResponse.json({
        success: true,
        username: username || "user",
        isAdmin: false,
      });
    }

    return NextResponse.json(
      { error: "用户名或密码错误" },
      { status: 401 }
    );
  } catch {
    return NextResponse.json(
      { error: "登录失败，请重试" },
      { status: 500 }
    );
  }
}
