import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  AscBridgeToolService,
  BridgeToolAuthorizationError,
  BridgedThreadService,
  InMemoryThreadStore,
  PersistentIdentityRegistry,
  PersistentProjectMembershipRegistry,
  PersistentProjectRegistry
} from "../dist/application/index.js";
import {
  JsonFileControlRegistryStore,
  JsonFileIdentityDirectoryStore
} from "../dist/adapters/index.js";

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "asc-bridge-tools-"));
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
    principalId: "principal:bridge",
    kind: "service",
    displayName: "ChatGPT Bridge"
  });
  await identities.registerMembership({
    principalId: "principal:bridge",
    accountDomainId: "business-a",
    roles: ["operator"]
  });
  await identities.registerPrincipal({
    principalId: "principal:viewer",
    kind: "human",
    displayName: "Viewer"
  });
  const viewerMembership =
    await identities.registerMembership({
      principalId: "principal:viewer",
      accountDomainId: "business-a",
      roles: ["viewer"]
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
  await projects.resolveOrRegisterGithubProject({
    projectId: "restricted",
    accountDomainId: "business-a",
    repository: "owner/restricted"
  });

  const projectMemberships =
    new PersistentProjectMembershipRegistry(
      control,
      identities
    );
  const bridgeMembership =
    await identities.getMembership(
      "principal:bridge",
      "business-a"
    );
  await projectMemberships.grant({
    authorizedByPrincipalId:
      "principal:owner",
    membershipId:
      bridgeMembership.membershipId,
    projectId: "cardforge",
    roles: ["operator"]
  });
  await projectMemberships.grant({
    authorizedByPrincipalId:
      "principal:owner",
    membershipId:
      viewerMembership.membershipId,
    projectId: "cardforge",
    roles: ["viewer"]
  });

  const bridge = new BridgedThreadService(
    new InMemoryThreadStore("business-a"),
    projects
  );
  return {
    directory,
    bridge,
    tools: new AscBridgeToolService({
      bridge,
      identities,
      projectMemberships,
      accountDomainId: "business-a"
    })
  };
}

test("service operator can register and publish observable bridge data", async () => {
  const context = await setup();
  try {
    const caller = {
      principalId: "principal:bridge",
      source: "chatgpt-plugin"
    };
    const thread = await context.tools.call(
      "thread.register_external",
      {
        title: "CardForge Studio",
        provider: "chatgpt",
        projectId: "cardforge",
        mode: "bridged",
        externalThreadId: "chat-123",
        navigationUrl: "https://chatgpt.com/c/example"
      },
      caller
    );

    const threadId = thread.threadId;
    const registered = await context.tools.call(
      "thread.get",
      { threadId },
      caller
    );
    assert.equal(
      registered.thread.externalReference.navigationUrl,
      "https://chatgpt.com/c/example"
    );
    assert.equal(
      registered.thread.externalReference.externalThreadId,
      "chat-123"
    );

    await context.tools.call(
      "thread.publish_checkpoint",
      {
        threadId,
        synopsis: "Testing Preview.",
        evidenceReferences: ["di:checkpoint:1"]
      },
      caller
    );
    await context.tools.call(
      "thread.publish_activity",
      {
        threadId,
        kind: "tool_failure",
        signature: "same-error"
      },
      caller
    );

    const pulses = await context.tools.call(
      "thread.list_pulse",
      {},
      caller
    );
    assert.equal(pulses.length, 1);
  } finally {
    await rm(context.directory, { recursive: true, force: true });
  }
});

test("viewer cannot publish bridge state", async () => {
  const context = await setup();
  try {
    await assert.rejects(
      () => context.tools.call(
        "thread.register_external",
        {
          title: "Nope",
          provider: "chatgpt",
          projectId: "cardforge"
        },
        {
          principalId: "principal:viewer",
          source: "chatgpt-plugin"
        }
      ),
      BridgeToolAuthorizationError
    );
  } finally {
    await rm(context.directory, { recursive: true, force: true });
  }
});

test("bridge service Principal cannot impersonate literal owner steering", async () => {
  const context = await setup();
  try {
    const caller = {
      principalId: "principal:bridge",
      source: "chatgpt-plugin"
    };
    const thread = await context.tools.call(
      "thread.register_external",
      {
        title: "Studio",
        provider: "chatgpt",
        projectId: "cardforge"
      },
      caller
    );

    await assert.rejects(
      () => context.tools.call(
        "thread.publish_checkpoint",
        {
          threadId: thread.threadId,
          synopsis: "Bad owner attribution.",
          lastSteering: {
            actor: "owner",
            principalId: "principal:owner",
            text: "Continue."
          }
        },
        caller
      ),
      /must match the authenticated caller/i
    );
  } finally {
    await rm(context.directory, { recursive: true, force: true });
  }
});

test("Founder Relay publication is denied until Relay authorization exists", async () => {
  const context = await setup();
  try {
    const owner = {
      principalId: "principal:owner",
      source: "chatgpt-plugin"
    };
    const thread = await context.tools.call(
      "thread.register_external",
      {
        title: "Studio",
        provider: "chatgpt"
      },
      owner
    );

    await assert.rejects(
      () => context.tools.call(
        "thread.publish_checkpoint",
        {
          threadId: thread.threadId,
          synopsis: "Relay attempt.",
          lastSteering: {
            actor: "founder_relay",
            principalId: "principal:owner",
            text: "Continue."
          }
        },
        owner
      ),
      /future Relay authorization policy/i
    );
  } finally {
    await rm(context.directory, { recursive: true, force: true });
  }
});

test("human owner can refine synopsis without rewriting prior checkpoint", async () => {
  const context = await setup();
  try {
    const owner = {
      principalId: "principal:owner",
      source: "owner-ui"
    };
    const thread = await context.tools.call(
      "thread.register_external",
      {
        title: "Studio",
        provider: "chatgpt"
      },
      owner
    );
    const checkpoint = await context.tools.call(
      "thread.publish_checkpoint",
      {
        threadId: thread.threadId,
        synopsis: "Initial."
      },
      owner
    );
    const refined = await context.tools.call(
      "thread.refine_synopsis",
      {
        threadId: thread.threadId,
        checkpointId: checkpoint.checkpointId,
        synopsis: "Refined by owner."
      },
      owner
    );

    assert.equal(refined.supersedesCheckpointId, checkpoint.checkpointId);
    assert.equal(refined.publishedByPrincipalId, "principal:owner");
  } finally {
    await rm(context.directory, { recursive: true, force: true });
  }
});


test("ProjectMembership filters Pulse and direct Thread reads inside one AccountDomain", async () => {
  const context = await setup();
  try {
    const visible =
      await context.bridge.registerExternal({
        projectId: "cardforge",
        title: "Visible",
        provider: "chatgpt"
      });
    const hidden =
      await context.bridge.registerExternal({
        projectId: "restricted",
        title: "Hidden",
        provider: "chatgpt"
      });
    const unbound =
      await context.bridge.registerExternal({
        title: "Tenant admin only",
        provider: "chatgpt"
      });

    const caller = {
      principalId: "principal:bridge",
      source: "chatgpt-plugin"
    };
    const pulses = await context.tools.call(
      "thread.list_pulse",
      {},
      caller
    );
    assert.deepEqual(
      pulses.map((pulse) => pulse.threadId),
      [visible.threadId]
    );

    await assert.rejects(
      () =>
        context.tools.call(
          "thread.get",
          { threadId: hidden.threadId },
          caller
        ),
      /Thread is unavailable/i
    );
    await assert.rejects(
      () =>
        context.tools.call(
          "thread.get",
          { threadId: unbound.threadId },
          caller
        ),
      /Thread is unavailable/i
    );
  } finally {
    await rm(
      context.directory,
      { recursive: true, force: true }
    );
  }
});

test("Project viewer can read a Thread but cannot publish into it", async () => {
  const context = await setup();
  try {
    const thread =
      await context.bridge.registerExternal({
        projectId: "cardforge",
        title: "Readable",
        provider: "chatgpt"
      });
    const viewer = {
      principalId: "principal:viewer",
      source: "chatgpt-plugin"
    };

    const snapshot = await context.tools.call(
      "thread.get",
      { threadId: thread.threadId },
      viewer
    );
    assert.equal(
      snapshot.thread.threadId,
      thread.threadId
    );

    await assert.rejects(
      () =>
        context.tools.call(
          "thread.publish_activity",
          {
            threadId: thread.threadId,
            kind: "heartbeat"
          },
          viewer
        ),
      /Thread is unavailable/i
    );
  } finally {
    await rm(
      context.directory,
      { recursive: true, force: true }
    );
  }
});
