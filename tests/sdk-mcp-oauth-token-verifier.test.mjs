import assert from "node:assert/strict";
import test from "node:test";

import {
  SdkMcpOAuthTokenVerifier
} from "../dist/adapters/index.js";
import {
  McpAuthenticationError
} from "../dist/ports/index.js";
import {
  OAuthErrorCode
} from "@modelcontextprotocol/server";

test("SDK verifier returns MCP AuthInfo without changing caller scopes", async () => {
  const verifier = new SdkMcpOAuthTokenVerifier({
    async resolve(token) {
      assert.equal(token, "bearer-value");
      return {
        principalId: "principal:owner",
        membershipId: "membership:owner",
        accountDomainId: "business-a",
        issuer: "https://auth.example.test",
        subject: "user-123",
        scopes: ["asc.mcp", "asc.thread.read"],
        expiresAt: 1790542800
      };
    }
  });

  const info = await verifier.verifyAccessToken("bearer-value");
  assert.equal(info.clientId, "principal:owner");
  assert.deepEqual(info.scopes, ["asc.mcp", "asc.thread.read"]);
  assert.equal(info.expiresAt, 1790542800);
});

test("SDK verifier translates rejected ASC identity into invalid_token", async () => {
  const verifier = new SdkMcpOAuthTokenVerifier({
    async resolve() {
      throw new McpAuthenticationError("unbound identity");
    }
  });

  await assert.rejects(
    () => verifier.verifyAccessToken("bad-token"),
    (error) =>
      error?.code === OAuthErrorCode.InvalidToken &&
      /invalid for this ASC resource/i.test(error.message)
  );
});
