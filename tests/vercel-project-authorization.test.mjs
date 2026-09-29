import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  DelegationService,
  PersistentConnectionRegistry,
  PersistentIdentityRegistry,
  PersistentProjectConnectionBindingRegistry,
  PersistentProjectRegistry,
  VercelProjectAuthorizationService
} from "../dist/application/index.js";
import {
  JsonFileControlRegistryStore,
  JsonFileIdentityDirectoryStore
} from "../dist/adapters/index.js";

async function setup() {
  const directory = await mkdtemp(
    join(tmpdir(), "asc-vercel-project-")
  );
  const store = new JsonFileControlRegistryStore(
    join(directory, "registry.json"),
    "domain:personal"
  );
  const identities =
    new PersistentIdentityRegistry(
      new JsonFileIdentityDirectoryStore(
        join(directory, "identity.json")
      )
    );
  await identities.bootstrapPersonal({
    principalId: "principal:owner",
    principalDisplayName: "Owner",
    accountDomainId: "domain:personal",
    accountDomainName: "Personal"
  });

  const projects =
    new PersistentProjectRegistry(
      store,
      identities
    );
  const connections =
    new PersistentConnectionRegistry(
      store,
      identities
    );
  const bindings =
    new PersistentProjectConnectionBindingRegistry(
      store
    );
  const delegations =
    new DelegationService(store);

  await projects.resolveOrRegisterGithubProject({
    projectId: "asc",
    accountDomainId: "domain:personal",
    repository:
      "pyralisxc/AI-Systems-Control",
    name: "AI Systems Control"
  });

  let connected = true;
  const seen = [];
  const attestor = {
    async listConnections() {
      return connected
        ? [{
            connectionReference: "icfg_A",
            accountReference: "team_A",
            accountDisplayName: "team_A",
            accountType: "Team",
            connectedAt:
              "2026-09-29T01:00:00.000Z",
            observedAt:
              "2026-09-29T03:00:00.000Z"
          }]
        : [];
    },
    async attestRepository(input) {
      seen.push(input);
      return Object.freeze({
        connectionReference: "icfg_A",
        repository:
          "pyralisxc/ai-systems-control",
        accountReference: "team_A",
        accountDisplayName: "team_A",
        accountType: "Team",
        capabilities: Object.freeze([
          "deployment.audit.read",
          "deployment.read",
          "deployment.write"
        ]),
        verifiedAt:
          "2026-09-29T03:10:00.000Z",
        resource: Object.freeze({
          kind: "vercel_project",
          value: "prj_asc"
        }),
        resourceDisplayName:
          "ai-systems-control"
      });
    }
  };

  const service =
    new VercelProjectAuthorizationService({
      projects,
      connections,
      bindings,
      delegations,
      attestor
    });

  return {
    directory,
    connections,
    bindings,
    delegations,
    service,
    seen,
    disconnect() {
      connected = false;
    }
  };
}

test("Vercel safe discovery registers delegated Connections without provider credentials", async () => {
  const context = await setup();
  try {
    const connections =
      await context.service.syncConnections(
        "principal:owner"
      );

    assert.equal(connections.length, 1);
    assert.equal(
      connections[0]?.provider,
      "vercel"
    );
    assert.equal(
      connections[0]?.providerAccountId,
      "installation:icfg_A"
    );
    assert.equal(
      connections[0]?.authenticationStrategy,
      "delegated_service"
    );
    assert.deepEqual(
      connections[0]?.capabilities,
      []
    );
  } finally {
    await rm(
      context.directory,
      { recursive: true, force: true }
    );
  }
});

test("Vercel Project binding attests exact repository and Vercel project before granting reads or approved write lane", async () => {
  const context = await setup();
  try {
    const [connection] =
      await context.service.syncConnections(
        "principal:owner"
      );

    const result =
      await context.service.bindProject({
        principalId: "principal:owner",
        projectId: "asc",
        connectionId:
          connection.connectionId,
        executionCapability:
          "deployment.write"
      });

    assert.equal(
      context.seen[0]?.connectionReference,
      "icfg_A"
    );
    assert.equal(
      context.seen[0]?.repository,
      "pyralisxc/ai-systems-control"
    );
    assert.deepEqual(
      result.bindings.map(
        (binding) =>
          binding.capabilityScope.value
      ).sort(),
      [
        "deployment.audit.read",
        "deployment.read",
        "deployment.write"
      ]
    );

    const write = result.bindings.find(
      (binding) =>
        binding.capabilityScope.value ===
        "deployment.write"
    );
    assert.deepEqual(
      write?.approvalRequiredFor,
      ["mutate"]
    );
    assert.deepEqual(
      write?.resource,
      {
        kind: "vercel_project",
        value: "prj_asc"
      }
    );

    const refreshed =
      await context.connections.get(
        connection.connectionId
      );
    assert.deepEqual(
      refreshed?.capabilities,
      [
        "deployment.audit.read",
        "deployment.read",
        "deployment.write"
      ]
    );
  } finally {
    await rm(
      context.directory,
      { recursive: true, force: true }
    );
  }
});

test("Vercel delegated mutation requires approval and is invalidated when connection disappears", async () => {
  const context = await setup();
  try {
    const [connection] =
      await context.service.syncConnections(
        "principal:owner"
      );
    await context.service.bindProject({
      principalId: "principal:owner",
      projectId: "asc",
      connectionId:
        connection.connectionId,
      executionCapability:
        "deployment.write"
    });

    await assert.rejects(
      () =>
        context.service.issueConductorDelegation({
          principalId: "principal:owner",
          projectId: "asc",
          capabilityId:
            "deployment.write",
          effectClass: "read"
        }),
      /requires effect class mutate/i
    );

    await assert.rejects(
      () =>
        context.service.issueConductorDelegation({
          principalId: "principal:owner",
          projectId: "asc",
          capabilityId:
            "deployment.write",
          effectClass: "mutate"
        }),
      /approval reference/i
    );

    const issued =
      await context.service.issueConductorDelegation({
        principalId: "principal:owner",
        projectId: "asc",
        capabilityId:
          "deployment.write",
        effectClass: "mutate",
        approvalReference:
          "owner-verified:vercel"
      });

    assert.match(issued.handle, /^ascd_/u);

    context.disconnect();
    await context.service.syncConnections(
      "principal:owner"
    );
    const unavailable =
      await context.connections.get(
        connection.connectionId
      );
    assert.equal(
      unavailable?.status,
      "reconnect_required"
    );

    await assert.rejects(
      () =>
        context.delegations.consume(
          issued.handle,
          {
            audience: "conductor",
            projectId: "asc",
            capabilityId:
              "deployment.write",
            effectClass: "mutate"
          }
        ),
      /unavailable|revoked|older Connection generation/i
    );
  } finally {
    await rm(
      context.directory,
      { recursive: true, force: true }
    );
  }
});
