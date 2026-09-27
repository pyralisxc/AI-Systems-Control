import assert from "node:assert/strict";
import test from "node:test";

import { PostgresControlRegistryStore } from "../dist/adapters/index.js";
import { RegistryRevisionConflictError } from "../dist/ports/index.js";

class FakePostgresClient {
  rows = new Map();

  async query(text, values = []) {
    if (text.startsWith("CREATE TABLE")) {
      return { rowCount: null, rows: [] };
    }

    const key = values[0];

    if (text.startsWith("SELECT revision, payload")) {
      const row = this.rows.get(key);
      return {
        rowCount: row ? 1 : 0,
        rows: row ? [row] : []
      };
    }

    if (text.startsWith("SELECT revision FROM")) {
      const row = this.rows.get(key);
      return {
        rowCount: row ? 1 : 0,
        rows: row ? [{ revision: row.revision }] : []
      };
    }

    if (text.startsWith("INSERT INTO")) {
      if (this.rows.has(key)) return { rowCount: 0, rows: [] };
      const row = {
        revision: 1,
        payload: JSON.parse(values[1]),
        updated_at: values[2]
      };
      this.rows.set(key, row);
      return { rowCount: 1, rows: [row] };
    }

    if (text.startsWith("UPDATE asc_control_registry")) {
      const expected = Number(values[3]);
      const current = this.rows.get(key);
      if (!current || current.revision !== expected) {
        return { rowCount: 0, rows: [] };
      }
      const row = {
        revision: current.revision + 1,
        payload: JSON.parse(values[1]),
        updated_at: values[2]
      };
      this.rows.set(key, row);
      return { rowCount: 1, rows: [row] };
    }

    throw new Error("Unexpected SQL in fake client: " + text);
  }
}

function emptyWorkerControl() {
  return {
    approvals: [],
    authorizations: [],
    workerRuns: [],
    leases: [],
    projectControls: [],
    events: []
  };
}

function emptySave(expectedRevision) {
  return {
    expectedRevision,
    projects: [],
    connections: [],
    projectConnectionBindings: [],
    delegations: [],
    workerControl: emptyWorkerControl(),
    updatedAt: "2026-09-27T06:00:00.000Z"
  };
}

test("Postgres store persists one AccountDomain-scoped registry", async () => {
  const client = new FakePostgresClient();
  const store = new PostgresControlRegistryStore(client, "business-a");

  const initial = await store.load();
  assert.equal(initial.accountDomainId, "business-a");
  assert.equal(initial.revision, 0);

  const saved = await store.save(emptySave(0));
  assert.equal(saved.revision, 1);

  const loaded = await store.load();
  assert.equal(loaded.accountDomainId, "business-a");
  assert.equal(loaded.revision, 1);
});

test("two AccountDomains maintain independent revisions and documents", async () => {
  const client = new FakePostgresClient();
  const businessA = new PostgresControlRegistryStore(client, "business-a");
  const businessB = new PostgresControlRegistryStore(client, "business-b");

  await businessA.save(emptySave(0));
  await businessA.save(emptySave(1));

  const bInitial = await businessB.load();
  assert.equal(bInitial.revision, 0);
  await businessB.save(emptySave(0));

  assert.equal((await businessA.load()).revision, 2);
  assert.equal((await businessB.load()).revision, 1);
  assert.equal(client.rows.size, 2);
});

test("Postgres compare-and-swap is scoped to one AccountDomain", async () => {
  const client = new FakePostgresClient();
  const first = new PostgresControlRegistryStore(client, "business-a");
  const second = new PostgresControlRegistryStore(client, "business-a");

  await first.save(emptySave(0));

  await assert.rejects(
    () => second.save(emptySave(0)),
    (error) =>
      error instanceof RegistryRevisionConflictError &&
      /expected 0, current 1/i.test(error.message)
  );
});

test("Postgres store rejects cross-domain resources", async () => {
  const client = new FakePostgresClient();
  const store = new PostgresControlRegistryStore(client, "business-a");

  await assert.rejects(
    () => store.save({
      expectedRevision: 0,
      projects: [{
        projectId: "wrong-project",
        accountDomainId: "business-b",
        name: "Wrong",
        references: [],
        createdAt: "2026-09-27T06:00:00.000Z",
        status: "active"
      }],
      connections: [],
      projectConnectionBindings: [],
      delegations: [],
      workerControl: emptyWorkerControl()
    }),
    /not registry business-a/i
  );
});

test("Postgres store rejects secret-like registry metadata before SQL write", async () => {
  const client = new FakePostgresClient();
  const store = new PostgresControlRegistryStore(client, "business-a");

  await assert.rejects(
    () => store.save({
      expectedRevision: 0,
      projects: [],
      connections: [{
        connectionId: "connection:fake:1",
        authorizedByPrincipalId: "owner-1",
        accountDomainId: "business-a",
        provider: "fake",
        providerAccountId: "account-a",
        authenticationStrategy: "oauth",
        status: "active",
        generation: 1,
        capabilities: [],
        createdAt: "2026-09-27T06:00:00.000Z",
        updatedAt: "2026-09-27T06:00:00.000Z",
        accessToken: "must-not-persist"
      }],
      projectConnectionBindings: [],
      delegations: [],
      workerControl: emptyWorkerControl()
    }),
    /Secret-like field/i
  );
  assert.equal(client.rows.size, 0);
});


test("v3 tenant registry upgrades with empty worker-control state", async () => {
  const client = new FakePostgresClient();
  client.rows.set("domain:business-a", {
    revision: 7,
    payload: {
      schemaVersion: 3,
      accountDomainId: "business-a",
      projects: [],
      connections: [],
      projectConnectionBindings: [],
      delegations: []
    },
    updated_at: "2026-09-27T06:30:00.000Z"
  });

  const store = new PostgresControlRegistryStore(client, "business-a");
  const loaded = await store.load();

  assert.equal(loaded.revision, 7);
  assert.deepEqual(loaded.workerControl.approvals, []);
  assert.deepEqual(loaded.workerControl.authorizations, []);
  assert.deepEqual(loaded.workerControl.workerRuns, []);
  assert.deepEqual(loaded.workerControl.leases, []);
  assert.deepEqual(loaded.workerControl.projectControls, []);
  assert.deepEqual(loaded.workerControl.events, []);
});
