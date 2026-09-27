import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  ConnectionAuthorizationBroker,
  ConnectionAuthorizationError,
  DelegationService,
  InMemoryAuthorizationFlowStore,
  PersistentConnectionRegistry,
  PersistentProjectConnectionBindingRegistry,
  PersistentProjectRegistry
} from "../dist/application/index.js";
import { JsonFileControlRegistryStore } from "../dist/adapters/index.js";

class FakeAuthorizationProvider {
  provider = "fake-oauth";
  secrets = new Map();
  revoked = new Set();

  async beginAuthorization(input) {
    return {
      authorizationUrl:
        "https://provider.invalid/authorize?state=" +
        encodeURIComponent(input.state) +
        "&flow=" +
        encodeURIComponent(input.flowId),
      providerFlowReference: "provider-flow:" + input.flowId
    };
  }

  async completeAuthorization(input) {
    const account = input.callback.account;
    const secret = input.callback.secret;
    if (!account || !secret) throw new Error("fake provider requires account + secret");
    const key = input.accountDomainId + ":" + account;
    this.secrets.set(key, secret);
    this.revoked.delete(key);

    return {
      providerAccountId: account,
      providerDisplayName: "Fake " + account,
      authenticationStrategy: "oauth",
      capabilities: ["source.read", "source.write"]
    };
  }

  async verifyAuthorization(input) {
    const key = input.accountDomainId + ":" + input.providerAccountId;
    const active = this.secrets.has(key) && !this.revoked.has(key);
    return {
      status: active ? "active" : "reconnect_required",
      capabilities: active ? ["source.read", "source.write"] : [],
      verifiedAt: "2026-09-27T06:00:00.000Z"
    };
  }

  async revokeAuthorization(input) {
    const key = input.accountDomainId + ":" + input.providerAccountId;
    this.revoked.add(key);
    this.secrets.delete(key);
  }
}

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "asc-auth-broker-"));
  const path = join(directory, "registry.json");
  const store = new JsonFileControlRegistryStore(path);
  const provider = new FakeAuthorizationProvider();
  const connections = new PersistentConnectionRegistry(store);
  const projects = new PersistentProjectRegistry(store);
  const bindings = new PersistentProjectConnectionBindingRegistry(store);
  const delegations = new DelegationService(store);
  const flows = new InMemoryAuthorizationFlowStore();
  const broker = new ConnectionAuthorizationBroker({
    flowStore: flows,
    connections,
    providers: [provider]
  });

  await projects.resolveOrRegisterGithubProject({
    projectId: "cardforge",
    accountDomainId: "business-a",
    repository: "owner/cardforge"
  });

  return {
    directory,
    path,
    provider,
    connections,
    bindings,
    delegations,
    broker
  };
}

test("authorization callback creates metadata-only Connections for two provider accounts", async () => {
  const context = await setup();
  try {
    for (const [index, account] of ["account-a", "account-b"].entries()) {
      const begun = await context.broker.begin({
        ownerId: "owner-1",
        accountDomainId: "business-a",
        provider: "fake-oauth",
        callbackUrl: "https://asc.invalid/callback",
        now: "2026-09-27T05:00:0" + index + ".000Z"
      });

      await context.broker.complete({
        flowId: begun.flowId,
        state: begun.state,
        callback: {
          account,
          secret: "provider-secret-" + account
        },
        now: "2026-09-27T05:01:0" + index + ".000Z"
      });
    }

    const connections = await context.connections.listByProvider("business-a", "fake-oauth");
    assert.equal(connections.length, 2);
    assert.deepEqual(
      connections.map((connection) => connection.providerAccountId).sort(),
      ["account-a", "account-b"]
    );

    const raw = await readFile(context.path, "utf8");
    assert.equal(raw.includes("provider-secret-account-a"), false);
    assert.equal(raw.includes("provider-secret-account-b"), false);
    assert.equal(context.provider.secrets.size, 2);
  } finally {
    await rm(context.directory, { recursive: true, force: true });
  }
});

test("authorization state is bound and single-use", async () => {
  const context = await setup();
  try {
    const begun = await context.broker.begin({
      ownerId: "owner-1",
      accountDomainId: "business-a",
      provider: "fake-oauth",
      callbackUrl: "https://asc.invalid/callback",
      now: "2026-09-27T05:00:00.000Z"
    });

    await assert.rejects(
      () => context.broker.complete({
        flowId: begun.flowId,
        state: "wrong-state",
        callback: { account: "account-a", secret: "secret-a" },
        now: "2026-09-27T05:00:10.000Z"
      }),
      /state does not match/i
    );

    const second = await context.broker.begin({
      ownerId: "owner-1",
      accountDomainId: "business-a",
      provider: "fake-oauth",
      callbackUrl: "https://asc.invalid/callback",
      now: "2026-09-27T05:02:00.000Z"
    });
    await context.broker.complete({
      flowId: second.flowId,
      state: second.state,
      callback: { account: "account-a", secret: "secret-a" },
      now: "2026-09-27T05:02:10.000Z"
    });
    await assert.rejects(
      () => context.broker.complete({
        flowId: second.flowId,
        state: second.state,
        callback: { account: "account-a", secret: "secret-a" },
        now: "2026-09-27T05:02:11.000Z"
      }),
      /already been consumed/i
    );
  } finally {
    await rm(context.directory, { recursive: true, force: true });
  }
});

test("reconnect changes Connection generation and invalidates older delegations", async () => {
  const context = await setup();
  try {
    const begun = await context.broker.begin({
      ownerId: "owner-1",
      accountDomainId: "business-a",
      provider: "fake-oauth",
      callbackUrl: "https://asc.invalid/callback",
      now: "2026-09-27T05:00:00.000Z"
    });
    const connection = await context.broker.complete({
      flowId: begun.flowId,
      state: begun.state,
      callback: { account: "account-a", secret: "secret-a" },
      now: "2026-09-27T05:00:10.000Z"
    });

    await context.bindings.register({
      projectId: "cardforge",
      connectionId: connection.connectionId,
      capabilityScope: { kind: "exact", value: "source.read" }
    });

    const delegation = await context.delegations.issue({
      projectId: "cardforge",
      capabilityId: "source.read",
      effectClass: "read",
      audience: "development-intelligence",
      issuedAt: "2026-09-27T05:01:00.000Z",
      expiresInSeconds: 300
    });

    const reauth = await context.broker.begin({
      ownerId: "owner-1",
      accountDomainId: "business-a",
      provider: "fake-oauth",
      callbackUrl: "https://asc.invalid/callback",
      now: "2026-09-27T05:02:00.000Z"
    });
    const reconnected = await context.broker.complete({
      flowId: reauth.flowId,
      state: reauth.state,
      callback: { account: "account-a", secret: "new-secret-a" },
      now: "2026-09-27T05:02:10.000Z"
    });
    assert.equal(reconnected.generation, connection.generation + 1);

    await assert.rejects(
      () => context.delegations.consume(delegation.handle, {
        audience: "development-intelligence",
        projectId: "cardforge",
        capabilityId: "source.read",
        effectClass: "read",
        now: "2026-09-27T05:02:20.000Z"
      }),
      /older Connection generation/i
    );
  } finally {
    await rm(context.directory, { recursive: true, force: true });
  }
});

test("provider revoke removes provider secret and revokes ASC Connection", async () => {
  const context = await setup();
  try {
    const begun = await context.broker.begin({
      ownerId: "owner-1",
      accountDomainId: "business-a",
      provider: "fake-oauth",
      callbackUrl: "https://asc.invalid/callback",
      now: "2026-09-27T05:00:00.000Z"
    });
    const connection = await context.broker.complete({
      flowId: begun.flowId,
      state: begun.state,
      callback: { account: "account-a", secret: "secret-a" },
      now: "2026-09-27T05:00:10.000Z"
    });

    const revoked = await context.broker.revoke(
      connection.connectionId,
      "2026-09-27T05:03:00.000Z"
    );

    assert.equal(revoked.status, "revoked");
    assert.equal(context.provider.secrets.size, 0);
  } finally {
    await rm(context.directory, { recursive: true, force: true });
  }
});


test("routine verification preserves generation when authority is unchanged", async () => {
  const context = await setup();
  try {
    const begun = await context.broker.begin({
      ownerId: "owner-1",
      accountDomainId: "business-a",
      provider: "fake-oauth",
      callbackUrl: "https://asc.invalid/callback",
      now: "2026-09-27T05:00:00.000Z"
    });
    const connection = await context.broker.complete({
      flowId: begun.flowId,
      state: begun.state,
      callback: { account: "account-a", secret: "secret-a" },
      now: "2026-09-27T05:00:10.000Z"
    });

    const verified = await context.broker.verify(
      connection.connectionId,
      "2026-09-27T06:00:00.000Z"
    );

    assert.equal(verified.status, "active");
    assert.equal(verified.generation, connection.generation);
    assert.equal(verified.lastVerifiedAt, "2026-09-27T06:00:00.000Z");
  } finally {
    await rm(context.directory, { recursive: true, force: true });
  }
});
