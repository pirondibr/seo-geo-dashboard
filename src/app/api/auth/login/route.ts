import { NextRequest, NextResponse } from "next/server";
import { expectedPassword, sessionCookieName, signSession } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const password = String(body.password || "");
  if (password !== expectedPassword()) {
    return NextResponse.json({ error: "Senha incorreta" }, { status: 401 });
  }
  const token = signSession(`agency:${Date.now()}`);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(sessionCookieName(), token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
