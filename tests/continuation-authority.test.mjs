import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  ContinuationAuthorityError,
  ContinuationAuthorityService,
  PersistentIdentityRegistry,
  PersistentProjectRegistry,
  WorkerAuthorityService
} from "../dist/application/index.js";
import {
  JsonFileControlRegistryStore,
  JsonFileIdentityDirectoryStore
} from "../dist/adapters/index.js";

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "asc-continuation-"));
  const identities = new PersistentIdentityRegistry(
    new JsonFileIdentityDirectoryStore(join(directory, "identity.json"))
  );
  await identities.bootstrapPersonal({
    principalId: "principal:owner",
    principalDisplayName: "Owner",
    accountDomainId: "business-a",
    accountDomainName: "Business A"
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
    store,
    continuation: new ContinuationAuthorityService(store, identities),
    workers: new WorkerAuthorityService(store, identities)
  };
}

async function activeAuthorization(context, options = {}) {
  return context.workers.approveWork({
    projectId: "cardforge",
    approvedByPrincipalId: "principal:owner",
    workReference: options.workReference ?? "github:issue:42",
    scopeFingerprint: options.scopeFingerprint ?? "sha256:scope-42",
    approvedAt: options.approvedAt ?? "2026-09-27T19:00:00.000Z"
  });
}

test("Level Continue allows read-only continuation inside envelope", async () => {
  const context = await setup();
  try {
    const envelope = await context.continuation.createEnvelope({
      projectId: "cardforge",
      objectiveRef: "explore:studio",
      scopeFingerprint: "sha256:explore-studio",
      workClasses: ["refinement"],
      allowedEffects: ["read"],
      repositoryBoundary: "read_only",
      continuationPolicy: "continue_until_gate",
      createdByPrincipalId: "principal:owner",
      createdAt: "2026-09-27T19:00:00.000Z"
    });
    const grant = await context.continuation.grantAutonomy({
      projectId: "cardforge",
      workClass: "refinement",
      level: 2,
      repositoryCeiling: "read_only",
      grantedByPrincipalId: "principal:owner",
      evidenceBasisRefs: ["owner:accepted-relay:47-of-49"],
      lastProvenAt: "2026-09-27T18:55:00.000Z",
      grantedAt: "2026-09-27T19:00:01.000Z"
    });

    const result = await context.continuation.evaluate({
      projectId: "cardforge",
      workClass: "refinement",
      requestedEffect: "read",
      requestedRepositoryBoundary: "read_only",
      now: "2026-09-27T19:01:00.000Z"
    });

    assert.equal(result.decision, "allow");
    assert.equal(result.basis.envelopeId, envelope.envelopeId);
    assert.equal(result.basis.grantId, grant.grantId);
    assert.equal(result.basis.autonomyLevel, 2);
    assert.equal(result.basis.effectiveRepositoryCeiling, "read_only");
  } finally {
    await rm(context.directory, { recursive: true, force: true });
  }
});

test("Level Continue cannot mutate even when envelope has authorization", async () => {
  const context = await setup();
  try {
    const authorization = await activeAuthorization(context);
    await context.continuation.createEnvelope({
      projectId: "cardforge",
      objectiveRef: authorization.workReference,
      scopeFingerprint: authorization.scopeFingerprint,
      workClasses: ["routine_bug"],
      allowedEffects: ["read", "mutate"],
      repositoryBoundary: "preview",
      continuationPolicy: "continue_until_gate",
      authorizationId: authorization.authorizationId,
      createdByPrincipalId: "principal:owner",
      createdAt: "2026-09-27T19:01:00.000Z"
    });
    await context.continuation.grantAutonomy({
      projectId: "cardforge",
      workClass: "routine_bug",
      level: 2,
      repositoryCeiling: "preview",
      grantedByPrincipalId: "principal:owner",
      evidenceBasisRefs: ["owner:grant:routine-bug"],
      grantedAt: "2026-09-27T19:01:01.000Z"
    });

    const result = await context.continuation.evaluate({
      projectId: "cardforge",
      workClass: "routine_bug",
      requestedEffect: "mutate",
      requestedRepositoryBoundary: "work_branch",
      now: "2026-09-27T19:02:00.000Z"
    });

    assert.equal(result.decision, "needs_owner");
    assert.match(result.reason, /Integrate or higher/i);
  } finally {
    await rm(context.directory, { recursive: true, force: true });
  }
});

test("Level Integrate allows Preview mutation with matching WorkAuthorization", async () => {
  const context = await setup();
  try {
    const authorization = await activeAuthorization(context);
    const envelope = await context.continuation.createEnvelope({
      projectId: "cardforge",
      objectiveRef: authorization.workReference,
      scopeFingerprint: authorization.scopeFingerprint,
      workClasses: ["routine_bug"],
      allowedEffects: ["read", "mutate"],
      repositoryBoundary: "preview",
      allowedCapabilities: ["source.write", "test.run"],
      continuationPolicy: "autonomous_bounded",
      authorizationId: authorization.authorizationId,
      createdByPrincipalId: "principal:owner",
      createdAt: "2026-09-27T19:03:00.000Z"
    });
    const grant = await context.continuation.grantAutonomy({
      projectId: "cardforge",
      workClass: "routine_bug",
      level: 3,
      repositoryCeiling: "preview",
      grantedByPrincipalId: "principal:owner",
      evidenceBasisRefs: ["owner:accepted:routine-bug"],
      grantedAt: "2026-09-27T19:03:01.000Z"
    });

    const result = await context.continuation.evaluate({
      projectId: "cardforge",
      workClass: "routine_bug",
      requestedEffect: "mutate",
      requestedRepositoryBoundary: "preview",
      capabilityId: "source.write",
      now: "2026-09-27T19:04:00.000Z"
    });

    assert.equal(result.decision, "allow");
    assert.equal(result.basis.envelopeId, envelope.envelopeId);
    assert.equal(result.basis.grantId, grant.grantId);
    assert.equal(result.basis.authorizationId, authorization.authorizationId);
  } finally {
    await rm(context.directory, { recursive: true, force: true });
  }
});

test("Preview envelope and grant never silently widen to Main", async () => {
  const context = await setup();
  try {
    const authorization = await activeAuthorization(context);
    await context.continuation.createEnvelope({
      projectId: "cardforge",
      objectiveRef: authorization.workReference,
      scopeFingerprint: authorization.scopeFingerprint,
      workClasses: ["routine_bug"],
      allowedEffects: ["mutate"],
      repositoryBoundary: "preview",
      continuationPolicy: "autonomous_bounded",
      authorizationId: authorization.authorizationId,
      createdByPrincipalId: "principal:owner"
    });
    await context.continuation.grantAutonomy({
      projectId: "cardforge",
      workClass: "routine_bug",
      level: 5,
      repositoryCeiling: "preview",
      grantedByPrincipalId: "principal:owner",
      evidenceBasisRefs: ["owner:extended-but-preview"],
      grantedAt: "2026-09-27T19:05:00.000Z"
    });

    const result = await context.continuation.evaluate({
      projectId: "cardforge",
      workClass: "routine_bug",
      requestedEffect: "mutate",
      requestedRepositoryBoundary: "main",
      now: "2026-09-27T19:06:00.000Z"
    });

    assert.equal(result.decision, "needs_owner");
    assert.match(result.reason, /WorkEnvelope ceiling/i);
  } finally {
    await rm(context.directory, { recursive: true, force: true });
  }
});

test("owner STOP overrides a valid envelope and high autonomy grant", async () => {
  const context = await setup();
  try {
    await context.continuation.createEnvelope({
      projectId: "cardforge",
      objectiveRef: "explore:studio",
      scopeFingerprint: "sha256:explore-studio",
      workClasses: ["refinement"],
      allowedEffects: ["read"],
      repositoryBoundary: "read_only",
      continuationPolicy: "autonomous_bounded",
      createdByPrincipalId: "principal:owner"
    });
    await context.continuation.grantAutonomy({
      projectId: "cardforge",
      workClass: "refinement",
      level: 5,
      repositoryCeiling: "main",
      grantedByPrincipalId: "principal:owner",
      evidenceBasisRefs: ["owner:extended"],
      grantedAt: "2026-09-27T19:07:00.000Z"
    });
    await context.workers.stopProject({
      projectId: "cardforge",
      changedByPrincipalId: "principal:owner",
      changedAt: "2026-09-27T19:07:10.000Z"
    });

    const result = await context.continuation.evaluate({
      projectId: "cardforge",
      workClass: "refinement",
      requestedEffect: "read",
      requestedRepositoryBoundary: "read_only",
      now: "2026-09-27T19:07:20.000Z"
    });

    assert.equal(result.decision, "blocked");
    assert.match(result.reason, /owner_stopped/i);
  } finally {
    await rm(context.directory, { recursive: true, force: true });
  }
});

test("grant due for review or marked needs_review requires owner", async () => {
  const context = await setup();
  try {
    await context.continuation.createEnvelope({
      projectId: "cardforge",
      objectiveRef: "explore:studio",
      scopeFingerprint: "sha256:explore-studio",
      workClasses: ["refinement"],
      allowedEffects: ["read"],
      repositoryBoundary: "read_only",
      continuationPolicy: "continue_until_gate",
      createdByPrincipalId: "principal:owner"
    });
    const grant = await context.continuation.grantAutonomy({
      projectId: "cardforge",
      workClass: "refinement",
      level: 2,
      repositoryCeiling: "read_only",
      grantedByPrincipalId: "principal:owner",
      evidenceBasisRefs: ["owner:dated-grant"],
      grantedAt: "2026-09-27T19:08:00.000Z",
      reviewAfter: "2026-09-27T19:10:00.000Z"
    });

    const due = await context.continuation.evaluate({
      projectId: "cardforge",
      workClass: "refinement",
      requestedEffect: "read",
      requestedRepositoryBoundary: "read_only",
      now: "2026-09-27T19:10:01.000Z"
    });
    assert.equal(due.decision, "needs_owner");
    assert.match(due.reason, /due for owner review/i);

    await context.continuation.setGrantState({
      grantId: grant.grantId,
      state: "needs_review",
      changedByPrincipalId: "principal:owner"
    });
    const marked = await context.continuation.evaluate({
      projectId: "cardforge",
      workClass: "refinement",
      requestedEffect: "read",
      requestedRepositoryBoundary: "read_only",
      now: "2026-09-27T19:09:00.000Z"
    });
    assert.equal(marked.decision, "needs_owner");
    assert.match(marked.reason, /needs_review/i);
  } finally {
    await rm(context.directory, { recursive: true, force: true });
  }
});

test("mutable envelope cannot be created without active matching WorkAuthorization", async () => {
  const context = await setup();
  try {
    await assert.rejects(
      () => context.continuation.createEnvelope({
        projectId: "cardforge",
        objectiveRef: "github:issue:42",
        scopeFingerprint: "sha256:scope-42",
        workClasses: ["routine_bug"],
        allowedEffects: ["mutate"],
        repositoryBoundary: "work_branch",
        continuationPolicy: "continue_until_gate",
        createdByPrincipalId: "principal:owner"
      }),
      /requires an active matching WorkAuthorization/i
    );
  } finally {
    await rm(context.directory, { recursive: true, force: true });
  }
});

test("authorization revalidation blocks a previously valid mutable envelope", async () => {
  const context = await setup();
  try {
    const authorization = await activeAuthorization(context);
    await context.continuation.createEnvelope({
      projectId: "cardforge",
      objectiveRef: authorization.workReference,
      scopeFingerprint: authorization.scopeFingerprint,
      workClasses: ["routine_bug"],
      allowedEffects: ["mutate"],
      repositoryBoundary: "preview",
      continuationPolicy: "autonomous_bounded",
      authorizationId: authorization.authorizationId,
      createdByPrincipalId: "principal:owner"
    });
    await context.continuation.grantAutonomy({
      projectId: "cardforge",
      workClass: "routine_bug",
      level: 3,
      repositoryCeiling: "preview",
      grantedByPrincipalId: "principal:owner",
      evidenceBasisRefs: ["owner:integration-grant"],
      grantedAt: "2026-09-27T19:11:00.000Z"
    });

    const snapshot = await context.store.load();
    const authorizations = snapshot.workerControl.authorizations.map((value) =>
      value.authorizationId === authorization.authorizationId
        ? { ...value, state: "needs_revalidation" }
        : value
    );
    await context.store.save({
      expectedRevision: snapshot.revision,
      projects: snapshot.projects,
      connections: snapshot.connections,
      projectConnectionBindings: snapshot.projectConnectionBindings,
      delegations: snapshot.delegations,
      workerControl: {
        ...snapshot.workerControl,
        authorizations
      },
      continuationControl: snapshot.continuationControl
    });

    const result = await context.continuation.evaluate({
      projectId: "cardforge",
      workClass: "routine_bug",
      requestedEffect: "mutate",
      requestedRepositoryBoundary: "preview",
      now: "2026-09-27T19:12:00.000Z"
    });

    assert.equal(result.decision, "blocked");
    assert.match(result.reason, /lacks an active matching WorkAuthorization/i);
    assert.equal(result.basis.authorizationId, authorization.authorizationId);
  } finally {
    await rm(context.directory, { recursive: true, force: true });
  }
});

test("explicit owner gate wins even when read continuation would otherwise be allowed", async () => {
  const context = await setup();
  try {
    await context.continuation.createEnvelope({
      projectId: "cardforge",
      objectiveRef: "explore:studio",
      scopeFingerprint: "sha256:explore-studio",
      workClasses: ["refinement"],
      allowedEffects: ["read"],
      repositoryBoundary: "read_only",
      continuationPolicy: "continue_until_gate",
      createdByPrincipalId: "principal:owner"
    });
    await context.continuation.grantAutonomy({
      projectId: "cardforge",
      workClass: "refinement",
      level: 2,
      repositoryCeiling: "read_only",
      grantedByPrincipalId: "principal:owner",
      evidenceBasisRefs: ["owner:continue"],
      grantedAt: "2026-09-27T19:13:00.000Z"
    });

    const result = await context.continuation.evaluate({
      projectId: "cardforge",
      workClass: "refinement",
      requestedEffect: "read",
      requestedRepositoryBoundary: "read_only",
      explicitOwnerGateReached: true,
      now: "2026-09-27T19:14:00.000Z"
    });

    assert.equal(result.decision, "needs_owner");
    assert.match(result.reason, /explicit owner gate/i);
  } finally {
    await rm(context.directory, { recursive: true, force: true });
  }
});


test("new WorkEnvelope version supersedes prior active envelope for the same objective", async () => {
  const context = await setup();
  try {
    const first = await context.continuation.createEnvelope({
      projectId: "cardforge",
      objectiveRef: "explore:studio",
      scopeFingerprint: "sha256:explore-studio",
      workClasses: ["refinement"],
      allowedEffects: ["read"],
      repositoryBoundary: "read_only",
      continuationPolicy: "interactive",
      createdByPrincipalId: "principal:owner",
      createdAt: "2026-09-27T19:20:00.000Z"
    });
    const second = await context.continuation.createEnvelope({
      projectId: "cardforge",
      objectiveRef: "explore:studio",
      scopeFingerprint: "sha256:explore-studio",
      workClasses: ["refinement"],
      allowedEffects: ["read"],
      repositoryBoundary: "read_only",
      continuationPolicy: "continue_until_gate",
      createdByPrincipalId: "principal:owner",
      createdAt: "2026-09-27T19:21:00.000Z"
    });

    const snapshot = await context.store.load();
    const persistedFirst = snapshot.continuationControl.workEnvelopes.find(
      (envelope) => envelope.envelopeId === first.envelopeId
    );
    const persistedSecond = snapshot.continuationControl.workEnvelopes.find(
      (envelope) => envelope.envelopeId === second.envelopeId
    );

    assert.equal(first.version, 1);
    assert.equal(second.version, 2);
    assert.equal(persistedFirst?.state, "superseded");
    assert.equal(persistedSecond?.state, "active");
  } finally {
    await rm(context.directory, { recursive: true, force: true });
  }
});
