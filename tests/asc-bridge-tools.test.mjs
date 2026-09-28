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

  const bridge = new BridgedThreadService(
    new InMemoryThreadStore("business-a"),
    projects
  );
  return {
    directory,
    tools: new AscBridgeToolService({
      bridge,
      identities,
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
          provider: "chatgpt"
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
        provider: "chatgpt"
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
