import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  DelegationAudienceBridge,
  DelegationValidationError,
  PersistentConnectionRegistry,
  PersistentIdentityRegistry,
  PersistentProjectConnectionBindingRegistry,
  PersistentProjectMembershipRegistry,
  PersistentProjectRegistry,
  DelegationService,
  serviceBearerMatches
} from "../dist/application/index.js";
import {
  JsonFileControlRegistryStore,
  JsonFileIdentityDirectoryStore
} from "../dist/adapters/index.js";

async function setup() {
  const directory = await mkdtemp(
    join(tmpdir(), "asc-delegation-audience-")
  );
  const store = new JsonFileControlRegistryStore(
    join(directory, "control.json"),
    "domain:personal"
  );
  const identities = new PersistentIdentityRegistry(
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
    new PersistentProjectRegistry(store, identities);
  const connections =
    new PersistentConnectionRegistry(store, identities);
  const bindings =
    new PersistentProjectConnectionBindingRegistry(store);
  const projectMemberships = new PersistentProjectMembershipRegistry(store, identities);
  const delegations = new DelegationService(store, identities);

  await projects.resolveOrRegisterGithubProject({
    projectId: "asc",
    accountDomainId: "domain:personal",
    repository: "pyralisxc/AI-Systems-Control"
  });
  await projectMemberships.ensurePersonalOwnerProjects("principal:owner");
  const connection = await connections.register({
    authorizedByPrincipalId: "principal:owner",
    accountDomainId: "domain:personal",
    provider: "github",
    providerAccountId: "installation:456",
    authenticationStrategy: "app_installation",
    capabilities: ["pull_request.write"]
  });
  await bindings.register({
    projectId: "asc",
    connectionId: connection.connectionId,
    capabilityScope: {
      kind: "exact",
      value: "pull_request.write"
    },
    resource: {
      kind: "github_repository",
      value: "pyralisxc/ai-systems-control"
    },
    approvalRequiredFor: ["mutate"]
  });

  return {
    directory,
    connections,
    delegations,
    conductor: new DelegationAudienceBridge(
      delegations,
      "conductor"
    )
  };
}

test("service bearer comparison fails closed and accepts only the exact configured secret", () => {
  const secret = "s".repeat(40);
  assert.equal(
    serviceBearerMatches(
      "Bearer " + secret,
      secret
    ),
    true
  );
  assert.equal(
    serviceBearerMatches(
      "Bearer " + "x".repeat(40),
      secret
    ),
    false
  );
  assert.equal(
    serviceBearerMatches(null, secret),
    false
  );
  assert.equal(
    serviceBearerMatches(
      "Bearer " + secret,
      "short"
    ),
    false
  );
});

test("audience bridge consumes one exact delegation and cannot widen or replay it", async () => {
  const context = await setup();
  try {
    const issued = await context.delegations.issue({
      principalId: "principal:owner",
      projectId: "asc",
      capabilityId: "pull_request.write",
      effectClass: "mutate",
      audience: "conductor",
      approvalReference: "owner-verified:61",
      expiresInSeconds: 300
    });

    assert.equal(
      issued.accountDomainId,
      "domain:personal"
    );

    await assert.rejects(
      () =>
        context.conductor.consume({
          handle: issued.handle,
          projectId: "asc",
          capabilityId: "source.read",
          effectClass: "read"
        }),
      /capability does not match/i
    );

    const receipt =
      await context.conductor.consume({
        handle: issued.handle,
        projectId: "asc",
        capabilityId: "pull_request.write",
        effectClass: "mutate"
      });

    assert.equal(
      receipt.accountDomainId,
      "domain:personal"
    );
    assert.equal(receipt.audience, "conductor");
    assert.equal(
      receipt.approvalReference,
      "owner-verified:61"
    );
    assert.equal(
      receipt.resource?.value,
      "pyralisxc/ai-systems-control"
    );

    await assert.rejects(
      () =>
        context.conductor.consume({
          handle: issued.handle,
          projectId: "asc",
          capabilityId: "pull_request.write",
          effectClass: "mutate"
        }),
      DelegationValidationError
    );
  } finally {
    await rm(
      context.directory,
      { recursive: true, force: true }
    );
  }
});

test("audience bridge rejects a delegation invalidated by Connection generation", async () => {
  const context = await setup();
  try {
    const issued = await context.delegations.issue({
      principalId: "principal:owner",
      projectId: "asc",
      capabilityId: "pull_request.write",
      effectClass: "mutate",
      audience: "conductor",
      approvalReference: "owner-verified:61",
      expiresInSeconds: 300
    });

    await context.connections.reconnect(
      issued.connectionId,
      {
        verifiedAt:
          "2026-09-29T01:00:10.000Z"
      }
    );

    await assert.rejects(
      () =>
        context.conductor.consume({
          handle: issued.handle,
          projectId: "asc",
          capabilityId: "pull_request.write",
          effectClass: "mutate"
        }),
      /older Connection generation/i
    );
  } finally {
    await rm(
      context.directory,
      { recursive: true, force: true }
    );
  }
});
