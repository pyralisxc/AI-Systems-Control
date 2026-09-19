import { NextRequest, NextResponse } from "next/server";
import {
  normalizeOwnerReturnPath
} from "../../../../../dist/application/index.js";
import {
  authenticateOwnerPassword,
  OWNER_SESSION_COOKIE,
  ownerAuthConfigured,
  ownerSessionCookieOptions
} from "@/web/auth/owner-auth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!ownerAuthConfigured()) {
    return NextResponse.json(
      { error: "ASC owner access is not configured." },
      { status: 503, headers: { "cache-control": "no-store" } }
    );
  }

  const form = await request.formData();
  const password =
    typeof form.get("password") === "string"
      ? String(form.get("password"))
      : "";
  const returnTo = normalizeOwnerReturnPath(
    typeof form.get("returnTo") === "string"
      ? String(form.get("returnTo"))
      : "/"
  );

  const token = authenticateOwnerPassword(password);
  if (!token) {
    const location = new URL("/login", request.nextUrl.origin);
    location.searchParams.set("returnTo", returnTo);
    location.searchParams.set("error", "invalid");
    return NextResponse.redirect(location, 303);
  }

  const response = NextResponse.redirect(
    new URL(returnTo, request.nextUrl.origin),
    303
  );
  response.cookies.set(
    OWNER_SESSION_COOKIE,
    token,
    ownerSessionCookieOptions()
  );
  response.headers.set("cache-control", "no-store");
  return response;
}
