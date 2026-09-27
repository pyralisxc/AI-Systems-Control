import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  InMemoryConnectionRegistry,
  PersistentConnectionRegistry,
  PersistentProjectRegistry
} from "../dist/application/index.js";
import { JsonFileControlRegistryStore } from "../dist/adapters/index.js";

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "asc-registry-"));
  const path = join(directory, "control-registry.json");
  return {
    directory,
    path,
    store: new JsonFileControlRegistryStore(path, "business-a")
  };
}

test("durable Project aliases survive registry restart and resolve canonical repositories", async () => {
  const { directory, path, store } = await fixture();
  try {
    const projects = new PersistentProjectRegistry(store);
    await projects.resolveOrRegisterGithubProject({
      projectId: "asc",
      repository: "pyralisxc/AI-Systems-Control",
      name: "AI Systems Control",
      aliases: ["ASC"]
    });
    await projects.resolveOrRegisterGithubProject({
      projectId: "devos",
      repository: "pyralisxc/Development-OS",
      name: "Development OS",
      aliases: ["DevOS"]
    });
    await projects.resolveOrRegisterGithubProject({
      projectId: "construction",
      repository: "pyralisxc/Contruction",
      name: "Construction",
      aliases: ["Construction"]
    });

    const restarted = new PersistentProjectRegistry(
      new JsonFileControlRegistryStore(path, "business-a")
    );
    assert.equal((await restarted.getByAlias("asc"))?.projectId, "asc");
    assert.equal((await restarted.getByAlias("DEVOS"))?.projectId, "devos");
    assert.equal((await restarted.getByAlias(" Construction "))?.projectId, "construction");
    assert.equal(
      (await restarted.getByGithubRepository("pyralisxc/AI-Systems-Control"))?.projectId,
      "asc"
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("repository rename preserves Project identity and historical reference across restart", async () => {
  const { directory, path, store } = await fixture();
  try {
    const projects = new PersistentProjectRegistry(store);
    await projects.resolveOrRegisterGithubProject({
      projectId: "project-1",
      repository: "owner/old-name",
      aliases: ["Example"]
    });
    await projects.reconcileGithubRepository("project-1", "owner/new-name");

    const restarted = new PersistentProjectRegistry(
      new JsonFileControlRegistryStore(path, "business-a")
    );

    assert.equal(
      (await restarted.getByGithubRepository("owner/old-name"))?.projectId,
      "project-1"
    );
    assert.equal(
      (await restarted.getByGithubRepository("owner/new-name"))?.projectId,
      "project-1"
    );
    assert.equal((await restarted.getByAlias("example"))?.projectId, "project-1");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("concurrent Project mutations retry optimistic revision conflicts without losing records", async () => {
  const { directory, path } = await fixture();
  try {
    const first = new PersistentProjectRegistry(
      new JsonFileControlRegistryStore(path, "business-a")
    );
    const second = new PersistentProjectRegistry(
      new JsonFileControlRegistryStore(path, "business-a")
    );

    await Promise.all([
      first.resolveOrRegisterGithubProject({
        projectId: "one",
        repository: "owner/one",
        aliases: ["One"]
      }),
      second.resolveOrRegisterGithubProject({
        projectId: "two",
        repository: "owner/two",
        aliases: ["Two"]
      })
    ]);

    const restarted = new PersistentProjectRegistry(
      new JsonFileControlRegistryStore(path, "business-a")
    );
    assert.equal((await restarted.listProjects()).length, 2);
    assert.equal((await restarted.getByAlias("one"))?.projectId, "one");
    assert.equal((await restarted.getByAlias("two"))?.projectId, "two");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Connection registry supports multiple provider accounts and explicit environment modes", async () => {
  const { directory, path, store } = await fixture();
  try {
    const connections = new PersistentConnectionRegistry(store);

    const prod = await connections.register({
      ownerId: "owner-1",
      accountDomainId: "business-a",
      provider: "example-billing",
      providerAccountId: "acct_main",
      providerDisplayName: "Business Billing",
      environment: "live",
      authenticationStrategy: "oauth",
      capabilities: ["billing.read", "billing.write"]
    });
    const testConnection = await connections.register({
      ownerId: "owner-1",
      accountDomainId: "business-a",
      provider: "example-billing",
      providerAccountId: "acct_main",
      providerDisplayName: "Business Billing",
      environment: "test",
      authenticationStrategy: "oauth",
      capabilities: ["billing.read"]
    });
    const teamOne = await connections.register({
      ownerId: "owner-1",
      accountDomainId: "business-a",
      provider: "deployment-provider",
      providerAccountId: "team_1",
      providerDisplayName: "Primary Team",
      authenticationStrategy: "oauth"
    });
    const teamTwo = await connections.register({
      ownerId: "owner-1",
      accountDomainId: "business-a",
      provider: "deployment-provider",
      providerAccountId: "team_2",
      providerDisplayName: "Secondary Team",
      authenticationStrategy: "oauth"
    });

    assert.notEqual(prod.connectionId, testConnection.connectionId);
    assert.notEqual(teamOne.connectionId, teamTwo.connectionId);
    assert.equal(prod.generation, 1);

    const restarted = new PersistentConnectionRegistry(
      new JsonFileControlRegistryStore(path, "business-a")
    );
    assert.equal((await restarted.listByProvider("business-a", "example-billing")).length, 2);
    assert.equal((await restarted.listByProvider("business-a", "deployment-provider")).length, 2);

    const revoked = await restarted.setStatus(teamOne.connectionId, "revoked");
    assert.equal(revoked.status, "revoked");
    assert.equal(revoked.generation, 2);
    assert.equal((await restarted.get(teamTwo.connectionId))?.status, "active");

    const reconnected = await restarted.reconnect(teamOne.connectionId, {
      capabilities: ["deployment.read"],
      verifiedAt: "2026-09-27T04:00:00.000Z"
    });
    assert.equal(reconnected.status, "active");
    assert.equal(reconnected.generation, 3);
    assert.deepEqual(reconnected.capabilities, ["deployment.read"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Connection metadata serializer rejects secret-bearing fields", async () => {
  const { directory, path, store } = await fixture();
  try {
    const valid = new InMemoryConnectionRegistry().register({
      ownerId: "owner-1",
      accountDomainId: "business-a",
      provider: "example",
      providerAccountId: "account-1",
      authenticationStrategy: "api_credential"
    });

    await assert.rejects(
      () => store.save({
        expectedRevision: 0,
        projects: [],
        connections: [{ ...valid, accessToken: "never-persist-me" }],
        projectConnectionBindings: [],
        delegations: []
      }),
      /Secret-like field/
    );

    await store.save({
      expectedRevision: 0,
      projects: [],
      connections: [valid],
      projectConnectionBindings: [],
      delegations: []
    });

    const raw = await readFile(path, "utf8");
    assert.doesNotMatch(raw, /never-persist-me|accessToken|password|refreshToken/iu);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
