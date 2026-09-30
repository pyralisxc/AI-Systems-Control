import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  PersistentIdentityRegistry,
  PersistentProjectMembershipRegistry,
  PersistentProjectRegistry,
  ProjectDiscoveryAuthorizationError,
  ProjectDiscoveryService
} from "../dist/application/index.js";
import {
  JsonFileControlRegistryStore,
  JsonFileIdentityDirectoryStore
} from "../dist/adapters/index.js";

async function setup() {
  const directory = await mkdtemp(
    join(tmpdir(), "asc-project-discovery-")
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

  for (const id of ["admin", "alice", "bob"]) {
    await identities.registerPrincipal({
      principalId: "principal:" + id,
      kind: "human",
      displayName: id
    });
    await identities.registerMembership({
      principalId: "principal:" + id,
      accountDomainId: "domain:org",
      roles: id === "admin"
        ? ["admin"]
        : ["viewer"]
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
    name: "Project A",
    repository: "example/project-a"
  });
  await projects.resolveOrRegisterGithubProject({
    projectId: "project:b",
    accountDomainId: "domain:org",
    name: "Project B",
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

  return {
    directory,
    projectMemberships,
    service: new ProjectDiscoveryService({
      projects,
      projectMemberships
    })
  };
}

test("signed-in users receive only their ProjectMembership-filtered Projects", async () => {
  const context = await setup();
  try {
    assert.deepEqual(
      await context.service.list(
        "principal:alice"
      ),
      {
        projects: [{
          projectId: "project:a",
          name: "Project A",
          status: "active",
          roles: ["operator"],
          canonicalReference: {
            kind: "github_repository",
            value: "example/project-a",
            canonical: true
          }
        }]
      }
    );
    assert.deepEqual(
      (
        await context.service.list(
          "principal:bob"
        )
      ).projects.map(
        (project) => project.projectId
      ),
      ["project:b"]
    );
  } finally {
    await rm(
      context.directory,
      { recursive: true, force: true }
    );
  }
});

test("guessing another member's Project ID returns only generic unavailable", async () => {
  const context = await setup();
  try {
    await assert.rejects(
      () =>
        context.service.get(
          "principal:bob",
          "project:a"
        ),
      (error) =>
        error instanceof
          ProjectDiscoveryAuthorizationError &&
        error.message ===
          "Project is unavailable."
    );
  } finally {
    await rm(
      context.directory,
      { recursive: true, force: true }
    );
  }
});

test("ProjectMembership revocation removes Project discovery immediately", async () => {
  const context = await setup();
  try {
    const records =
      await context.projectMemberships
        .listProjectMemberships();
    const alice = records.find(
      (membership) =>
        membership.projectId ===
          "project:a"
    );
    await context.projectMemberships.setStatus({
      authorizedByPrincipalId:
        "principal:admin",
      projectMembershipId:
        alice.projectMembershipId,
      status: "revoked"
    });

    assert.deepEqual(
      await context.service.list(
        "principal:alice"
      ),
      { projects: [] }
    );
    await assert.rejects(
      () =>
        context.service.get(
          "principal:alice",
          "project:a"
        ),
      /Project is unavailable/i
    );
  } finally {
    await rm(
      context.directory,
      { recursive: true, force: true }
    );
  }
});
