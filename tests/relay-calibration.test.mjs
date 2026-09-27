import assert from "node:assert/strict";
import test from "node:test";

import {
  InMemoryThreadStore,
  RelayCalibrationService,
  normalizedRelayEditRatio
} from "../dist/application/index.js";

function thread(id, projectId = "cardforge") {
  return {
    threadId: id,
    accountDomainId: "business-a",
    projectId,
    title: id,
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
    updatedAt: "2026-09-27T20:00:00.000Z"
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

function relay(id, overrides = {}) {
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
    state: "suggested",
    ...overrides
  };
}

async function storeWith(relays) {
  const store = new InMemoryThreadStore("business-a");
  const created = await store.create(thread("thread:one"));
  await store.save({
    threadId: "thread:one",
    expectedRevision: created.revision,
    thread: {
      ...created.thread,
      updatedAt: "2026-09-27T20:10:00.000Z"
    },
    checkpoints: [],
    activities: [],
    relays
  });
  return store;
}

test("normalized edit ratio is deterministic and zero for unchanged text", () => {
  assert.equal(
    normalizedRelayEditRatio(
      "Continue after tests pass.",
      "Continue after tests pass."
    ),
    0
  );

  const first = normalizedRelayEditRatio(
    "Continue after tests pass.",
    "Continue after Preview tests pass."
  );
  const second = normalizedRelayEditRatio(
    "Continue after tests pass.",
    "Continue after Preview tests pass."
  );

  assert.equal(first, second);
  assert.ok(first > 0);
  assert.ok(first <= 1);
});

test("calibration uses explicit Relay outcomes and computes deterministic metrics", async () => {
  const store = await storeWith([
    relay("relay:1", {
      state: "owner_approved",
      finalText: "Continue after tests pass.",
      feedbackAt: "2026-09-27T20:01:00.000Z"
    }),
    relay("relay:2", {
      state: "edited",
      proposedText: "Continue now.",
      finalText: "Continue after tests pass.",
      feedbackAt: "2026-09-27T20:02:00.000Z"
    }),
    relay("relay:3", {
      state: "rejected",
      feedbackAt: "2026-09-27T20:03:00.000Z"
    }),
    relay("relay:4", {
      state: "suggested",
      generatedAt: "2026-09-27T20:04:00.000Z"
    }),
    relay("relay:5", {
      state: "auto_sent",
      finalText: "Continue after tests pass.",
      deliveredAt: "2026-09-27T20:05:00.000Z"
    })
  ]);

  const projection = await new RelayCalibrationService(store).project({
    representedPrincipalId: "principal:owner",
    projectId: "cardforge",
    workClass: "routine_bug",
    policy: {
      minimumResponses: 3,
      minimumAcceptanceRate: 0.5,
      maximumRejectionRate: 0.5,
      maximumMeanEditRatio: 1
    }
  });

  assert.equal(projection.proposedCount, 5);
  assert.equal(projection.pendingSuggestionCount, 1);
  assert.equal(projection.respondedCount, 3);
  assert.equal(projection.approvedUnchangedCount, 1);
  assert.equal(projection.editedCount, 1);
  assert.equal(projection.rejectedCount, 1);
  assert.equal(projection.autoSentCount, 1);
  assert.equal(projection.acceptanceRate, 0.666667);
  assert.equal(projection.editRate, 0.333333);
  assert.equal(projection.rejectionRate, 0.333333);
  assert.ok(
    projection.meanNormalizedEditRatio !== null &&
    projection.meanNormalizedEditRatio > 0
  );
  assert.equal(projection.readiness, "review_candidate");
  assert.match(projection.evidenceFingerprint, /^sha256:[0-9a-f]{64}$/u);
  assert.match(projection.evidenceReference, /^relay-calibration:[0-9a-f]{32}$/u);
});

test("insufficient explicit feedback remains collecting", async () => {
  const store = await storeWith([
    relay("relay:1", {
      state: "owner_approved",
      finalText: "Continue after tests pass.",
      feedbackAt: "2026-09-27T20:01:00.000Z"
    })
  ]);

  const projection = await new RelayCalibrationService(store).project({
    representedPrincipalId: "principal:owner",
    projectId: "cardforge",
    workClass: "routine_bug",
    policy: { minimumResponses: 2 }
  });

  assert.equal(projection.readiness, "collecting");
  assert.match(projection.readinessReasons[0], /1\/2/u);
});

test("calibration is isolated by represented Principal Project and work class", async () => {
  const store = await storeWith([
    relay("relay:owner-cardforge-bug", {
      state: "owner_approved",
      finalText: "Continue after tests pass.",
      feedbackAt: "2026-09-27T20:01:00.000Z"
    }),
    relay("relay:other-principal", {
      representedPrincipalId: "principal:other",
      state: "rejected",
      feedbackAt: "2026-09-27T20:02:00.000Z"
    }),
    relay("relay:other-work-class", {
      workClass: "feature_exploration",
      state: "rejected",
      feedbackAt: "2026-09-27T20:03:00.000Z"
    }),
    relay("relay:other-project", {
      projectId: "other-project",
      state: "rejected",
      feedbackAt: "2026-09-27T20:04:00.000Z"
    })
  ]);

  const projection = await new RelayCalibrationService(store).project({
    representedPrincipalId: "principal:owner",
    projectId: "cardforge",
    workClass: "routine_bug",
    policy: {
      minimumResponses: 1,
      minimumAcceptanceRate: 1,
      maximumRejectionRate: 0,
      maximumMeanEditRatio: 0
    }
  });

  assert.deepEqual(
    projection.evidenceRelayIds,
    ["relay:owner-cardforge-bug"]
  );
  assert.equal(projection.acceptanceRate, 1);
  assert.equal(projection.rejectionRate, 0);
  assert.equal(projection.readiness, "review_candidate");
});

test("evidence fingerprint changes when relevant owner feedback changes", async () => {
  const approvedStore = await storeWith([
    relay("relay:1", {
      state: "owner_approved",
      finalText: "Continue after tests pass.",
      feedbackAt: "2026-09-27T20:01:00.000Z"
    })
  ]);
  const editedStore = await storeWith([
    relay("relay:1", {
      state: "edited",
      finalText: "Continue after Preview tests pass.",
      feedbackAt: "2026-09-27T20:01:00.000Z"
    })
  ]);

  const query = {
    representedPrincipalId: "principal:owner",
    projectId: "cardforge",
    workClass: "routine_bug"
  };

  const approved = await new RelayCalibrationService(
    approvedStore
  ).project(query);
  const edited = await new RelayCalibrationService(
    editedStore
  ).project(query);

  assert.notEqual(
    approved.evidenceFingerprint,
    edited.evidenceFingerprint
  );
});

test("poor explicit feedback is not ready for autonomy review", async () => {
  const store = await storeWith([
    relay("relay:1", {
      state: "rejected",
      feedbackAt: "2026-09-27T20:01:00.000Z"
    }),
    relay("relay:2", {
      state: "edited",
      proposedText: "Continue.",
      finalText:
        "Stop, investigate the architecture contradiction, and wait for me.",
      feedbackAt: "2026-09-27T20:02:00.000Z"
    })
  ]);

  const projection = await new RelayCalibrationService(store).project({
    representedPrincipalId: "principal:owner",
    projectId: "cardforge",
    workClass: "routine_bug",
    policy: {
      minimumResponses: 2,
      minimumAcceptanceRate: 0.9,
      maximumRejectionRate: 0.05,
      maximumMeanEditRatio: 0.25
    }
  });

  assert.equal(projection.readiness, "not_ready");
  assert.ok(projection.readinessReasons.length >= 2);
});
