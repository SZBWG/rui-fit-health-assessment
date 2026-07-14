import { NextResponse } from "next/server";
import { createAnonymousSession, SESSION_COOKIE } from "@/lib/auth";
import { handleApi } from "@/lib/http";

export async function POST() {
  let token: string | undefined;
  let expiresAt: Date | undefined;
  const response = await handleApi(async () => {
    const created = await createAnonymousSession();
    token = created.accessToken;
    expiresAt = created.expiresAt;
    return created;
  }, 201);

  if (token && expiresAt && response instanceof NextResponse) {
    response.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      expires: expiresAt,
    });
  }
  return response;
}
