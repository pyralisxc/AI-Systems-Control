import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  PersistentIdentityRegistry,
  PersistentProjectRegistry,
  WorkerAuthorityError,
  WorkerAuthorityService
} from "../dist/application/index.js";
import {
  JsonFileControlRegistryStore,
  JsonFileIdentityDirectoryStore
} from "../dist/adapters/index.js";

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "asc-worker-authority-"));
  const identities = new PersistentIdentityRegistry(
    new JsonFileIdentityDirectoryStore(join(directory, "identity.json"))
  );

  await identities.bootstrapPersonal({
    principalId: "principal:owner",
    principalDisplayName: "Owner",
    accountDomainId: "business-a",
    accountDomainName: "Business A"
  });

  await identities.registerPrincipal({
    principalId: "principal:worker",
    kind: "service",
    displayName: "Worker Service"
  });
  await identities.registerMembership({
    principalId: "principal:worker",
    accountDomainId: "business-a",
    roles: ["operator"]
  });

  await identities.registerPrincipal({
    principalId: "principal:service-owner",
    kind: "service",
    displayName: "Service Owner"
  });
  await identities.registerMembership({
    principalId: "principal:service-owner",
    accountDomainId: "business-a",
    roles: ["owner"]
  });

  await identities.registerPrincipal({
    principalId: "principal:viewer",
    kind: "human",
    displayName: "Viewer"
  });
  await identities.registerMembership({
    principalId: "principal:viewer",
    accountDomainId: "business-a",
    roles: ["viewer"]
  });

  await identities.registerPrincipal({
    principalId: "principal:suspended-admin",
    kind: "human",
    displayName: "Suspended Admin"
  });
  await identities.registerMembership({
    principalId: "principal:suspended-admin",
    accountDomainId: "business-a",
    roles: ["admin"],
    status: "suspended"
  });

  await identities.registerAccountDomain({
    accountDomainId: "business-b",
    kind: "organization",
    name: "Business B"
  });
  await identities.registerPrincipal({
    principalId: "principal:other-owner",
    kind: "human",
    displayName: "Other Owner"
  });
  await identities.registerMembership({
    principalId: "principal:other-owner",
    accountDomainId: "business-b",
    roles: ["owner"]
  });
  await identities.registerPrincipal({
    principalId: "principal:other-worker",
    kind: "service",
    displayName: "Other Worker"
  });
  await identities.registerMembership({
    principalId: "principal:other-worker",
    accountDomainId: "business-b",
    roles: ["operator"]
  });

  const store = new JsonFileControlRegistryStore(
    join(directory, "control.json"),
    "business-a"
  );
  const projects = new PersistentProjectRegistry(store, identities);
  await projects.resolveOrRegisterGithubProject({
    projectId: "cardforge",
    accountDomainId: "business-a",
    repository: "owner/cardforge"
  });

  return {
    directory,
    identities,
    store,
    authority: new WorkerAuthorityService(store, identities)
  };
}

async function approvedWorker(context) {
  const authorization = await context.authority.approveWork({
    projectId: "cardforge",
    approvedByPrincipalId: "principal:owner",
    workReference: "github:issue:42",
    scopeFingerprint: "sha256:scope-42",
    approvedAt: "2026-09-27T18:30:00.000Z"
  });
  const worker = await context.authority.startWorker({
    authorizationId: authorization.authorizationId,
    actingPrincipalId: "principal:worker",
    runtimeRef: "runtime:test",
    startedAt: "2026-09-27T18:30:10.000Z"
  });
  return { authorization, worker };
}

test("human approval creates authorization used by a service worker lease", async () => {
  const context = await setup();
  try {
    const { authorization, worker } = await approvedWorker(context);
    const lease = await context.authority.issueLease({
      workerRunId: worker.workerRunId,
      allowedCapabilities: ["source.write"],
      allowedEffects: ["mutate"],
      issuedAt: "2026-09-27T18:30:20.000Z",
      expiresInSeconds: 300
    });

    const receipt = await context.authority.validateLease({
      leaseId: lease.leaseId,
      capabilityId: "source.write",
      effectClass: "mutate",
      now: "2026-09-27T18:30:30.000Z"
    });

    assert.equal(
      receipt.approvedByPrincipalId,
      "principal:owner"
    );
    assert.equal(
      receipt.actedByPrincipalId,
      "principal:worker"
    );
    assert.equal(receipt.authorizationId, authorization.authorizationId);

    const audit = await context.authority.getProjectAudit("cardforge");
    const leaseEvent = audit.find((event) => event.type === "lease.issued");
    assert.equal(leaseEvent?.approvedByPrincipalId, "principal:owner");
    assert.equal(leaseEvent?.actedByPrincipalId, "principal:worker");
  } finally {
    await rm(context.directory, { recursive: true, force: true });
  }
});

test("service Principal cannot manufacture human approval", async () => {
  const context = await setup();
  try {
    await assert.rejects(
      () => context.authority.approveWork({
        projectId: "cardforge",
        approvedByPrincipalId: "principal:service-owner",
        workReference: "github:issue:42",
        scopeFingerprint: "sha256:service-self-approval"
      }),
      /requires a human Principal/i
    );
  } finally {
    await rm(context.directory, { recursive: true, force: true });
  }
});

test("viewer, suspended, and wrong-domain human Principals cannot approve protected work", async () => {
  const context = await setup();
  try {
    for (const principalId of [
      "principal:viewer",
      "principal:suspended-admin",
      "principal:other-owner"
    ]) {
      await assert.rejects(
        () => context.authority.approveWork({
          projectId: "cardforge",
          approvedByPrincipalId: principalId,
          workReference: "github:issue:42",
          scopeFingerprint: "sha256:" + principalId
        }),
        WorkerAuthorityError
      );
    }
  } finally {
    await rm(context.directory, { recursive: true, force: true });
  }
});

test("worker from another AccountDomain cannot attach to authorization", async () => {
  const context = await setup();
  try {
    const authorization = await context.authority.approveWork({
      projectId: "cardforge",
      approvedByPrincipalId: "principal:owner",
      workReference: "github:issue:42",
      scopeFingerprint: "sha256:wrong-domain-worker"
    });

    await assert.rejects(
      () => context.authority.startWorker({
        authorizationId: authorization.authorizationId,
        actingPrincipalId: "principal:other-worker"
      }),
      /no active Membership/i
    );
  } finally {
    await rm(context.directory, { recursive: true, force: true });
  }
});

test("owner STOP increments control generation and invalidates prior lease", async () => {
  const context = await setup();
  try {
    const { worker } = await approvedWorker(context);
    const lease = await context.authority.issueLease({
      workerRunId: worker.workerRunId,
      allowedCapabilities: ["source.write"],
      allowedEffects: ["mutate"],
      issuedAt: "2026-09-27T18:31:00.000Z",
      expiresInSeconds: 300
    });

    await context.authority.validateLease({
      leaseId: lease.leaseId,
      capabilityId: "source.write",
      effectClass: "mutate",
      now: "2026-09-27T18:31:10.000Z"
    });

    const stopped = await context.authority.stopProject({
      projectId: "cardforge",
      changedByPrincipalId: "principal:owner",
      reason: "owner stop",
      changedAt: "2026-09-27T18:31:20.000Z"
    });
    assert.equal(stopped.mode, "owner_stopped");
    assert.equal(stopped.generation, lease.controlGeneration + 1);

    await assert.rejects(
      () => context.authority.validateLease({
        leaseId: lease.leaseId,
        capabilityId: "source.write",
        effectClass: "mutate",
        now: "2026-09-27T18:31:30.000Z"
      }),
      /stale or stopped/i
    );
  } finally {
    await rm(context.directory, { recursive: true, force: true });
  }
});

test("expired or over-broad lease use fails closed", async () => {
  const context = await setup();
  try {
    const { worker } = await approvedWorker(context);
    const lease = await context.authority.issueLease({
      workerRunId: worker.workerRunId,
      allowedCapabilities: ["source.read"],
      allowedEffects: ["read"],
      issuedAt: "2026-09-27T18:32:00.000Z",
      expiresInSeconds: 1
    });

    await assert.rejects(
      () => context.authority.validateLease({
        leaseId: lease.leaseId,
        capabilityId: "source.write",
        effectClass: "mutate",
        now: "2026-09-27T18:32:00.500Z"
      }),
      /does not allow/i
    );

    await assert.rejects(
      () => context.authority.validateLease({
        leaseId: lease.leaseId,
        capabilityId: "source.read",
        effectClass: "read",
        now: "2026-09-27T18:32:02.000Z"
      }),
      /expired/i
    );
  } finally {
    await rm(context.directory, { recursive: true, force: true });
  }
});
