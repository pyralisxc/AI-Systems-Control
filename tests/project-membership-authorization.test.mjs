import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  PersistentIdentityRegistry,
  PersistentProjectMembershipRegistry,
  PersistentProjectRegistry
} from "../dist/application/index.js";
import {
  JsonFileControlRegistryStore,
  JsonFileIdentityDirectoryStore
} from "../dist/adapters/index.js";

async function setup() {
  const directory = await mkdtemp(
    join(tmpdir(), "asc-project-membership-")
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
  const alice = await identities.getMembership(
    "principal:alice",
    "domain:org"
  );
  const bob = await identities.getMembership(
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

  return {
    directory,
    identities,
    store,
    projectMemberships,
    alice,
    bob
  };
}

test("Alice and Bob in one AccountDomain receive different explicit Project visibility", async () => {
  const context = await setup();
  try {
    assert.deepEqual(
      (
        await context.projectMemberships
          .listAccessibleProjects(
            "principal:alice"
          )
      ).map((project) => project.projectId),
      ["project:a"]
    );
    assert.deepEqual(
      (
        await context.projectMemberships
          .listAccessibleProjects(
            "principal:bob"
          )
      ).map((project) => project.projectId),
      ["project:b"]
    );

    const alice =
      await context.projectMemberships
        .assertProjectAccess(
          "principal:alice",
          "project:a",
          "read"
        );
    assert.equal(
      alice.membershipId,
      context.alice.membershipId
    );

    await assert.rejects(
      () =>
        context.projectMemberships
          .assertProjectAccess(
            "principal:alice",
            "project:b",
            "read"
          ),
      /lacks active ProjectMembership/i
    );
  } finally {
    await rm(
      context.directory,
      { recursive: true, force: true }
    );
  }
});

test("viewer can read but cannot mutate; operator can mutate", async () => {
  const context = await setup();
  try {
    await context.projectMemberships
      .assertProjectAccess(
        "principal:bob",
        "project:b",
        "read"
      );
    await assert.rejects(
      () =>
        context.projectMemberships
          .assertProjectAccess(
            "principal:bob",
            "project:b",
            "mutate"
          ),
      /lacks active ProjectMembership/i
    );

    const operator =
      await context.projectMemberships
        .assertProjectAccess(
          "principal:alice",
          "project:a",
          "mutate"
        );
    assert.equal(
      operator.projectId,
      "project:a"
    );
  } finally {
    await rm(
      context.directory,
      { recursive: true, force: true }
    );
  }
});

test("ProjectMembership revocation increments generation and fails closed", async () => {
  const context = await setup();
  try {
    const before =
      await context.projectMemberships
        .assertProjectAccess(
          "principal:alice",
          "project:a",
          "read"
        );
    const records =
      await context.projectMemberships
        .listProjectMemberships();
    const aliceGrant = records.find(
      (record) =>
        record.membershipId ===
        context.alice.membershipId
    );
    assert.equal(aliceGrant.generation, 1);

    const revoked =
      await context.projectMemberships
        .setStatus({
          authorizedByPrincipalId:
            "principal:admin",
          projectMembershipId:
            aliceGrant.projectMembershipId,
          status: "revoked"
        });
    assert.equal(revoked.generation, 2);
    assert.equal(
      before.projectMembershipGeneration,
      1
    );

    await assert.rejects(
      () =>
        context.projectMemberships
          .assertProjectAccess(
            "principal:alice",
            "project:a",
            "read"
          ),
      /lacks active ProjectMembership/i
    );
  } finally {
    await rm(
      context.directory,
      { recursive: true, force: true }
    );
  }
});

test("AccountDomain Membership revocation invalidates outstanding Project authority generations", async () => {
  const context = await setup();
  try {
    const authority =
      await context.projectMemberships
        .assertProjectAccess(
          "principal:alice",
          "project:a",
          "read"
        );
    const updated =
      await context.identities
        .updateMembershipAuthority({
          membershipId:
            context.alice.membershipId,
          reviewedByPrincipalId:
            "principal:admin",
          status: "suspended"
        });
    assert.equal(
      updated.generation,
      authority.membershipGeneration + 1
    );
    await assert.rejects(
      () =>
        context.projectMemberships
          .assertProjectAccess(
            "principal:alice",
            "project:a",
            "read"
          ),
      /no active Membership|not active/i
    );
  } finally {
    await rm(
      context.directory,
      { recursive: true, force: true }
    );
  }
});

test("cross-domain ProjectMembership grants fail before persistence", async () => {
  const context = await setup();
  try {
    await context.identities.registerAccountDomain({
      accountDomainId: "domain:other",
      kind: "organization",
      name: "Other"
    });
    await context.identities.registerPrincipal({
      principalId: "principal:other",
      kind: "human",
      displayName: "Other"
    });
    const other =
      await context.identities.registerMembership({
        principalId: "principal:other",
        accountDomainId: "domain:other",
        roles: ["viewer"]
      });

    await assert.rejects(
      () =>
        context.projectMemberships.grant({
          authorizedByPrincipalId:
            "principal:admin",
          membershipId: other.membershipId,
          projectId: "project:a",
          roles: ["viewer"]
        }),
      /another AccountDomain/i
    );
  } finally {
    await rm(
      context.directory,
      { recursive: true, force: true }
    );
  }
});
