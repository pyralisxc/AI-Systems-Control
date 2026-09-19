import { cookies } from "next/headers";
import {
  createOwnerSessionToken,
  ownerPasswordMatches,
  verifyOwnerSessionToken
} from "../../../dist/application/index.js";

export const OWNER_SESSION_COOKIE = "asc_owner_session";
export const OWNER_SESSION_TTL_SECONDS = 43_200;

function ownerPassword(): string {
  return process.env.ASC_OWNER_PASSWORD?.trim() ?? "";
}

function ownerSessionSecret(): string {
  return process.env.ASC_SESSION_SECRET?.trim() ?? "";
}

export function ownerAuthConfigured(): boolean {
  return Boolean(ownerPassword() && ownerSessionSecret());
}

export function authenticateOwnerPassword(password: string): string | null {
  const expected = ownerPassword();
  const secret = ownerSessionSecret();
  if (!expected || !secret || !ownerPasswordMatches(password, expected)) {
    return null;
  }

  return createOwnerSessionToken({
    secret,
    ttlSeconds: OWNER_SESSION_TTL_SECONDS
  });
}

export async function isOwnerAuthenticated(): Promise<boolean> {
  const secret = ownerSessionSecret();
  if (!secret || !ownerPassword()) return false;

  const store = await cookies();
  return verifyOwnerSessionToken(
    store.get(OWNER_SESSION_COOKIE)?.value,
    secret
  );
}

export function ownerSessionCookieOptions(): {
  readonly httpOnly: true;
  readonly sameSite: "strict";
  readonly secure: boolean;
  readonly path: "/";
  readonly maxAge: number;
} {
  return {
    httpOnly: true,
    sameSite: "strict",
    secure:
      process.env.VERCEL_ENV === "production" ||
      process.env.NODE_ENV === "production",
    path: "/",
    maxAge: OWNER_SESSION_TTL_SECONDS
  };
}
