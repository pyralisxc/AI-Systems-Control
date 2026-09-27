import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  JsonFileThreadStore,
  PostgresThreadStore
} from "../dist/adapters/index.js";
import { ThreadRevisionConflictError } from "../dist/ports/index.js";

function thread(id, domain = "business-a") {
  return {
    threadId: id,
    accountDomainId: domain,
    title: "Thread " + id,
    mode: "bridged",
    lifecycle: "active",
    runtimeCapabilities: {
      canPublishCheckpoint: true,
      canSteer: false,
      canInterrupt: false,
      canStopRuntime: false,
      canAutoSendRelay: false
    },
    createdAt: "2026-09-27T19:00:00.000Z",
    updatedAt: "2026-09-27T19:00:00.000Z"
  };
}

test("JSON ThreadStore survives restart with checkpoint/activity history", async () => {
  const directory = await mkdtemp(join(tmpdir(), "asc-thread-store-"));
  const path = join(directory, "threads.json");
  try {
    const first = new JsonFileThreadStore(path, "business-a");
    const created = await first.create(thread("thread:one"));

    await first.save({
      threadId: "thread:one",
      expectedRevision: created.revision,
      thread: {
        ...created.thread,
        updatedAt: "2026-09-27T19:01:00.000Z"
      },
      checkpoints: [{
        checkpointId: "checkpoint:one",
        threadId: "thread:one",
        accountDomainId: "business-a",
        publishedAt: "2026-09-27T19:01:00.000Z",
        synopsis: "Durable checkpoint.",
        gate: "none",
        workReferences: [],
        evidenceReferences: []
      }],
      activities: [{
        activityId: "activity:one",
        threadId: "thread:one",
        accountDomainId: "business-a",
        occurredAt: "2026-09-27T19:01:00.000Z",
        kind: "checkpoint",
        source: "asc-bridge"
      }],
      relays: []
    });

    const restarted = new JsonFileThreadStore(path, "business-a");
    const loaded = await restarted.load("thread:one");
    assert.equal(loaded?.revision, 2);
    assert.equal(loaded?.checkpoints[0]?.synopsis, "Durable checkpoint.");
    assert.equal(loaded?.activities[0]?.kind, "checkpoint");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("JSON ThreadStore rejects cross-domain Thread data", async () => {
  const directory = await mkdtemp(join(tmpdir(), "asc-thread-store-"));
  try {
    const store = new JsonFileThreadStore(
      join(directory, "threads.json"),
      "business-a"
    );
    await assert.rejects(
      () => store.create(thread("thread:wrong", "business-b")),
      /not store business-a/i
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

class FakePostgresClient {
  rows = new Map();

  key(domain, threadId) {
    return domain + "\u0000" + threadId;
  }

  async query(text, values = []) {
    if (text.startsWith("CREATE TABLE")) {
      return { rowCount: null, rows: [] };
    }

    if (
      text.startsWith("SELECT revision, payload FROM asc_thread_state") &&
      text.includes("thread_id = $2")
    ) {
      const row = this.rows.get(this.key(values[0], values[1]));
      return { rowCount: row ? 1 : 0, rows: row ? [row] : [] };
    }

    if (text.startsWith("SELECT revision, payload FROM asc_thread_state")) {
      const prefix = values[0] + "\u0000";
      const rows = [...this.rows.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .map(([, row]) => row);
      return { rowCount: rows.length, rows };
    }

    if (text.startsWith("INSERT INTO asc_thread_state")) {
      const key = this.key(values[0], values[1]);
      if (this.rows.has(key)) return { rowCount: 0, rows: [] };
      const row = {
        revision: 1,
        payload: JSON.parse(values[2]),
        updated_at: values[3]
      };
      this.rows.set(key, row);
      return { rowCount: 1, rows: [row] };
    }

    if (text.startsWith("UPDATE asc_thread_state")) {
      const key = this.key(values[0], values[1]);
      const current = this.rows.get(key);
      if (!current || current.revision !== Number(values[4])) {
        return { rowCount: 0, rows: [] };
      }
      const row = {
        revision: current.revision + 1,
        payload: JSON.parse(values[2]),
        updated_at: values[3]
      };
      this.rows.set(key, row);
      return { rowCount: 1, rows: [row] };
    }

    throw new Error("Unexpected SQL: " + text);
  }
}

test("Postgres ThreadStore isolates AccountDomains", async () => {
  const client = new FakePostgresClient();
  const first = new PostgresThreadStore(client, "business-a");
  const second = new PostgresThreadStore(client, "business-b");

  await first.create(thread("thread:same", "business-a"));
  await second.create(thread("thread:same", "business-b"));

  assert.equal((await first.list()).length, 1);
  assert.equal((await second.list()).length, 1);
  assert.equal((await first.load("thread:same"))?.thread.accountDomainId, "business-a");
  assert.equal((await second.load("thread:same"))?.thread.accountDomainId, "business-b");
});

test("Postgres ThreadStore uses per-thread optimistic revision", async () => {
  const client = new FakePostgresClient();
  const first = new PostgresThreadStore(client, "business-a");
  const second = new PostgresThreadStore(client, "business-a");

  const created = await first.create(thread("thread:one"));
  const stale = await second.load("thread:one");
  assert.equal(stale?.revision, created.revision);

  await first.save({
    threadId: "thread:one",
    expectedRevision: created.revision,
    thread: {
      ...created.thread,
      updatedAt: "2026-09-27T19:01:00.000Z"
    },
    checkpoints: [],
    activities: [],
    relays: []
  });

  await assert.rejects(
    () => second.save({
      threadId: "thread:one",
      expectedRevision: stale.revision,
      thread: {
        ...stale.thread,
        updatedAt: "2026-09-27T19:02:00.000Z"
      },
      checkpoints: [],
      activities: [],
      relays: []
    }),
    ThreadRevisionConflictError
  );
});


test("JSON ThreadStore upgrades v1 snapshots with an empty Relay history", async () => {
  const directory = await mkdtemp(join(tmpdir(), "asc-thread-v1-"));
  const path = join(directory, "threads.json");
  try {
    await writeFile(
      path,
      JSON.stringify({
        schemaVersion: 1,
        accountDomainId: "business-a",
        snapshots: [{
          revision: 3,
          thread: thread("thread:legacy"),
          checkpoints: [],
          activities: []
        }]
      }),
      "utf8"
    );

    const store = new JsonFileThreadStore(path, "business-a");
    const loaded = await store.load("thread:legacy");

    assert.equal(loaded?.revision, 3);
    assert.deepEqual(loaded?.relays, []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Postgres ThreadStore upgrades v1 payloads with an empty Relay history", async () => {
  const client = new FakePostgresClient();
  client.rows.set("business-a\u0000thread:legacy", {
    revision: 4,
    payload: {
      schemaVersion: 1,
      thread: thread("thread:legacy"),
      checkpoints: [],
      activities: []
    },
    updated_at: "2026-09-27T19:20:00.000Z"
  });

  const store = new PostgresThreadStore(client, "business-a");
  const loaded = await store.load("thread:legacy");

  assert.equal(loaded?.revision, 4);
  assert.deepEqual(loaded?.relays, []);
});
