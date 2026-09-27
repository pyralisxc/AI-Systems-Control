import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  BridgedThreadError,
  BridgedThreadService,
  InMemoryThreadStore,
  PersistentIdentityRegistry,
  PersistentProjectRegistry
} from "../dist/application/index.js";
import {
  JsonFileControlRegistryStore,
  JsonFileIdentityDirectoryStore
} from "../dist/adapters/index.js";

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "asc-bridge-"));
  const identities = new PersistentIdentityRegistry(
    new JsonFileIdentityDirectoryStore(join(directory, "identity.json"))
  );
  await identities.bootstrapPersonal({
    principalId: "principal:owner",
    principalDisplayName: "Owner",
    accountDomainId: "business-a",
    accountDomainName: "Business A"
  });

  const control = new JsonFileControlRegistryStore(
    join(directory, "control.json"),
    "business-a"
  );
  const projects = new PersistentProjectRegistry(control, identities);
  await projects.resolveOrRegisterGithubProject({
    projectId: "cardforge",
    accountDomainId: "business-a",
    repository: "owner/cardforge"
  });

  const store = new InMemoryThreadStore("business-a");
  return {
    directory,
    store,
    service: new BridgedThreadService(store, projects)
  };
}

test("bridged external Thread registers with honest runtime limitations", async () => {
  const context = await setup();
  try {
    const thread = await context.service.registerExternal({
      projectId: "cardforge",
      title: "CardForge Studio",
      mode: "bridged",
      provider: "chatgpt",
      externalThreadId: "chat-123",
      navigationUrl: "https://chatgpt.com/c/example"
    });

    assert.equal(thread.mode, "bridged");
    assert.equal(thread.runtimeCapabilities.canPublishCheckpoint, true);
    assert.equal(thread.runtimeCapabilities.canSteer, false);
    assert.equal(thread.runtimeCapabilities.canStopRuntime, false);
    assert.equal(thread.runtimeCapabilities.canAutoSendRelay, false);
  } finally {
    await rm(context.directory, { recursive: true, force: true });
  }
});

test("external-only Thread cannot publish a checkpoint", async () => {
  const context = await setup();
  try {
    const thread = await context.service.registerExternal({
      projectId: "cardforge",
      title: "Reference only",
      mode: "external",
      provider: "chatgpt"
    });

    await assert.rejects(
      () => context.service.publishCheckpoint({
        threadId: thread.threadId,
        synopsis: "This should not publish."
      }),
      /cannot publish checkpoints/i
    );
  } finally {
    await rm(context.directory, { recursive: true, force: true });
  }
});

test("checkpoint carries exact owner/relay provenance and drives Needs You", async () => {
  const context = await setup();
  try {
    const thread = await context.service.registerExternal({
      projectId: "cardforge",
      title: "Studio",
      provider: "chatgpt"
    });
    const checkpoint = await context.service.publishCheckpoint({
      threadId: thread.threadId,
      synopsis: "Preview is proven; Main needs owner review.",
      gate: "owner",
      workReferences: ["github:issue:42"],
      evidenceReferences: ["di:checkpoint:abc"],
      lastSteering: {
        actor: "founder_relay",
        principalId: "principal:owner",
        text: "Battle-test Preview and stop before Main."
      },
      publishedAt: "2026-09-27T19:00:00.000Z"
    });

    assert.equal(checkpoint.lastSteering?.actor, "founder_relay");
    const pulse = await context.service.getPulse(
      thread.threadId,
      "2026-09-27T19:01:00.000Z"
    );
    assert.equal(pulse.status, "needs_you");
  } finally {
    await rm(context.directory, { recursive: true, force: true });
  }
});

test("owner synopsis refinement supersedes rather than rewrites checkpoint history", async () => {
  const context = await setup();
  try {
    const thread = await context.service.registerExternal({
      projectId: "cardforge",
      title: "Studio",
      provider: "chatgpt"
    });
    const first = await context.service.publishCheckpoint({
      threadId: thread.threadId,
      synopsis: "First synopsis.",
      publishedAt: "2026-09-27T19:00:00.000Z"
    });
    const refined = await context.service.refineSynopsis({
      threadId: thread.threadId,
      checkpointId: first.checkpointId,
      synopsis: "Owner-refined synopsis.",
      principalId: "principal:owner",
      publishedAt: "2026-09-27T19:01:00.000Z"
    });

    assert.equal(refined.supersedesCheckpointId, first.checkpointId);
    assert.equal(refined.publishedByPrincipalId, "principal:owner");

    const snapshot = await context.service.getThread(thread.threadId);
    assert.equal(snapshot?.checkpoints.length, 2);
    assert.equal(snapshot?.checkpoints[0]?.synopsis, "First synopsis.");
    assert.equal(snapshot?.checkpoints[1]?.synopsis, "Owner-refined synopsis.");
  } finally {
    await rm(context.directory, { recursive: true, force: true });
  }
});

test("real repeated failure activities project Possible Loop", async () => {
  const context = await setup();
  try {
    const thread = await context.service.registerExternal({
      projectId: "cardforge",
      title: "Studio",
      provider: "chatgpt"
    });
    for (let index = 0; index < 3; index += 1) {
      await context.service.recordActivity({
        threadId: thread.threadId,
        kind: "tool_failure",
        source: "conductor",
        signature: "browser:same-auth-failure",
        occurredAt: "2026-09-27T19:00:0" + index + ".000Z"
      });
    }

    const pulse = await context.service.getPulse(
      thread.threadId,
      "2026-09-27T19:01:00.000Z"
    );
    assert.equal(pulse.status, "possible_loop");
    assert.equal(pulse.repeatedFailureCount, 3);
  } finally {
    await rm(context.directory, { recursive: true, force: true });
  }
});

test("owner-channel steering without Principal provenance fails closed", async () => {
  const context = await setup();
  try {
    const thread = await context.service.registerExternal({
      projectId: "cardforge",
      title: "Studio",
      provider: "chatgpt"
    });

    await assert.rejects(
      () => context.service.publishCheckpoint({
        threadId: thread.threadId,
        synopsis: "Bad provenance",
        lastSteering: {
          actor: "founder_relay",
          text: "Continue."
        }
      }),
      BridgedThreadError
    );
  } finally {
    await rm(context.directory, { recursive: true, force: true });
  }
});
