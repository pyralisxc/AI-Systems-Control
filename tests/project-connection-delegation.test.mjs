import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  DelegationService,
  DelegationValidationError,
  PersistentConnectionRegistry,
  PersistentIdentityRegistry,
  PersistentProjectConnectionBindingRegistry,
  PersistentProjectRegistry
} from "../dist/application/index.js";
import {
  JsonFileControlRegistryStore,
  JsonFileIdentityDirectoryStore
} from "../dist/adapters/index.js";

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "asc-binding-"));
  const path = join(directory, "registry.json");
  const store = new JsonFileControlRegistryStore(path, "business-a");
  const identities = new PersistentIdentityRegistry(
    new JsonFileIdentityDirectoryStore(join(directory, "identity.json"))
  );
  await identities.bootstrapPersonal({
    principalId: "principal:owner-1",
    principalDisplayName: "Owner One",
    accountDomainId: "business-a",
    accountDomainName: "Business A"
  });
  const projects = new PersistentProjectRegistry(store, identities);
  const connections = new PersistentConnectionRegistry(store, identities);
  const bindings = new PersistentProjectConnectionBindingRegistry(store);
  const delegations = new DelegationService(store);

  await projects.resolveOrRegisterGithubProject({
    projectId: "cardforge",
    accountDomainId: "business-a",
    repository: "owner/cardforge",
    aliases: ["CardForge"]
  });

  return { directory, path, connections, bindings, delegations };
}

test("Project/environment/capability resolves one Connection without implicit fallback", async () => {
  const context = await setup();
  try {
    const prod = await context.connections.register({
      authorizedByPrincipalId: "owner-1",
      accountDomainId: "business-a",
      provider: "example-billing",
      providerAccountId: "prod-account",
      environment: "production",
      authenticationStrategy: "oauth",
      capabilities: ["billing.read", "billing.write"]
    });
    const preview = await context.connections.register({
      authorizedByPrincipalId: "owner-1",
      accountDomainId: "business-a",
      provider: "example-billing",
      providerAccountId: "preview-account",
      environment: "preview",
      authenticationStrategy: "oauth",
      capabilities: ["billing.read"]
    });

    await context.bindings.register({
      projectId: "cardforge",
      connectionId: prod.connectionId,
      environment: "production",
      capabilityScope: { kind: "prefix", value: "billing." },
      selection: "explicit"
    });
    await context.bindings.register({
      projectId: "cardforge",
      connectionId: preview.connectionId,
      environment: "preview",
      capabilityScope: { kind: "prefix", value: "billing." },
      selection: "explicit"
    });

    const productionResolution = await context.bindings.resolve({
      projectId: "cardforge",
      capabilityId: "billing.read",
      environment: "production"
    });
    assert.equal(productionResolution.status, "available");
    assert.equal(productionResolution.connection?.connectionId, prod.connectionId);

    const previewResolution = await context.bindings.resolve({
      projectId: "cardforge",
      capabilityId: "billing.read",
      environment: "preview"
    });
    assert.equal(previewResolution.status, "available");
    assert.equal(previewResolution.connection?.connectionId, preview.connectionId);

    await context.connections.setStatus(prod.connectionId, "revoked");
    const blocked = await context.bindings.resolve({
      projectId: "cardforge",
      capabilityId: "billing.read",
      environment: "production"
    });
    assert.equal(blocked.status, "unavailable");
    assert.match(blocked.reason ?? "", /will not fall back implicitly/i);
  } finally {
    await rm(context.directory, { recursive: true, force: true });
  }
});

test("equally specific active bindings remain explicit ambiguity", async () => {
  const context = await setup();
  try {
    const first = await context.connections.register({
      authorizedByPrincipalId: "owner-1",
      accountDomainId: "business-a",
      provider: "deployment-provider",
      providerAccountId: "team-a",
      authenticationStrategy: "oauth",
      capabilities: ["deployment.read"]
    });
    const second = await context.connections.register({
      authorizedByPrincipalId: "owner-1",
      accountDomainId: "business-a",
      provider: "deployment-provider",
      providerAccountId: "team-b",
      authenticationStrategy: "oauth",
      capabilities: ["deployment.read"]
    });

    await context.bindings.register({
      projectId: "cardforge",
      connectionId: first.connectionId,
      capabilityScope: { kind: "exact", value: "deployment.read" }
    });
    await context.bindings.register({
      projectId: "cardforge",
      connectionId: second.connectionId,
      capabilityScope: { kind: "exact", value: "deployment.read" }
    });

    const resolution = await context.bindings.resolve({
      projectId: "cardforge",
      capabilityId: "deployment.read"
    });

    assert.equal(resolution.status, "ambiguous");
    assert.equal(resolution.candidateBindingIds.length, 2);
  } finally {
    await rm(context.directory, { recursive: true, force: true });
  }
});

test("opaque delegations are scoped, single-use, audience-bound, and approval-aware", async () => {
  const context = await setup();
  try {
    const connection = await context.connections.register({
      authorizedByPrincipalId: "owner-1",
      accountDomainId: "business-a",
      provider: "fake-provider",
      providerAccountId: "account-a",
      authenticationStrategy: "delegated_service",
      capabilities: ["billing.read", "billing.write"]
    });
    await context.bindings.register({
      projectId: "cardforge",
      connectionId: connection.connectionId,
      environment: "production",
      capabilityScope: { kind: "prefix", value: "billing." },
      approvalRequiredFor: ["mutate"]
    });

    const readDelegation = await context.delegations.issue({
      projectId: "cardforge",
      capabilityId: "billing.read",
      effectClass: "read",
      audience: "development-intelligence",
      environment: "production",
      issuedAt: "2026-09-27T04:00:00.000Z",
      expiresInSeconds: 300
    });
    assert.match(readDelegation.handle, /^ascd_/u);

    const raw = await readFile(context.path, "utf8");
    assert.equal(raw.includes(readDelegation.handle), false);

    const receipt = await context.delegations.consume(readDelegation.handle, {
      audience: "development-intelligence",
      projectId: "cardforge",
      capabilityId: "billing.read",
      effectClass: "read",
      environment: "production",
      now: "2026-09-27T04:00:30.000Z"
    });
    assert.equal(receipt.connectionId, connection.connectionId);
    assert.equal(receipt.capabilityId, "billing.read");
    assert.equal("handle" in receipt, false);

    await assert.rejects(
      () => context.delegations.consume(readDelegation.handle, {
        audience: "development-intelligence",
        projectId: "cardforge",
        capabilityId: "billing.read",
        effectClass: "read",
        environment: "production",
        now: "2026-09-27T04:00:31.000Z"
      }),
      /replay is not allowed/i
    );

    await assert.rejects(
      () => context.delegations.issue({
        projectId: "cardforge",
        capabilityId: "billing.write",
        effectClass: "mutate",
        audience: "conductor",
        environment: "production",
        issuedAt: "2026-09-27T04:01:00.000Z"
      }),
      /requires an approval reference/i
    );

    const writeDelegation = await context.delegations.issue({
      projectId: "cardforge",
      capabilityId: "billing.write",
      effectClass: "mutate",
      audience: "conductor",
      environment: "production",
      approvalReference: "owner-verified:issue-42",
      issuedAt: "2026-09-27T04:01:00.000Z",
      expiresInSeconds: 60
    });

    await assert.rejects(
      () => context.delegations.consume(writeDelegation.handle, {
        audience: "other-caller",
        projectId: "cardforge",
        capabilityId: "billing.write",
        effectClass: "mutate",
        environment: "production",
        now: "2026-09-27T04:01:10.000Z"
      }),
      DelegationValidationError
    );
    await assert.rejects(
      () => context.delegations.consume(writeDelegation.handle, {
        audience: "conductor",
        projectId: "other-project",
        capabilityId: "billing.write",
        effectClass: "mutate",
        environment: "production",
        now: "2026-09-27T04:01:10.000Z"
      }),
      /Project does not match/i
    );

    const writeReceipt = await context.delegations.consume(writeDelegation.handle, {
      audience: "conductor",
      projectId: "cardforge",
      capabilityId: "billing.write",
      effectClass: "mutate",
      environment: "production",
      now: "2026-09-27T04:01:10.000Z"
    });
    assert.equal(writeReceipt.approvalReference, "owner-verified:issue-42");
  } finally {
    await rm(context.directory, { recursive: true, force: true });
  }
});

test("expired and old-generation delegations fail closed", async () => {
  const context = await setup();
  try {
    const connection = await context.connections.register({
      authorizedByPrincipalId: "owner-1",
      accountDomainId: "business-a",
      provider: "source-provider",
      providerAccountId: "account-a",
      authenticationStrategy: "oauth",
      capabilities: ["source.read"]
    });
    await context.bindings.register({
      projectId: "cardforge",
      connectionId: connection.connectionId,
      capabilityScope: { kind: "exact", value: "source.read" }
    });

    const expired = await context.delegations.issue({
      projectId: "cardforge",
      capabilityId: "source.read",
      effectClass: "read",
      audience: "development-intelligence",
      issuedAt: "2026-09-27T04:00:00.000Z",
      expiresInSeconds: 1
    });
    await assert.rejects(
      () => context.delegations.consume(expired.handle, {
        audience: "development-intelligence",
        projectId: "cardforge",
        capabilityId: "source.read",
        effectClass: "read",
        now: "2026-09-27T04:00:02.000Z"
      }),
      /expired/i
    );

    const stale = await context.delegations.issue({
      projectId: "cardforge",
      capabilityId: "source.read",
      effectClass: "read",
      audience: "development-intelligence",
      issuedAt: "2026-09-27T04:01:00.000Z",
      expiresInSeconds: 60
    });

    await context.connections.reconnect(connection.connectionId, {
      verifiedAt: "2026-09-27T04:01:05.000Z"
    });

    await assert.rejects(
      () => context.delegations.consume(stale.handle, {
        audience: "development-intelligence",
        projectId: "cardforge",
        capabilityId: "source.read",
        effectClass: "read",
        now: "2026-09-27T04:01:10.000Z"
      }),
      /older Connection generation/i
    );
  } finally {
    await rm(context.directory, { recursive: true, force: true });
  }
});


test("cross-domain Connection creation fails before binding", async () => {
  const context = await setup();
  try {
    await assert.rejects(
      () => context.connections.register({
        authorizedByPrincipalId: "owner-1",
        accountDomainId: "personal",
        provider: "source-provider",
        providerAccountId: "personal-account",
        authenticationStrategy: "oauth",
        capabilities: ["source.read"]
      }),
      /does not match registry/i
    );
  } finally {
    await rm(context.directory, { recursive: true, force: true });
  }
});

test("delegation capability cannot be widened after issuance", async () => {
  const context = await setup();
  try {
    const connection = await context.connections.register({
      authorizedByPrincipalId: "owner-1",
      accountDomainId: "business-a",
      provider: "source-provider",
      providerAccountId: "account-a",
      authenticationStrategy: "oauth",
      capabilities: ["source.read", "source.history"]
    });
    await context.bindings.register({
      projectId: "cardforge",
      connectionId: connection.connectionId,
      capabilityScope: { kind: "prefix", value: "source." }
    });

    const issued = await context.delegations.issue({
      projectId: "cardforge",
      capabilityId: "source.read",
      effectClass: "read",
      audience: "development-intelligence",
      issuedAt: "2026-09-27T05:00:00.000Z",
      expiresInSeconds: 60
    });

    await assert.rejects(
      () => context.delegations.consume(issued.handle, {
        audience: "development-intelligence",
        projectId: "cardforge",
        capabilityId: "source.history",
        effectClass: "read",
        now: "2026-09-27T05:00:10.000Z"
      }),
      /capability does not match/i
    );
  } finally {
    await rm(context.directory, { recursive: true, force: true });
  }
});
