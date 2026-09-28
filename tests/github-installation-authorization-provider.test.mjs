import assert from "node:assert/strict";
import test from "node:test";

import {
  GitHubInstallationAuthorizationProvider
} from "../dist/adapters/index.js";

class FakeAttestor {
  attestations = new Map();

  async attestInstallation(input) {
    const value = this.attestations.get(input.installationId);
    if (!value) throw new Error("installation unavailable");
    return value;
  }

  async verifyInstallation(input) {
    return this.attestations.get(input.installationId);
  }
}

function attestation(overrides = {}) {
  return {
    installationId: "12345",
    accountId: "1001",
    accountLogin: "pyralisxc",
    accountType: "User",
    repositorySelection: "selected",
    capabilities: [
      "repository.read",
      "source.read",
      "pull_request.write"
    ],
    verifiedAt: "2026-09-28T02:10:00.000Z",
    ...overrides
  };
}

function provider(attestor = new FakeAttestor()) {
  return {
    attestor,
    provider: new GitHubInstallationAuthorizationProvider({
      appSlug: "asc-control",
      setupCallbackUrl:
        "https://asc.example/api/connections/github/callback",
      attestor
    })
  };
}

test("GitHub installation authorization begins at app installation URL with broker state", async () => {
  const context = provider();

  const result = await context.provider.beginAuthorization({
    flowId: "authflow:one",
    principalId: "principal:owner",
    accountDomainId: "domain:personal",
    state: "authflow:one.secure-nonce-value-that-is-long-enough",
    callbackUrl:
      "https://asc.example/api/connections/github/callback"
  });

  const url = new URL(result.authorizationUrl);
  assert.equal(
    url.origin + url.pathname,
    "https://github.com/apps/asc-control/installations/new"
  );
  assert.equal(
    url.searchParams.get("state"),
    "authflow:one.secure-nonce-value-that-is-long-enough"
  );
});

test("GitHub installation callback creates metadata only after external attestation", async () => {
  const context = provider();
  context.attestor.attestations.set(
    "12345",
    attestation()
  );

  const metadata =
    await context.provider.completeAuthorization({
      flowId: "authflow:one",
      principalId: "principal:owner",
      accountDomainId: "domain:personal",
      callback: {
        installation_id: "12345",
        setup_action: "install"
      }
    });

  assert.deepEqual(metadata, {
    providerAccountId: "installation:12345",
    providerDisplayName: "pyralisxc",
    label: "GitHub pyralisxc (User)",
    authenticationStrategy: "app_installation",
    capabilities: [
      "pull_request.write",
      "repository.read",
      "source.read"
    ]
  });
  assert.equal(
    "token" in metadata ||
    "secret" in metadata ||
    "privateKey" in metadata,
    false
  );
});

test("GitHub callback installation ID is never trusted without attestation", async () => {
  const context = provider();

  await assert.rejects(
    () => context.provider.completeAuthorization({
      flowId: "authflow:one",
      principalId: "principal:owner",
      accountDomainId: "domain:personal",
      callback: {
        installation_id: "99999"
      }
    }),
    /installation unavailable/i
  );
});

test("GitHub installation verification returns reconnect-required when attestor no longer sees installation", async () => {
  const context = provider();

  const result =
    await context.provider.verifyAuthorization({
      principalId: "principal:owner",
      accountDomainId: "domain:personal",
      providerAccountId: "installation:12345"
    });

  assert.equal(result.status, "reconnect_required");
  assert.deepEqual(result.capabilities, []);
});

test("GitHub installation verification returns attested capabilities", async () => {
  const context = provider();
  context.attestor.attestations.set(
    "12345",
    attestation({
      capabilities: ["source.read", "source.read", "issue.write"]
    })
  );

  const result =
    await context.provider.verifyAuthorization({
      principalId: "principal:owner",
      accountDomainId: "domain:personal",
      providerAccountId: "installation:12345"
    });

  assert.equal(result.status, "active");
  assert.deepEqual(
    result.capabilities,
    ["issue.write", "source.read"]
  );
});

test("GitHub ASC revoke does not uninstall provider app implicitly", async () => {
  const context = provider();
  await context.provider.revokeAuthorization({
    principalId: "principal:owner",
    accountDomainId: "domain:personal",
    providerAccountId: "installation:12345"
  });
});

test("GitHub installation adapter rejects mismatched callback URL and malformed IDs", async () => {
  const context = provider();

  await assert.rejects(
    () => context.provider.beginAuthorization({
      flowId: "authflow:one",
      principalId: "principal:owner",
      accountDomainId: "domain:personal",
      state: "authflow:one.secure-nonce-value-that-is-long-enough",
      callbackUrl: "https://other.example/callback"
    }),
    /does not match/i
  );

  await assert.rejects(
    () => context.provider.completeAuthorization({
      flowId: "authflow:one",
      principalId: "principal:owner",
      accountDomainId: "domain:personal",
      callback: {
        installation_id: "not-an-id"
      }
    }),
    /installation_id is invalid/i
  );
});
