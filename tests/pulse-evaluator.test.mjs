import assert from "node:assert/strict";
import test from "node:test";

import { derivePulseStatus } from "../dist/application/index.js";

function thread(overrides = {}) {
  return {
    threadId: "thread:one",
    accountDomainId: "business-a",
    projectId: "cardforge",
    title: "CardForge Studio",
    mode: "bridged",
    lifecycle: "active",
    runtimeCapabilities: {
      canPublishCheckpoint: true,
      canSteer: false,
      canInterrupt: false,
      canStopRuntime: false,
      canAutoSendRelay: false
    },
    createdAt: "2026-09-27T18:00:00.000Z",
    updatedAt: "2026-09-27T18:00:00.000Z",
    ...overrides
  };
}

function activity(kind, occurredAt, overrides = {}) {
  return {
    activityId: "activity:" + occurredAt + ":" + kind,
    threadId: "thread:one",
    accountDomainId: "business-a",
    occurredAt,
    kind,
    source: "test-runtime",
    ...overrides
  };
}

test("recent observable progress projects Working", () => {
  const pulse = derivePulseStatus({
    thread: thread(),
    checkpoints: [],
    activities: [
      activity("meaningful_progress", "2026-09-27T18:01:00.000Z")
    ],
    now: "2026-09-27T18:02:00.000Z"
  });
  assert.equal(pulse.status, "working");
});

test("owner gate projects Needs You", () => {
  const pulse = derivePulseStatus({
    thread: thread(),
    checkpoints: [{
      checkpointId: "checkpoint:1",
      threadId: "thread:one",
      accountDomainId: "business-a",
      publishedAt: "2026-09-27T18:03:00.000Z",
      synopsis: "Preview passed; Main promotion needs owner.",
      gate: "owner",
      workReferences: [],
      evidenceReferences: []
    }],
    activities: [],
    now: "2026-09-27T18:04:00.000Z"
  });
  assert.equal(pulse.status, "needs_you");
});

test("explicit blocker projects Blocked", () => {
  const pulse = derivePulseStatus({
    thread: thread(),
    checkpoints: [{
      checkpointId: "checkpoint:blocked",
      threadId: "thread:one",
      accountDomainId: "business-a",
      publishedAt: "2026-09-27T18:03:00.000Z",
      synopsis: "Provider auth cannot proceed.",
      gate: "blocked",
      blocker: "missing provider authorization",
      workReferences: [],
      evidenceReferences: []
    }],
    activities: [],
    now: "2026-09-27T18:04:00.000Z"
  });
  assert.equal(pulse.status, "blocked");
  assert.match(pulse.reason, /missing provider authorization/i);
});

test("three repeated failures without progress project Possible Loop", () => {
  const pulse = derivePulseStatus({
    thread: thread(),
    checkpoints: [],
    activities: [
      activity("tool_failure", "2026-09-27T18:01:00.000Z", {
        signature: "vercel:permission-denied"
      }),
      activity("tool_failure", "2026-09-27T18:01:10.000Z", {
        signature: "vercel:permission-denied"
      }),
      activity("tool_failure", "2026-09-27T18:01:20.000Z", {
        signature: "vercel:permission-denied"
      })
    ],
    now: "2026-09-27T18:02:00.000Z"
  });
  assert.equal(pulse.status, "possible_loop");
  assert.equal(pulse.repeatedFailureCount, 3);
});

test("meaningful progress resets repeated-failure loop detection", () => {
  const pulse = derivePulseStatus({
    thread: thread(),
    checkpoints: [],
    activities: [
      activity("tool_failure", "2026-09-27T18:01:00.000Z", {
        signature: "same-error"
      }),
      activity("tool_failure", "2026-09-27T18:01:10.000Z", {
        signature: "same-error"
      }),
      activity("meaningful_progress", "2026-09-27T18:01:15.000Z"),
      activity("tool_failure", "2026-09-27T18:01:20.000Z", {
        signature: "same-error"
      })
    ],
    now: "2026-09-27T18:02:00.000Z"
  });
  assert.equal(pulse.status, "working");
});

test("old active thread activity projects Stalled", () => {
  const pulse = derivePulseStatus({
    thread: thread(),
    checkpoints: [],
    activities: [
      activity("heartbeat", "2026-09-27T17:00:00.000Z")
    ],
    now: "2026-09-27T18:00:01.000Z",
    stallAfterSeconds: 900
  });
  assert.equal(pulse.status, "stalled");
});
