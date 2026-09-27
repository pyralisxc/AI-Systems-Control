import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  ContinuationAuthorityService,
  InMemoryThreadStore,
  OwnerAutonomyReviewError,
  OwnerAutonomyReviewService,
  PersistentIdentityRegistry,
  PersistentProjectRegistry,
  RelayCalibrationService
} from "../dist/application/index.js";
import {
  JsonFileControlRegistryStore,
  JsonFileIdentityDirectoryStore
} from "../dist/adapters/index.js";

function thread() {
  return {
    threadId: "thread:one",
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
    createdAt: "2026-09-27T20:00:00.000Z",
    updatedAt: "2026-09-27T20:10:00.000Z"
  };
}

function authority() {
  return {
    decision: "needs_owner",
    reason: "test",
    accountDomainId: "business-a",
    projectId: "cardforge",
    workClass: "routine_bug",
    requestedEffect: "read",
    requestedRepositoryBoundary: "read_only",
    basis: {}
  };
}

function relay(id, state, overrides = {}) {
  return {
    relayId: id,
    threadId: "thread:one",
    accountDomainId: "business-a",
    projectId: "cardforge",
    representedPrincipalId: "principal:owner",
    generatedByPrincipalId: "principal:relay",
    proposalMode: "suggest",
    proposedText: "Continue after tests pass.",
    workClass: "routine_bug",
    requestedEffect: "read",
    requestedRepositoryBoundary: "read_only",
    sourceReferences: [],
    evidenceReferences: [],
    generatedAt: "2026-09-27T20:00:00.000Z",
    proposalAuthority: authority(),
    state,
    ...overrides
  };
}

async function setup(relays) {
  const directory = await mkdtemp(join(tmpdir(), "asc-autonomy-review-"));
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
  const projects = new PersistentProjectRegistry(controlStore, identities);
  await projects.resolveOrRegisterGithubProject({
    projectId: "cardforge",
    accountDomainId: "business-a",
    repository: "owner/cardforge"
  });

  const threadStore = new InMemoryThreadStore("business-a");
  const created = await threadStore.create(thread());
  await threadStore.save({
    threadId: created.thread.threadId,
    expectedRevision: created.revision,
    thread: created.thread,
    checkpoints: [],
    activities: [],
    relays
  });

  const continuation = new ContinuationAuthorityService(
    controlStore,
    identities
  );
  const calibration = new RelayCalibrationService(threadStore);
  const review = new OwnerAutonomyReviewService({
    calibration,
    continuation
  });

  return {
    directory,
    controlStore,
    continuation,
    review
  };
}

function candidateRelays() {
  return [
    relay("relay:1", "owner_approved", {
      finalText: "Continue after tests pass.",
      feedbackAt: "2026-09-27T20:01:00.000Z"
    }),
    relay("relay:2", "owner_approved", {
      finalText: "Continue after tests pass.",
      feedbackAt: "2026-09-27T20:02:00.000Z"
    })
  ];
}

const candidatePolicy = {
  minimumResponses: 2,
  minimumAcceptanceRate: 1,
  maximumRejectionRate: 0,
  maximumMeanEditRatio: 0
};

test("represented owner can explicitly grant Level 2 read-only from review-ready calibration", async () => {
  const context = await setup(candidateRelays());
  try {
    const result = await context.review.grantContinueFromCalibration({
      representedPrincipalId: "principal:owner",
      reviewedByPrincipalId: "principal:owner",
      projectId: "cardforge",
      workClass: "routine_bug",
      policy: candidatePolicy,
      grantedAt: "2026-09-27T20:10:00.000Z"
    });

    assert.equal(result.changed, true);
    assert.equal(result.projection.readiness, "review_candidate");
    assert.equal(result.grant.level, 2);
    assert.equal(result.grant.repositoryCeiling, "read_only");
    assert.equal(result.grant.grantedByPrincipalId, "principal:owner");
    assert.deepEqual(
      result.grant.evidenceBasisRefs,
      [
        result.projection.evidenceReference,
        result.projection.evidenceFingerprint
      ]
    );
    assert.equal(
      result.grant.lastProvenAt,
      result.projection.lastEvidenceAt
    );

    const snapshot = await context.controlStore.load();
    assert.equal(snapshot.continuationControl.autonomyGrants.length, 1);
    assert.equal(snapshot.continuationControl.workEnvelopes.length, 0);
    assert.equal(snapshot.workerControl.authorizations.length, 0);
  } finally {
    await rm(context.directory, { recursive: true, force: true });
  }
});

test("not-ready calibration cannot use earned Continue grant path", async () => {
  const context = await setup([
    relay("relay:1", "rejected", {
      feedbackAt: "2026-09-27T20:01:00.000Z"
    })
  ]);
  try {
    await assert.rejects(
      () => context.review.grantContinueFromCalibration({
        representedPrincipalId: "principal:owner",
        reviewedByPrincipalId: "principal:owner",
        projectId: "cardforge",
        workClass: "routine_bug",
        policy: {
          minimumResponses: 1,
          minimumAcceptanceRate: 1,
          maximumRejectionRate: 0,
          maximumMeanEditRatio: 0
        }
      }),
      /not currently ready/i
    );

    const snapshot = await context.controlStore.load();
    assert.equal(snapshot.continuationControl.autonomyGrants.length, 0);
  } finally {
    await rm(context.directory, { recursive: true, force: true });
  }
});

test("another human cannot approve autonomy from represented owner's calibration", async () => {
  const context = await setup(candidateRelays());
  try {
    await assert.rejects(
      () => context.review.grantContinueFromCalibration({
        representedPrincipalId: "principal:owner",
        reviewedByPrincipalId: "principal:other-admin",
        projectId: "cardforge",
        workClass: "routine_bug",
        policy: candidatePolicy
      }),
      OwnerAutonomyReviewError
    );

    const snapshot = await context.controlStore.load();
    assert.equal(snapshot.continuationControl.autonomyGrants.length, 0);
  } finally {
    await rm(context.directory, { recursive: true, force: true });
  }
});

test("repeated review is idempotent when active Level 2 grant already exists", async () => {
  const context = await setup(candidateRelays());
  try {
    const first = await context.review.grantContinueFromCalibration({
      representedPrincipalId: "principal:owner",
      reviewedByPrincipalId: "principal:owner",
      projectId: "cardforge",
      workClass: "routine_bug",
      policy: candidatePolicy,
      grantedAt: "2026-09-27T20:10:00.000Z"
    });
    const second = await context.review.grantContinueFromCalibration({
      representedPrincipalId: "principal:owner",
      reviewedByPrincipalId: "principal:owner",
      projectId: "cardforge",
      workClass: "routine_bug",
      policy: candidatePolicy,
      grantedAt: "2026-09-27T20:11:00.000Z"
    });

    assert.equal(first.changed, true);
    assert.equal(second.changed, false);
    assert.equal(second.grant.grantId, first.grant.grantId);

    const snapshot = await context.controlStore.load();
    assert.equal(snapshot.continuationControl.autonomyGrants.length, 1);
  } finally {
    await rm(context.directory, { recursive: true, force: true });
  }
});

test("existing higher active autonomy grant is never downgraded", async () => {
  const context = await setup(candidateRelays());
  try {
    const higher = await context.continuation.grantAutonomy({
      projectId: "cardforge",
      workClass: "routine_bug",
      level: 4,
      repositoryCeiling: "preview",
      grantedByPrincipalId: "principal:owner",
      evidenceBasisRefs: ["owner:existing-higher"],
      grantedAt: "2026-09-27T20:09:00.000Z"
    });

    const result = await context.review.grantContinueFromCalibration({
      representedPrincipalId: "principal:owner",
      reviewedByPrincipalId: "principal:owner",
      projectId: "cardforge",
      workClass: "routine_bug",
      policy: candidatePolicy,
      grantedAt: "2026-09-27T20:10:00.000Z"
    });

    assert.equal(result.changed, false);
    assert.equal(result.grant.grantId, higher.grantId);
    assert.equal(result.grant.level, 4);
    assert.equal(result.grant.repositoryCeiling, "preview");

    const snapshot = await context.controlStore.load();
    assert.equal(snapshot.continuationControl.autonomyGrants.length, 1);
  } finally {
    await rm(context.directory, { recursive: true, force: true });
  }
});

test("Continue grant alone does not authorize continuation without a WorkEnvelope", async () => {
  const context = await setup(candidateRelays());
  try {
    await context.review.grantContinueFromCalibration({
      representedPrincipalId: "principal:owner",
      reviewedByPrincipalId: "principal:owner",
      projectId: "cardforge",
      workClass: "routine_bug",
      policy: candidatePolicy
    });

    const evaluation = await context.continuation.evaluate({
      projectId: "cardforge",
      workClass: "routine_bug",
      requestedEffect: "read",
      requestedRepositoryBoundary: "read_only"
    });

    assert.equal(evaluation.decision, "needs_owner");
    assert.match(evaluation.reason, /No WorkEnvelope/i);
  } finally {
    await rm(context.directory, { recursive: true, force: true });
  }
});
