import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveMcpSetupReadiness
} from "../dist/application/index.js";

function base(overrides = {}) {
  return {
    durableStorageConfigured: true,
    resourceUrlConfigured: true,
    oauthIssuerConfigured: true,
    oauthJwksConfigured: true,
    externalIdentityBound: true,
    ...overrides
  };
}

test("MCP readiness reports durable storage as first blocker", () => {
  const result = deriveMcpSetupReadiness(
    base({
      durableStorageConfigured: false,
      resourceUrlConfigured: false,
      oauthIssuerConfigured: false,
      oauthJwksConfigured: false,
      externalIdentityBound: false
    })
  );

  assert.equal(result.state, "needs_storage");
  assert.deepEqual(result.blockers, ["durable_storage"]);
});

test("MCP readiness requires a stable resource before IdP wiring", () => {
  const result = deriveMcpSetupReadiness(
    base({ resourceUrlConfigured: false })
  );
  assert.equal(result.state, "needs_resource_url");
});

test("MCP readiness groups missing issuer and JWKS as IdP blockers", () => {
  const result = deriveMcpSetupReadiness(
    base({
      oauthIssuerConfigured: false,
      oauthJwksConfigured: false
    })
  );

  assert.equal(result.state, "needs_idp");
  assert.deepEqual(
    result.blockers,
    ["oauth_issuer", "oauth_jwks"]
  );
});

test("MCP readiness requires external identity binding after IdP setup", () => {
  const result = deriveMcpSetupReadiness(
    base({
      externalIdentityBound: false
    })
  );
  assert.equal(result.state, "needs_identity_binding");
});

test("MCP readiness becomes test-ready only when all external pieces exist", () => {
  const result = deriveMcpSetupReadiness(base());
  assert.equal(result.state, "ready_for_mcp_test");
  assert.deepEqual(result.blockers, []);
});
