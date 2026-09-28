import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  DelegationService,
  GitHubProjectAuthorizationService,
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
  const directory = await mkdtemp(
    join(tmpdir(), "asc-github-project-")
  );
  const store = new JsonFileControlRegistryStore(
    join(directory, "registry.json"),
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
  const delegations = new DelegationService(store);

  await projects.resolveOrRegisterGithubProject({
    projectId: "asc",
    accountDomainId: "domain:personal",
    repository: "pyralisxc/AI-Systems-Control",
    name: "AI Systems Control"
  });

  const connection = await connections.register({
    authorizedByPrincipalId: "principal:owner",
    accountDomainId: "domain:personal",
    provider: "github",
    providerAccountId: "installation:456",
    providerDisplayName: "pyralisxc",
    authenticationStrategy: "app_installation",
    capabilities: [
      "source.read",
      "repository.read",
      "pull_request.write"
    ],
    verifiedAt: "2026-09-28T02:30:00.000Z"
  });

  const seen = [];
  const service = new GitHubProjectAuthorizationService({
    projects,
    connections,
    bindings,
    delegations,
    repositoryAttestor: {
      async attestRepository(input) {
        seen.push(input);
        return Object.freeze({
          installationId: "456",
          repository: "pyralisxc/AI-Systems-Control",
          accountId: "789",
          accountLogin: "pyralisxc",
          accountType: "User",
          capabilities: Object.freeze([
            "source.read",
            "repository.read",
            "pull_request.write"
          ]),
          verifiedAt: "2026-09-28T02:40:00.000Z"
        });
      }
    }
  });

  return {
    directory,
    service,
    projects,
    connections,
    bindings,
    delegations,
    connection,
    seen
  };
}

test("exact GitHub repository attestation creates DI read and approval-gated Conductor bindings", async () => {
  const context = await setup();
  try {
    const result = await context.service.bindProject({
      principalId: "principal:owner",
      projectId: "asc",
      connectionId: context.connection.connectionId,
      executionCapability: "pull_request.write"
    });

    assert.equal(
      context.seen[0]?.repository,
      "pyralisxc/AI-Systems-Control"
    );
    assert.equal(
      context.seen[0]?.installationId,
      "456"
    );
    assert.equal(result.bindings.length, 3);
    assert.deepEqual(
      result.bindings.map(
        (binding) => binding.capabilityScope.value
      ).sort(),
      [
        "pull_request.write",
        "repository.read",
        "source.read"
      ]
    );

    for (const binding of result.bindings) {
      assert.deepEqual(binding.resource, {
        kind: "github_repository",
        value: "pyralisxc/AI-Systems-Control"
      });
      if (
        binding.capabilityScope.value ===
        "pull_request.write"
      ) {
        assert.deepEqual(
          binding.approvalRequiredFor,
          ["mutate"]
        );
      } else {
        assert.deepEqual(
          binding.approvalRequiredFor,
          []
        );
      }
    }
  } finally {
    await rm(
      context.directory,
      { recursive: true, force: true }
    );
  }
});

test("specialist delegations are issued just in time from attested GitHub bindings", async () => {
  const context = await setup();
  try {
    await context.service.bindProject({
      principalId: "principal:owner",
      projectId: "asc",
      connectionId: context.connection.connectionId,
      executionCapability: "pull_request.write"
    });

    const reads =
      await context.service
        .issueDevelopmentIntelligenceDelegations({
          principalId: "principal:owner",
          projectId: "asc",
          issuedAt: "2026-09-28T03:00:00.000Z",
          expiresInSeconds: 300
        });

    const sourceReceipt =
      await context.delegations.consume(
        reads.sourceRead.handle,
        {
          audience: "development-intelligence",
          projectId: "asc",
          capabilityId: "source.read",
          effectClass: "read",
          now: "2026-09-28T03:00:10.000Z"
        }
      );
    assert.equal(
      sourceReceipt.resource?.value,
      "pyralisxc/AI-Systems-Control"
    );

    await assert.rejects(
      () =>
        context.service.issueConductorDelegation({
          principalId: "principal:owner",
          projectId: "asc",
          capabilityId: "pull_request.write",
          approvalReference: ""
        }),
      /approval reference/i
    );

    const execution =
      await context.service.issueConductorDelegation({
        principalId: "principal:owner",
        projectId: "asc",
        capabilityId: "pull_request.write",
        approvalReference: "owner-verified:asc-65",
        issuedAt: "2026-09-28T03:01:00.000Z",
        expiresInSeconds: 60
      });
    const executionReceipt =
      await context.delegations.consume(
        execution.handle,
        {
          audience: "conductor",
          projectId: "asc",
          capabilityId: "pull_request.write",
          effectClass: "mutate",
          now: "2026-09-28T03:01:10.000Z"
        }
      );
    assert.equal(
      executionReceipt.approvalReference,
      "owner-verified:asc-65"
    );
  } finally {
    await rm(
      context.directory,
      { recursive: true, force: true }
    );
  }
});

test("GitHub Project authorization fails closed when repository capability proof is incomplete", async () => {
  const context = await setup();
  try {
    const failing =
      new GitHubProjectAuthorizationService({
        projects: context.projects,
        connections: context.connections,
        bindings: context.bindings,
        delegations: context.delegations,
        repositoryAttestor: {
          async attestRepository() {
            return Object.freeze({
              installationId: "456",
              repository:
                "pyralisxc/AI-Systems-Control",
              accountId: "789",
              accountLogin: "pyralisxc",
              accountType: "User",
              capabilities: Object.freeze([
                "source.read",
                "repository.read"
              ]),
              verifiedAt:
                "2026-09-28T02:40:00.000Z"
            });
          }
        }
      });

    await assert.rejects(
      () => failing.bindProject({
        principalId: "principal:owner",
        projectId: "asc",
        connectionId:
          context.connection.connectionId,
        executionCapability:
          "pull_request.write"
      }),
      /missing required capability/i
    );
  } finally {
    await rm(
      context.directory,
      { recursive: true, force: true }
    );
  }
});
