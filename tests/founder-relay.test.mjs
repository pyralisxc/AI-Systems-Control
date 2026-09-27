import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  BridgedThreadService,
  ContinuationAuthorityService,
  FounderRelayError,
  FounderRelayService,
  PersistentIdentityRegistry,
  PersistentProjectRegistry,
  WorkerAuthorityService
} from "../dist/application/index.js";
import {
  JsonFileControlRegistryStore,
  JsonFileIdentityDirectoryStore,
  JsonFileThreadStore
} from "../dist/adapters/index.js";

class FakeRelayDelivery {
  deliveries = new Map();

  canDeliver(thread) {
    return (
      thread.mode === "managed" &&
      thread.runtimeCapabilities.canAutoSendRelay === true
    );
  }

  async deliver(input) {
    const existing = this.deliveries.get(input.relayId);
    if (existing) return existing;

    const result = {
      deliveredAt: "2026-09-27T20:00:00.000Z",
      deliveryRef: "delivery:" + input.relayId
    };
    this.deliveries.set(input.relayId, result);
    return result;
  }
}

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "asc-founder-relay-"));
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
    principalId: "principal:generator",
    kind: "service",
    displayName: "Founder Relay Generator"
  });
  await identities.registerMembership({
    principalId: "principal:generator",
    accountDomainId: "business-a",
    roles: ["operator"]
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

  await identities.registerAccountDomain({
    accountDomainId: "business-b",
    kind: "organization",
    name: "Business B"
  });
  await identities.registerPrincipal({
    principalId: "principal:other-domain-owner",
    kind: "human",
    displayName: "Other Domain Owner"
  });
  await identities.registerMembership({
    principalId: "principal:other-domain-owner",
    accountDomainId: "business-b",
    roles: ["owner"]
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

  const threadPath = join(directory, "threads.json");
  const threadStore = new JsonFileThreadStore(threadPath, "business-a");
  const bridge = new BridgedThreadService(threadStore, projects);
  const continuation = new ContinuationAuthorityService(
    controlStore,
    identities
  );
  const workers = new WorkerAuthorityService(controlStore, identities);
  const delivery = new FakeRelayDelivery();

  return {
    directory,
    threadPath,
    identities,
    controlStore,
    projects,
    threadStore,
    bridge,
    continuation,
    workers,
    delivery,
    relay: new FounderRelayService({
      threadStore,
      identities,
      continuation,
      delivery
    })
  };
}

async function createBridged(context) {
  return context.bridge.registerExternal({
    projectId: "cardforge",
    title: "CardForge Studio",
    mode: "bridged",
    provider: "chatgpt",
    externalThreadId: "chat-123"
  });
}

async function createManaged(context) {
  const now = "2026-09-27T19:30:00.000Z";
  const thread = {
    threadId: "thread:managed",
    accountDomainId: "business-a",
    projectId: "cardforge",
    title: "Managed CardForge",
    mode: "managed",
    lifecycle: "active",
    runtimeCapabilities: {
      canPublishCheckpoint: true,
      canSteer: true,
      canInterrupt: true,
      canStopRuntime: true,
      canAutoSendRelay: true
    },
    createdAt: now,
    updatedAt: now
  };
  await context.threadStore.create(thread);
  return thread;
}

async function grantReadRelayAuthority(context, threadId) {
  await context.continuation.createEnvelope({
    projectId: "cardforge",
    threadId,
    objectiveRef: "relay:refinement",
    scopeFingerprint: "sha256:relay-refinement",
    workClasses: ["refinement"],
    allowedEffects: ["read"],
    repositoryBoundary: "read_only",
    continuationPolicy: "continue_until_gate",
    createdByPrincipalId: "principal:owner",
    createdAt: "2026-09-27T19:31:00.000Z"
  });
  return context.continuation.grantAutonomy({
    projectId: "cardforge",
    workClass: "refinement",
    level: 2,
    repositoryCeiling: "read_only",
    grantedByPrincipalId: "principal:owner",
    evidenceBasisRefs: ["owner:relay-training"],
    grantedAt: "2026-09-27T19:31:01.000Z"
  });
}

function proposal(threadId, overrides = {}) {
  return {
    threadId,
    representedPrincipalId: "principal:owner",
    generatedByPrincipalId: "principal:generator",
    proposedText: "Keep battle-testing this before changing direction.",
    workClass: "refinement",
    requestedEffect: "read",
    requestedRepositoryBoundary: "read_only",
    generatedAt: "2026-09-27T19:32:00.000Z",
    ...overrides
  };
}

test("suggestion can exist without execution authority and surfaces owner attention", async () => {
  const context = await setup();
  try {
    const thread = await createBridged(context);
    const relay = await context.relay.propose(proposal(thread.threadId));

    assert.equal(relay.state, "suggested");
    assert.equal(relay.proposalMode, "suggest");
    assert.equal(relay.proposalAuthority.decision, "needs_owner");

    const pulse = await context.bridge.getPulse(
      thread.threadId,
      "2026-09-27T19:33:00.000Z"
    );
    assert.equal(pulse.status, "needs_you");
  } finally {
    await rm(context.directory, { recursive: true, force: true });
  }
});

test("represented Principal must be an active human owner/admin in the same AccountDomain", async () => {
  const context = await setup();
  try {
    const thread = await createBridged(context);

    await assert.rejects(
      () => context.relay.propose(proposal(thread.threadId, {
        representedPrincipalId: "principal:service-owner"
      })),
      /active human Principal/i
    );
    await assert.rejects(
      () => context.relay.propose(proposal(thread.threadId, {
        representedPrincipalId: "principal:other-domain-owner"
      })),
      /lacks active owner\/admin authority/i
    );
  } finally {
    await rm(context.directory, { recursive: true, force: true });
  }
});

test("approve edit and reject preserve original proposal plus owner correction provenance", async () => {
  const context = await setup();
  try {
    const thread = await createBridged(context);
    const approved = await context.relay.propose(proposal(thread.threadId, {
      proposedText: "Approved original."
    }));
    const edited = await context.relay.propose(proposal(thread.threadId, {
      proposedText: "Draft to edit.",
      generatedAt: "2026-09-27T19:32:01.000Z"
    }));
    const rejected = await context.relay.propose(proposal(thread.threadId, {
      proposedText: "Bad draft.",
      generatedAt: "2026-09-27T19:32:02.000Z"
    }));

    const a = await context.relay.feedback({
      threadId: thread.threadId,
      relayId: approved.relayId,
      principalId: "principal:owner",
      action: "approve",
      feedbackAt: "2026-09-27T19:33:00.000Z"
    });
    const e = await context.relay.feedback({
      threadId: thread.threadId,
      relayId: edited.relayId,
      principalId: "principal:owner",
      action: "edit",
      editedText: "Owner-corrected direction.",
      feedbackAt: "2026-09-27T19:33:01.000Z"
    });
    const r = await context.relay.feedback({
      threadId: thread.threadId,
      relayId: rejected.relayId,
      principalId: "principal:owner",
      action: "reject",
      feedbackAt: "2026-09-27T19:33:02.000Z"
    });

    assert.equal(a.state, "owner_approved");
    assert.equal(a.proposedText, "Approved original.");
    assert.equal(a.finalText, "Approved original.");
    assert.equal(a.ownerFeedbackPrincipalId, "principal:owner");

    assert.equal(e.state, "edited");
    assert.equal(e.proposedText, "Draft to edit.");
    assert.equal(e.finalText, "Owner-corrected direction.");
    assert.equal(e.ownerFeedbackPrincipalId, "principal:owner");

    assert.equal(r.state, "rejected");
    assert.equal(r.proposedText, "Bad draft.");
    assert.equal(r.finalText, undefined);
  } finally {
    await rm(context.directory, { recursive: true, force: true });
  }
});

test("another human cannot approve text represented as the owner", async () => {
  const context = await setup();
  try {
    const thread = await createBridged(context);
    const relay = await context.relay.propose(proposal(thread.threadId));

    await assert.rejects(
      () => context.relay.feedback({
        threadId: thread.threadId,
        relayId: relay.relayId,
        principalId: "principal:other-admin",
        action: "approve"
      }),
      /Only the represented human Principal/i
    );
  } finally {
    await rm(context.directory, { recursive: true, force: true });
  }
});

test("managed auto-candidate re-evaluates authority then records real delivery", async () => {
  const context = await setup();
  try {
    const thread = await createManaged(context);
    await grantReadRelayAuthority(context, thread.threadId);

    const relay = await context.relay.propose(proposal(thread.threadId, {
      proposalMode: "auto_candidate"
    }));
    assert.equal(relay.proposalAuthority.decision, "allow");

    const result = await context.relay.autoSend({
      threadId: thread.threadId,
      relayId: relay.relayId,
      now: "2026-09-27T19:33:00.000Z"
    });

    assert.equal(result.sent, true);
    assert.equal(result.relay.state, "auto_sent");
    assert.equal(result.relay.finalText, relay.proposedText);
    assert.equal(result.relay.deliveryAuthority?.decision, "allow");
    assert.equal(
      result.relay.deliveryRef,
      "delivery:" + relay.relayId
    );
    assert.equal(context.delivery.deliveries.size, 1);
  } finally {
    await rm(context.directory, { recursive: true, force: true });
  }
});

test("owner STOP after proposal prevents auto-send and never calls transport", async () => {
  const context = await setup();
  try {
    const thread = await createManaged(context);
    await grantReadRelayAuthority(context, thread.threadId);
    const relay = await context.relay.propose(proposal(thread.threadId, {
      proposalMode: "auto_candidate"
    }));

    await context.workers.stopProject({
      projectId: "cardforge",
      changedByPrincipalId: "principal:owner",
      changedAt: "2026-09-27T19:32:30.000Z"
    });

    const result = await context.relay.autoSend({
      threadId: thread.threadId,
      relayId: relay.relayId,
      now: "2026-09-27T19:33:00.000Z"
    });

    assert.equal(result.sent, false);
    assert.equal(result.relay.state, "suggested");
    assert.equal(result.relay.deliveryAuthority?.decision, "blocked");
    assert.equal(context.delivery.deliveries.size, 0);
  } finally {
    await rm(context.directory, { recursive: true, force: true });
  }
});

test("grant review after proposal prevents auto-send", async () => {
  const context = await setup();
  try {
    const thread = await createManaged(context);
    const grant = await grantReadRelayAuthority(context, thread.threadId);
    const relay = await context.relay.propose(proposal(thread.threadId, {
      proposalMode: "auto_candidate"
    }));

    await context.continuation.setGrantState({
      grantId: grant.grantId,
      state: "needs_review",
      changedByPrincipalId: "principal:owner"
    });

    const result = await context.relay.autoSend({
      threadId: thread.threadId,
      relayId: relay.relayId,
      now: "2026-09-27T19:33:00.000Z"
    });

    assert.equal(result.sent, false);
    assert.equal(result.relay.deliveryAuthority?.decision, "needs_owner");
    assert.equal(context.delivery.deliveries.size, 0);
  } finally {
    await rm(context.directory, { recursive: true, force: true });
  }
});

test("bridged external Thread cannot be mislabeled auto-sent without send-capable transport", async () => {
  const context = await setup();
  try {
    const thread = await createBridged(context);
    await grantReadRelayAuthority(context, thread.threadId);
    const relay = await context.relay.propose(proposal(thread.threadId, {
      proposalMode: "auto_candidate"
    }));

    const result = await context.relay.autoSend({
      threadId: thread.threadId,
      relayId: relay.relayId,
      now: "2026-09-27T19:33:00.000Z"
    });

    assert.equal(result.sent, false);
    assert.match(result.reason, /cannot deliver/i);
    assert.equal(result.relay.state, "suggested");
    assert.equal(result.relay.deliveryAuthority?.decision, "allow");
    assert.equal(context.delivery.deliveries.size, 0);

    const pulse = await context.bridge.getPulse(
      thread.threadId,
      "2026-09-27T19:33:10.000Z"
    );
    assert.equal(pulse.status, "needs_you");
    assert.match(pulse.reason, /owner/i);
  } finally {
    await rm(context.directory, { recursive: true, force: true });
  }
});

test("Relay records survive ThreadStore restart", async () => {
  const context = await setup();
  try {
    const thread = await createBridged(context);
    const relay = await context.relay.propose(proposal(thread.threadId));

    const restarted = new JsonFileThreadStore(
      context.threadPath,
      "business-a"
    );
    const snapshot = await restarted.load(thread.threadId);

    assert.equal(snapshot?.relays.length, 1);
    assert.equal(snapshot?.relays[0]?.relayId, relay.relayId);
    assert.equal(
      snapshot?.relays[0]?.representedPrincipalId,
      "principal:owner"
    );
  } finally {
    await rm(context.directory, { recursive: true, force: true });
  }
});
