import { NextRequest, NextResponse } from "next/server";
import {
  OWNER_SESSION_COOKIE,
  ownerSessionCookieOptions
} from "@/web/auth/owner-auth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const response = NextResponse.redirect(
    new URL("/login", request.nextUrl.origin),
    303
  );
  response.cookies.set(OWNER_SESSION_COOKIE, "", {
    ...ownerSessionCookieOptions(),
    maxAge: 0
  });
  response.headers.set("cache-control", "no-store");
  return response;
}
