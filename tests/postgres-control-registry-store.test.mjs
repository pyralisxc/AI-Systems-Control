import assert from "node:assert/strict";
import test from "node:test";

import { PostgresControlRegistryStore } from "../dist/adapters/index.js";
import { RegistryRevisionConflictError } from "../dist/ports/index.js";

class FakePostgresClient {
  row = null;

  async query(text, values = []) {
    if (text.startsWith("CREATE TABLE")) {
      return { rowCount: null, rows: [] };
    }

    if (text.startsWith("SELECT revision, payload")) {
      return {
        rowCount: this.row ? 1 : 0,
        rows: this.row ? [this.row] : []
      };
    }

    if (text.startsWith("SELECT revision FROM")) {
      return {
        rowCount: this.row ? 1 : 0,
        rows: this.row ? [{ revision: this.row.revision }] : []
      };
    }

    if (text.startsWith("INSERT INTO")) {
      if (this.row) return { rowCount: 0, rows: [] };
      this.row = {
        revision: 1,
        payload: JSON.parse(values[1]),
        updated_at: values[2]
      };
      return { rowCount: 1, rows: [this.row] };
    }

    if (text.startsWith("UPDATE asc_control_registry")) {
      const expected = Number(values[3]);
      if (!this.row || this.row.revision !== expected) {
        return { rowCount: 0, rows: [] };
      }
      this.row = {
        revision: this.row.revision + 1,
        payload: JSON.parse(values[1]),
        updated_at: values[2]
      };
      return { rowCount: 1, rows: [this.row] };
    }

    throw new Error("Unexpected SQL in fake client: " + text);
  }
}

function emptySave(expectedRevision) {
  return {
    expectedRevision,
    projects: [],
    connections: [],
    projectConnectionBindings: [],
    delegations: [],
    updatedAt: "2026-09-27T06:00:00.000Z"
  };
}

test("Postgres store persists and reloads one revisioned registry document", async () => {
  const client = new FakePostgresClient();
  const store = new PostgresControlRegistryStore(client);

  const initial = await store.load();
  assert.equal(initial.revision, 0);

  const saved = await store.save(emptySave(0));
  assert.equal(saved.revision, 1);

  const loaded = await store.load();
  assert.equal(loaded.revision, 1);
  assert.deepEqual(loaded.projects, []);
  assert.deepEqual(loaded.connections, []);
});

test("Postgres store compare-and-swap rejects stale writers", async () => {
  const client = new FakePostgresClient();
  const first = new PostgresControlRegistryStore(client);
  const second = new PostgresControlRegistryStore(client);

  await first.save(emptySave(0));

  await assert.rejects(
    () => second.save(emptySave(0)),
    (error) =>
      error instanceof RegistryRevisionConflictError &&
      /expected 0, current 1/i.test(error.message)
  );

  const secondRevision = await first.save({
    ...emptySave(1),
    updatedAt: "2026-09-27T06:01:00.000Z"
  });
  assert.equal(secondRevision.revision, 2);
});

test("Postgres store rejects secret-like registry metadata before SQL write", async () => {
  const client = new FakePostgresClient();
  const store = new PostgresControlRegistryStore(client);

  await assert.rejects(
    () => store.save({
      expectedRevision: 0,
      projects: [],
      connections: [{
        connectionId: "connection:fake:1",
        ownerId: "owner-1",
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
      delegations: []
    }),
    /Secret-like field/i
  );
  assert.equal(client.row, null);
});
