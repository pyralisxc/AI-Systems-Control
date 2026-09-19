import assert from "node:assert/strict";
import test from "node:test";

import {
  createOwnerSessionToken,
  normalizeOwnerReturnPath,
  ownerPasswordMatches,
  verifyOwnerSessionToken
} from "../dist/application/index.js";

test("owner password comparison accepts only the exact configured secret", () => {
  assert.equal(ownerPasswordMatches("correct horse", "correct horse"), true);
  assert.equal(ownerPasswordMatches("correct horse", "wrong horse"), false);
  assert.equal(ownerPasswordMatches("", "correct horse"), false);
});

test("owner session tokens verify only before expiry with the signing secret", () => {
  const nowMs = Date.UTC(2026, 8, 19, 1, 0, 0);
  const token = createOwnerSessionToken({
    secret: "session-secret-value",
    nowMs,
    ttlSeconds: 600
  });

  assert.equal(
    verifyOwnerSessionToken(token, "session-secret-value", nowMs + 599_000),
    true
  );
  assert.equal(
    verifyOwnerSessionToken(token, "wrong-secret", nowMs + 1000),
    false
  );
  assert.equal(
    verifyOwnerSessionToken(token, "session-secret-value", nowMs + 600_000),
    false
  );
  assert.equal(
    verifyOwnerSessionToken(token + "tamper", "session-secret-value", nowMs),
    false
  );
});

test("owner return paths cannot escape to another origin", () => {
  assert.equal(normalizeOwnerReturnPath("/?repository=owner/repo"), "/?repository=owner/repo");
  assert.equal(normalizeOwnerReturnPath("https://evil.example"), "/");
  assert.equal(normalizeOwnerReturnPath("//evil.example/path"), "/");
  assert.equal(normalizeOwnerReturnPath("/\\evil.example"), "/");
  assert.equal(normalizeOwnerReturnPath("/safe\nLocation: https://evil.example"), "/");
});
