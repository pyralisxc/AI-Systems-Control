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
  PersistentProjectMembershipRegistry,
  PersistentProjectRegistry
} from "../dist/application/index.js";
import {
  JsonFileControlRegistryStore,
  JsonFileIdentityDirectoryStore
} from "../dist/adapters/index.js";

async function setup() {
  const directory = await mkdtemp(
    join(tmpdir(), "asc-user-delegation-")
  );
  const identities =
    new PersistentIdentityRegistry(
      new JsonFileIdentityDirectoryStore(
        join(directory, "identity.json")
      )
    );
  await identities.registerAccountDomain({
    accountDomainId: "domain:org",
    kind: "organization",
    name: "Org"
  });
  for (const [id, roles] of [
    ["admin", ["admin"]],
    ["alice", ["operator"]],
    ["bob", ["operator"]]
  ]) {
    await identities.registerPrincipal({
      principalId: "principal:" + id,
      kind: "human",
      displayName: id
    });
    await identities.registerMembership({
      principalId: "principal:" + id,
      accountDomainId: "domain:org",
      roles
    });
  }

  const store =
    new JsonFileControlRegistryStore(
      join(directory, "control.json"),
      "domain:org"
    );
  const projects =
    new PersistentProjectRegistry(
      store,
      identities
    );
  await projects.resolveOrRegisterGithubProject({
    projectId: "project:a",
    accountDomainId: "domain:org",
    repository: "example/project-a"
  });
  await projects.resolveOrRegisterGithubProject({
    projectId: "project:b",
    accountDomainId: "domain:org",
    repository: "example/project-b"
  });

  const projectMemberships =
    new PersistentProjectMembershipRegistry(
      store,
      identities
    );
  const alice =
    await identities.getMembership(
      "principal:alice",
      "domain:org"
    );
  const bob =
    await identities.getMembership(
      "principal:bob",
      "domain:org"
    );
  await projectMemberships.grant({
    authorizedByPrincipalId:
      "principal:admin",
    membershipId: alice.membershipId,
    projectId: "project:a",
    roles: ["operator"]
  });
  await projectMemberships.grant({
    authorizedByPrincipalId:
      "principal:admin",
    membershipId: bob.membershipId,
    projectId: "project:b",
    roles: ["viewer"]
  });

  const connections =
    new PersistentConnectionRegistry(
      store,
      identities
    );
  const connection =
    await connections.register({
      authorizedByPrincipalId:
        "principal:admin",
      accountDomainId: "domain:org",
      provider: "github",
      providerAccountId:
        "installation:1",
      authenticationStrategy:
        "app_installation",
      capabilities: [
        "source.read",
        "pull_request.write"
      ]
    });
  const bindings =
    new PersistentProjectConnectionBindingRegistry(
      store
    );
  await bindings.register({
    projectId: "project:a",
    connectionId:
      connection.connectionId,
    capabilityScope: {
      kind: "exact",
      value: "source.read"
    }
  });
  await bindings.register({
    projectId: "project:a",
    connectionId:
      connection.connectionId,
    capabilityScope: {
      kind: "exact",
      value: "pull_request.write"
    },
    approvalRequiredFor: ["mutate"]
  });

  return {
    directory,
    identities,
    projectMemberships,
    delegations:
      new DelegationService(
        store,
        identities
      ),
    alice,
    bob
  };
}

test("delegation records exact Principal, Membership and ProjectMembership provenance", async () => {
  const context = await setup();
  try {
    const issued =
      await context.delegations.issue({
        principalId: "principal:alice",
        projectId: "project:a",
        capabilityId: "source.read",
        effectClass: "read",
        audience:
          "development-intelligence"
      });

    assert.equal(
      issued.principalId,
      "principal:alice"
    );
    assert.equal(
      issued.membershipId,
      context.alice.membershipId
    );
    assert.equal(
      issued.membershipGeneration,
      context.alice.generation
    );

    const receipt =
      await context.delegations.consume(
        issued.handle,
        {
          audience:
            "development-intelligence",
          projectId: "project:a",
          capabilityId: "source.read",
          effectClass: "read"
        }
      );
    assert.equal(
      receipt.principalId,
      "principal:alice"
    );
    assert.equal(
      receipt.projectMembershipId,
      issued.projectMembershipId
    );
  } finally {
    await rm(
      context.directory,
      { recursive: true, force: true }
    );
  }
});

test("guessed Project ID cannot produce authority for another Project member", async () => {
  const context = await setup();
  try {
    await assert.rejects(
      () =>
        context.delegations.issue({
          principalId: "principal:bob",
          projectId: "project:a",
          capabilityId: "source.read",
          effectClass: "read",
          audience:
            "development-intelligence"
        }),
      /lacks active ProjectMembership/i
    );
  } finally {
    await rm(
      context.directory,
      { recursive: true, force: true }
    );
  }
});

test("revoking ProjectMembership invalidates an already-issued delegation", async () => {
  const context = await setup();
  try {
    const issued =
      await context.delegations.issue({
        principalId: "principal:alice",
        projectId: "project:a",
        capabilityId: "source.read",
        effectClass: "read",
        audience:
          "development-intelligence"
      });
    await context.projectMemberships
      .setStatus({
        authorizedByPrincipalId:
          "principal:admin",
        projectMembershipId:
          issued.projectMembershipId,
        status: "revoked"
      });

    await assert.rejects(
      () =>
        context.delegations.consume(
          issued.handle,
          {
            audience:
              "development-intelligence",
            projectId: "project:a",
            capabilityId:
              "source.read",
            effectClass: "read"
          }
        ),
      /ProjectMembership authority is stale|inactive/i
    );
  } finally {
    await rm(
      context.directory,
      { recursive: true, force: true }
    );
  }
});

test("suspending AccountDomain Membership invalidates an already-issued delegation", async () => {
  const context = await setup();
  try {
    const issued =
      await context.delegations.issue({
        principalId: "principal:alice",
        projectId: "project:a",
        capabilityId: "source.read",
        effectClass: "read",
        audience:
          "development-intelligence"
      });

    await context.identities
      .updateMembershipAuthority({
        membershipId:
          context.alice.membershipId,
        reviewedByPrincipalId:
          "principal:admin",
        status: "suspended"
      });

    await assert.rejects(
      () =>
        context.delegations.consume(
          issued.handle,
          {
            audience:
              "development-intelligence",
            projectId: "project:a",
            capabilityId:
              "source.read",
            effectClass: "read"
          }
        ),
      /inactive|stale|Membership/i
    );
  } finally {
    await rm(
      context.directory,
      { recursive: true, force: true }
    );
  }
});
