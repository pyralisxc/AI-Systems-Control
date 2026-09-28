import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  JsonFileAuthorizationFlowStore,
  PostgresAuthorizationFlowStore
} from "../dist/adapters/index.js";

function flow(overrides = {}) {
  return {
    flowId: "authflow:one",
    principalId: "principal:owner",
    accountDomainId: "business-a",
    provider: "github",
    stateHash: "hash",
    callbackUrl: "https://asc.example/callback",
    createdAt: "2026-09-28T01:00:00.000Z",
    expiresAt: "2026-09-28T01:10:00.000Z",
    state: "pending",
    ...overrides
  };
}

test("JSON authorization flow store survives restart and consumes once", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "asc-auth-flow-")
  );
  const path = join(directory, "flows.json");
  try {
    const first = new JsonFileAuthorizationFlowStore(
      path,
      "business-a"
    );
    await first.create({ flow: flow() });

    const restarted = new JsonFileAuthorizationFlowStore(
      path,
      "business-a"
    );
    assert.equal(
      (await restarted.get("authflow:one"))?.state,
      "pending"
    );

    const consumed = await restarted.consume({
      flowId: "authflow:one",
      stateHash: "hash",
      now: "2026-09-28T01:01:00.000Z"
    });
    assert.equal(consumed.state, "consumed");

    await assert.rejects(
      () => restarted.consume({
        flowId: "authflow:one",
        stateHash: "hash",
        now: "2026-09-28T01:02:00.000Z"
      }),
      /already been consumed/i
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

class FakePostgresClient {
  rows = new Map();

  key(domain, id) {
    return domain + "\u0000" + id;
  }

  async query(text, values = []) {
    if (text.startsWith("CREATE TABLE")) {
      return { rowCount: null, rows: [] };
    }
    if (text.startsWith("INSERT INTO asc_authorization_flow")) {
      const key = this.key(values[0], values[1]);
      if (this.rows.has(key)) {
        return { rowCount: 0, rows: [] };
      }
      const row = {
        payload: JSON.parse(values[5])
      };
      this.rows.set(key, {
        ...row,
        state_hash: values[2],
        state: values[3]
      });
      return { rowCount: 1, rows: [{ flow_id: values[1] }] };
    }
    if (text.startsWith("SELECT payload FROM asc_authorization_flow")) {
      const row = this.rows.get(
        this.key(values[0], values[1])
      );
      return {
        rowCount: row ? 1 : 0,
        rows: row ? [{ payload: row.payload }] : []
      };
    }
    if (text.startsWith("UPDATE asc_authorization_flow")) {
      const key = this.key(values[0], values[1]);
      const row = this.rows.get(key);
      if (
        !row ||
        row.state !== "pending" ||
        row.state_hash !== values[2]
      ) {
        return { rowCount: 0, rows: [] };
      }
      const updated = {
        ...row,
        state: "consumed",
        payload: JSON.parse(values[3])
      };
      this.rows.set(key, updated);
      return {
        rowCount: 1,
        rows: [{ payload: updated.payload }]
      };
    }
    throw new Error("Unexpected SQL: " + text);
  }
}

test("Postgres authorization flow store is tenant-scoped and atomic", async () => {
  const client = new FakePostgresClient();
  const first = new PostgresAuthorizationFlowStore(
    client,
    "business-a"
  );
  const second = new PostgresAuthorizationFlowStore(
    client,
    "business-b"
  );

  await first.create({ flow: flow() });
  assert.equal(
    await second.get("authflow:one"),
    undefined
  );

  await assert.rejects(
    () => second.create({ flow: flow() }),
    /another AccountDomain/i
  );

  const consumed = await first.consume({
    flowId: "authflow:one",
    stateHash: "hash",
    now: "2026-09-28T01:02:00.000Z"
  });
  assert.equal(consumed.state, "consumed");
});

test("authorization flow store rejects state mismatch and expiry", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "asc-auth-flow-")
  );
  try {
    const store = new JsonFileAuthorizationFlowStore(
      join(directory, "flows.json"),
      "business-a"
    );
    await store.create({ flow: flow() });

    await assert.rejects(
      () => store.consume({
        flowId: "authflow:one",
        stateHash: "wrong",
        now: "2026-09-28T01:01:00.000Z"
      }),
      /state does not match/i
    );

    await assert.rejects(
      () => store.consume({
        flowId: "authflow:one",
        stateHash: "hash",
        now: "2026-09-28T01:11:00.000Z"
      }),
      /expired/i
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
