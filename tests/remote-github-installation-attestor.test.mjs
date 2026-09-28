import assert from "node:assert/strict";
import test from "node:test";

import {
  RemoteGitHubInstallationAttestor
} from "../dist/adapters/index.js";

function response(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" }
  });
}

test("remote GitHub attestor reads safe App identity through Conductor bridge", async () => {
  const seen = [];
  const attestor = new RemoteGitHubInstallationAttestor({
    baseUrl: "https://conductor.example",
    secret: "s".repeat(40),
    fetch: async (url, init) => {
      seen.push({
        url: String(url),
        authorization: new Headers(init?.headers).get(
          "authorization"
        )
      });
      return response(200, {
        appId: "123",
        appSlug: "asc-control"
      });
    }
  });

  assert.deepEqual(
    await attestor.getAppIdentity(),
    {
      appId: "123",
      appSlug: "asc-control"
    }
  );
  assert.equal(
    seen[0].url,
    "https://conductor.example/internal/asc/github/app"
  );
  assert.equal(
    seen[0].authorization,
    "Bearer " + "s".repeat(40)
  );
});

test("remote GitHub attestor validates installation response and never accepts token fields", async () => {
  const attestor = new RemoteGitHubInstallationAttestor({
    baseUrl: "https://conductor.example/",
    secret: "s".repeat(40),
    fetch: async () =>
      response(200, {
        installationId: "456",
        accountId: "789",
        accountLogin: "pyralisxc",
        accountType: "User",
        repositorySelection: "selected",
        capabilities: [
          "source.read",
          "pull_request.write"
        ],
        verifiedAt: "2026-09-28T02:30:00.000Z"
      })
  });

  const result = await attestor.attestInstallation({
    installationId: "456",
    principalId: "principal:owner",
    accountDomainId: "domain:personal"
  });

  assert.deepEqual(result, {
    installationId: "456",
    accountId: "789",
    accountLogin: "pyralisxc",
    accountType: "User",
    repositorySelection: "selected",
    capabilities: [
      "pull_request.write",
      "source.read"
    ],
    verifiedAt: "2026-09-28T02:30:00.000Z"
  });
});

test("remote GitHub attestor fails closed when bridge is unavailable or installation differs", async () => {
  const unavailable =
    new RemoteGitHubInstallationAttestor({
      baseUrl: "https://conductor.example",
      secret: "s".repeat(40),
      fetch: async () => response(401, {
        error: "unauthorized"
      })
    });

  await assert.rejects(
    () => unavailable.getAppIdentity(),
    /HTTP 401/i
  );

  const mismatch =
    new RemoteGitHubInstallationAttestor({
      baseUrl: "https://conductor.example",
      secret: "s".repeat(40),
      fetch: async () =>
        response(200, {
          installationId: "999",
          accountId: "789",
          accountLogin: "pyralisxc",
          accountType: "User",
          repositorySelection: "all",
          capabilities: [],
          verifiedAt: "2026-09-28T02:30:00.000Z"
        })
    });

  await assert.rejects(
    () => mismatch.attestInstallation({
      installationId: "456",
      principalId: "principal:owner",
      accountDomainId: "domain:personal"
    }),
    /different GitHub installation/i
  );
});
