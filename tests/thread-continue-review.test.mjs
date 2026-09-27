import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  ContinuationAuthorityService,
  InMemoryThreadStore,
  PersistentIdentityRegistry,
  PersistentProjectRegistry,
  ThreadContinueReviewError,
  ThreadContinueReviewService,
  WorkerAuthorityService
} from "../dist/application/index.js";
import {
  JsonFileControlRegistryStore,
  JsonFileIdentityDirectoryStore
} from "../dist/adapters/index.js";

async function setup() {
  const directory = await mkdtemp(
    join(tmpdir(), "asc-thread-continue-")
  );
  const identities = new PersistentIdentityRegistry(
    new JsonFileIdentityDirectoryStore(
      join(directory, "identity.json")
    )
  );
  await identities.bootstrapPersonal({
    principalId: "principal:owner",
    principalDisplayName: "Owner",
    accountDomainId: "business-a",
    accountDomainName: "Business A"
  });
  await identities.registerPrincipal({
    principalId: "principal:other-admin",
    kind: "human",
    displayName: "Other Admin"
  });
  await identities.registerMembership({
    principalId: "principal:other-admin",
    accountDomainId: "business-a",
    roles: ["admin"]
  });

  const controlStore = new JsonFileControlRegistryStore(
    join(directory, "control.json"),
    "business-a"
  );
  const projects = new PersistentProjectRegistry(
    controlStore,
    identities
  );
  await projects.resolveOrRegisterGithubProject({
    projectId: "cardforge",
    accountDomainId: "business-a",
    repository: "owner/cardforge"
  });

  const threadStore = new InMemoryThreadStore("business-a");
  const thread = {
    threadId: "thread:cardforge",
    accountDomainId: "business-a",
    projectId: "cardforge",
    title: "CardForge",
    mode: "bridged",
    lifecycle: "active",
    runtimeCapabilities: {
      canPublishCheckpoint: true,
      canSteer: false,
      canInterrupt: false,
      canStopRuntime: false,
      canAutoSendRelay: false
    },
    createdAt: "2026-09-27T23:10:00.000Z",
    updatedAt: "2026-09-27T23:10:00.000Z"
  };
  const created = await threadStore.create(thread);
  await threadStore.save({
    threadId: thread.threadId,
    expectedRevision: created.revision,
    thread,
    checkpoints: [],
    activities: [],
    relays: [{
      relayId: "relay:latest",
      threadId: thread.threadId,
      accountDomainId: "business-a",
      projectId: "cardforge",
      representedPrincipalId: "principal:owner",
      generatedByPrincipalId: "principal:relay",
      proposalMode: "suggest",
      proposedText: "Continue routine refinement.",
      workClass: "routine_bug",
      requestedEffect: "read",
      requestedRepositoryBoundary: "read_only",
      sourceReferences: [],
      evidenceReferences: [],
      generatedAt: "2026-09-27T23:10:00.000Z",
      proposalAuthority: {
        decision: "needs_owner",
        reason: "No envelope yet.",
        accountDomainId: "business-a",
        projectId: "cardforge",
        workClass: "routine_bug",
        requestedEffect: "read",
        requestedRepositoryBoundary: "read_only",
        basis: {}
      },
      state: "owner_approved",
      finalText: "Continue routine refinement.",
      ownerFeedbackPrincipalId: "principal:owner",
      feedbackAt: "2026-09-27T23:10:05.000Z"
    }]
  });

  const continuation = new ContinuationAuthorityService(
    controlStore,
    identities
  );
  const workers = new WorkerAuthorityService(
    controlStore,
    identities
  );
  const review = new ThreadContinueReviewService({
    threadStore,
    continuation,
    workers
  });

  return {
    directory,
    controlStore,
    continuation,
    workers,
    review,
    threadStore
  };
}

async function grantContinue(context, level = 2) {
  return context.continuation.grantAutonomy({
    projectId: "cardforge",
    workClass: "routine_bug",
    level,
    repositoryCeiling: "read_only",
    grantedByPrincipalId: "principal:owner",
    evidenceBasisRefs: ["relay-calibration:test"],
    grantedAt: "2026-09-27T23:11:00.000Z"
  });
}

test("owner creates exact Thread-bounded read-only Continue envelope", async () => {
  const context = await setup();
  try {
    const grant = await grantContinue(context);

    const result = await context.review.enableReadOnlyContinue({
      threadId: "thread:cardforge",
      reviewedByPrincipalId: "principal:owner",
      createdAt: "2026-09-27T23:12:00.000Z"
    });

    assert.equal(result.changed, true);
    assert.equal(result.grantId, grant.grantId);
    assert.equal(result.envelope.threadId, "thread:cardforge");
    assert.equal(result.envelope.objectiveRef, "thread:cardforge");
    assert.deepEqual(result.envelope.workClasses, ["routine_bug"]);
    assert.deepEqual(result.envelope.allowedEffects, ["read"]);
    assert.equal(result.envelope.repositoryBoundary, "read_only");
    assert.deepEqual(result.envelope.allowedCapabilities, []);
    assert.equal(
      result.envelope.continuationPolicy,
      "continue_until_gate"
    );
    assert.equal(result.envelope.authorizationId, undefined);

    const snapshot = await context.controlStore.load();
    assert.equal(
      snapshot.workerControl.authorizations.length,
      0
    );
  } finally {
    await rm(context.directory, {
      recursive: true,
      force: true
    });
  }
});

test("equivalent Thread Continue action is idempotent", async () => {
  const context = await setup();
  try {
    await grantContinue(context);
    const first = await context.review.enableReadOnlyContinue({
      threadId: "thread:cardforge",
      reviewedByPrincipalId: "principal:owner",
      createdAt: "2026-09-27T23:12:00.000Z"
    });
    const second = await context.review.enableReadOnlyContinue({
      threadId: "thread:cardforge",
      reviewedByPrincipalId: "principal:owner",
      createdAt: "2026-09-27T23:13:00.000Z"
    });

    assert.equal(first.changed, true);
    assert.equal(second.changed, false);
    assert.equal(
      second.envelope.envelopeId,
      first.envelope.envelopeId
    );

    const snapshot = await context.controlStore.load();
    assert.equal(
      snapshot.continuationControl.workEnvelopes.length,
      1
    );
  } finally {
    await rm(context.directory, {
      recursive: true,
      force: true
    });
  }
});

test("missing active Level 2 grant rejects Thread Continue envelope", async () => {
  const context = await setup();
  try {
    await assert.rejects(
      () => context.review.enableReadOnlyContinue({
        threadId: "thread:cardforge",
        reviewedByPrincipalId: "principal:owner"
      }),
      /Level 2-or-higher AutonomyGrant/i
    );
  } finally {
    await rm(context.directory, {
      recursive: true,
      force: true
    });
  }
});

test("another human cannot enable represented owner's Thread Continue scope", async () => {
  const context = await setup();
  try {
    await grantContinue(context);

    await assert.rejects(
      () => context.review.enableReadOnlyContinue({
        threadId: "thread:cardforge",
        reviewedByPrincipalId: "principal:other-admin"
      }),
      ThreadContinueReviewError
    );
  } finally {
    await rm(context.directory, {
      recursive: true,
      force: true
    });
  }
});

test("read-only Thread envelope allows no-capability continuation only", async () => {
  const context = await setup();
  try {
    await grantContinue(context);
    await context.review.enableReadOnlyContinue({
      threadId: "thread:cardforge",
      reviewedByPrincipalId: "principal:owner"
    });

    const allowed = await context.continuation.evaluate({
      projectId: "cardforge",
      threadId: "thread:cardforge",
      workClass: "routine_bug",
      requestedEffect: "read",
      requestedRepositoryBoundary: "read_only"
    });
    assert.equal(allowed.decision, "allow");

    const capability = await context.continuation.evaluate({
      projectId: "cardforge",
      threadId: "thread:cardforge",
      workClass: "routine_bug",
      requestedEffect: "read",
      requestedRepositoryBoundary: "read_only",
      capabilityId: "source.read"
    });
    assert.equal(capability.decision, "needs_owner");
    assert.match(capability.reason, /capability/i);

    const mutation = await context.continuation.evaluate({
      projectId: "cardforge",
      threadId: "thread:cardforge",
      workClass: "routine_bug",
      requestedEffect: "mutate",
      requestedRepositoryBoundary: "read_only"
    });
    assert.equal(mutation.decision, "needs_owner");

    const workBranch = await context.continuation.evaluate({
      projectId: "cardforge",
      threadId: "thread:cardforge",
      workClass: "routine_bug",
      requestedEffect: "read",
      requestedRepositoryBoundary: "work_branch"
    });
    assert.equal(workBranch.decision, "needs_owner");
  } finally {
    await rm(context.directory, {
      recursive: true,
      force: true
    });
  }
});

test("owner STOP blocks Thread Continue creation and existing envelope use", async () => {
  const context = await setup();
  try {
    await grantContinue(context);
    await context.workers.stopProject({
      projectId: "cardforge",
      changedByPrincipalId: "principal:owner",
      changedAt: "2026-09-27T23:12:00.000Z"
    });

    await assert.rejects(
      () => context.review.enableReadOnlyContinue({
        threadId: "thread:cardforge",
        reviewedByPrincipalId: "principal:owner"
      }),
      /ControlState does not permit continuation/i
    );

    const evaluation = await context.continuation.evaluate({
      projectId: "cardforge",
      threadId: "thread:cardforge",
      workClass: "routine_bug",
      requestedEffect: "read",
      requestedRepositoryBoundary: "read_only"
    });
    assert.equal(evaluation.decision, "blocked");
    assert.match(evaluation.reason, /owner_stopped/i);
  } finally {
    await rm(context.directory, {
      recursive: true,
      force: true
    });
  }
});
