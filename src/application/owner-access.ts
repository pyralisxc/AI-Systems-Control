import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const OWNER_SESSION_PREFIX = "asc1";

export interface CreateOwnerSessionTokenInput {
  readonly secret: string;
  readonly nowMs?: number;
  readonly ttlSeconds?: number;
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function signature(expiresAtSeconds: number, secret: string): string {
  return createHmac("sha256", secret)
    .update(`ai-systems-control/owner-session/v1:${expiresAtSeconds}`)
    .digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export function ownerPasswordMatches(
  supplied: string,
  expected: string
): boolean {
  if (!supplied || !expected) return false;
  return timingSafeEqual(digest(supplied), digest(expected));
}

export function createOwnerSessionToken(
  input: CreateOwnerSessionTokenInput
): string {
  if (!input.secret.trim()) {
    throw new Error("Owner session secret is required.");
  }

  const ttlSeconds = input.ttlSeconds ?? 43_200;
  if (!Number.isFinite(ttlSeconds) || ttlSeconds < 300 || ttlSeconds > 604_800) {
    throw new Error("Owner session TTL must be between 300 and 604800 seconds.");
  }

  const nowSeconds = Math.floor((input.nowMs ?? Date.now()) / 1000);
  const expiresAt = nowSeconds + Math.floor(ttlSeconds);
  return `${OWNER_SESSION_PREFIX}.${expiresAt}.${signature(expiresAt, input.secret)}`;
}

export function verifyOwnerSessionToken(
  token: string | undefined,
  secret: string,
  nowMs: number = Date.now()
): boolean {
  if (!token || !secret.trim()) return false;

  const [prefix, expiresText, suppliedSignature, extra] = token.split(".");
  if (
    prefix !== OWNER_SESSION_PREFIX ||
    !expiresText ||
    !suppliedSignature ||
    extra !== undefined
  ) {
    return false;
  }

  const expiresAt = Number(expiresText);
  if (
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= Math.floor(nowMs / 1000)
  ) {
    return false;
  }

  return safeEqual(
    suppliedSignature,
    signature(expiresAt, secret)
  );
}

export function normalizeOwnerReturnPath(
  value: string | null | undefined
): string {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    /[\r\n]/u.test(value)
  ) {
    return "/";
  }
  return value;
}
