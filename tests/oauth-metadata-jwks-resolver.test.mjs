import assert from "node:assert/strict";
import test from "node:test";

import {
  OAuthMetadataDiscoveryError,
  OAuthMetadataJwksResolver,
  oauthAuthorizationServerMetadataUrl,
  oidcDiscoveryMetadataUrl
} from "../dist/adapters/index.js";

function response(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    body: new TextEncoder().encode(
      typeof payload === "string"
        ? payload
        : JSON.stringify(payload)
    )
  };
}

test("RFC 8414 metadata URL inserts well-known before issuer path", () => {
  assert.equal(
    oauthAuthorizationServerMetadataUrl(
      "https://auth.example.test/tenant-one"
    ),
    "https://auth.example.test/.well-known/oauth-authorization-server/tenant-one"
  );
});

test("OIDC discovery URL appends openid-configuration to issuer", () => {
  assert.equal(
    oidcDiscoveryMetadataUrl(
      "https://auth.example.test/tenant-one"
    ),
    "https://auth.example.test/tenant-one/.well-known/openid-configuration"
  );
});

test("OAuth metadata discovery resolves JWKS from RFC 8414 first", async () => {
  const seen = [];
  const resolver = new OAuthMetadataJwksResolver({
    fetcher: async (url) => {
      seen.push(url);
      return response(200, {
        issuer: "https://auth.example.test",
        jwks_uri: "https://auth.example.test/.well-known/jwks.json"
      });
    }
  });

  const result = await resolver.resolve(
    "https://auth.example.test/"
  );

  assert.equal(result.source, "oauth_metadata");
  assert.equal(
    result.jwksUrl,
    "https://auth.example.test/.well-known/jwks.json"
  );
  assert.equal(seen.length, 1);
});

test("OAuth metadata discovery falls back to OIDC when RFC endpoint is unavailable", async () => {
  const seen = [];
  const resolver = new OAuthMetadataJwksResolver({
    fetcher: async (url) => {
      seen.push(url);
      if (url.includes("oauth-authorization-server")) {
        return response(404, {});
      }
      return response(200, {
        issuer: "https://auth.example.test",
        jwks_uri: "https://auth.example.test/keys"
      });
    }
  });

  const result = await resolver.resolve(
    "https://auth.example.test"
  );

  assert.equal(result.source, "oidc_metadata");
  assert.equal(result.jwksUrl, "https://auth.example.test/keys");
  assert.equal(seen.length, 2);
});

test("successful metadata with issuer mismatch fails closed without fallback", async () => {
  let calls = 0;
  const resolver = new OAuthMetadataJwksResolver({
    fetcher: async () => {
      calls += 1;
      return response(200, {
        issuer: "https://evil.example.test",
        jwks_uri: "https://evil.example.test/keys"
      });
    }
  });

  await assert.rejects(
    () => resolver.resolve("https://auth.example.test"),
    /issuer does not exactly match/i
  );
  assert.equal(calls, 1);
});

test("successful metadata without JWKS fails closed", async () => {
  const resolver = new OAuthMetadataJwksResolver({
    fetcher: async () =>
      response(200, {
        issuer: "https://auth.example.test"
      })
  });

  await assert.rejects(
    () => resolver.resolve("https://auth.example.test"),
    /does not contain jwks_uri/i
  );
});

test("non-HTTPS remote JWKS is rejected", async () => {
  const resolver = new OAuthMetadataJwksResolver({
    fetcher: async () =>
      response(200, {
        issuer: "https://auth.example.test",
        jwks_uri: "http://auth.example.test/keys"
      })
  });

  await assert.rejects(
    () => resolver.resolve("https://auth.example.test"),
    /must use HTTPS/i
  );
});

test("oversized metadata is rejected", async () => {
  const resolver = new OAuthMetadataJwksResolver({
    maxBytes: 1024,
    fetcher: async () => ({
      ok: true,
      status: 200,
      body: new Uint8Array(1025)
    })
  });

  await assert.rejects(
    () => resolver.resolve("https://auth.example.test"),
    /exceeds the allowed size/i
  );
});
