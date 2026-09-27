import { Pool } from "pg";

import type {
  ConversationThread,
  ThreadActivityEvent,
  ThreadCheckpoint
} from "../../domain/index.js";
import {
  ThreadRevisionConflictError,
  type SaveThreadSnapshotInput,
  type ThreadSnapshot,
  type ThreadStore
} from "../../ports/index.js";
import type {
  PostgresQueryClient
} from "./postgres-control-registry-store.js";

const THREAD_PAYLOAD_SCHEMA_VERSION = 1 as const;

function requiredDomain(value: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error("ThreadStore AccountDomain cannot be empty.");
  return normalized;
}

function assertTenant(
  accountDomainId: string,
  thread: ConversationThread,
  checkpoints: readonly ThreadCheckpoint[],
  activities: readonly ThreadActivityEvent[]
): void {
  if (thread.accountDomainId !== accountDomainId) {
    throw new Error(
      "Thread belongs to " + thread.accountDomainId +
      ", not store " + accountDomainId + "."
    );
  }
  for (const checkpoint of checkpoints) {
    if (
      checkpoint.accountDomainId !== accountDomainId ||
      checkpoint.threadId !== thread.threadId
    ) {
      throw new Error("Checkpoint does not belong to this Thread/AccountDomain.");
    }
  }
  for (const activity of activities) {
    if (
      activity.accountDomainId !== accountDomainId ||
      activity.threadId !== thread.threadId
    ) {
      throw new Error("Activity does not belong to this Thread/AccountDomain.");
    }
  }
}

function freezeSnapshot(snapshot: ThreadSnapshot): ThreadSnapshot {
  assertTenant(
    snapshot.thread.accountDomainId,
    snapshot.thread,
    snapshot.checkpoints,
    snapshot.activities
  );
  return Object.freeze({
    revision: snapshot.revision,
    thread: Object.freeze({
      ...snapshot.thread,
      runtimeCapabilities: Object.freeze({
        ...snapshot.thread.runtimeCapabilities
      }),
      ...(snapshot.thread.externalReference
        ? { externalReference: Object.freeze({
            ...snapshot.thread.externalReference
          }) }
        : {})
    }),
    checkpoints: Object.freeze(
      snapshot.checkpoints.map((checkpoint) => Object.freeze({
        ...checkpoint,
        workReferences: Object.freeze([...checkpoint.workReferences]),
        evidenceReferences: Object.freeze([...checkpoint.evidenceReferences]),
        ...(checkpoint.lastSteering
          ? { lastSteering: Object.freeze({ ...checkpoint.lastSteering }) }
          : {})
      }))
    ),
    activities: Object.freeze(
      snapshot.activities.map((activity) => Object.freeze({ ...activity }))
    )
  });
}

function encode(snapshot: Omit<ThreadSnapshot, "revision">): string {
  return JSON.stringify({
    schemaVersion: THREAD_PAYLOAD_SCHEMA_VERSION,
    thread: snapshot.thread,
    checkpoints: snapshot.checkpoints,
    activities: snapshot.activities
  });
}

function decode(
  accountDomainId: string,
  revision: number,
  payloadInput: unknown
): ThreadSnapshot {
  const payload =
    typeof payloadInput === "string"
      ? JSON.parse(payloadInput) as Record<string, unknown>
      : payloadInput as Record<string, unknown>;

  if (payload.schemaVersion !== THREAD_PAYLOAD_SCHEMA_VERSION) {
    throw new Error(
      "Unsupported Thread payload schema version: " +
      String(payload.schemaVersion)
    );
  }
  if (
    !payload.thread ||
    typeof payload.thread !== "object" ||
    !Array.isArray(payload.checkpoints) ||
    !Array.isArray(payload.activities)
  ) {
    throw new Error("Invalid Thread payload.");
  }

  const snapshot: ThreadSnapshot = {
    revision,
    thread: payload.thread as ConversationThread,
    checkpoints: payload.checkpoints as ThreadCheckpoint[],
    activities: payload.activities as ThreadActivityEvent[]
  };
  assertTenant(
    accountDomainId,
    snapshot.thread,
    snapshot.checkpoints,
    snapshot.activities
  );
  return freezeSnapshot(snapshot);
}

export class PostgresThreadStore implements ThreadStore {
  readonly accountDomainId: string;
  readonly #client: PostgresQueryClient;
  readonly #close?: () => Promise<void>;
  #ready?: Promise<void>;

  constructor(
    client: PostgresQueryClient,
    accountDomainId: string,
    close?: () => Promise<void>
  ) {
    this.accountDomainId = requiredDomain(accountDomainId);
    this.#client = client;
    this.#close = close;
  }

  static fromConnectionString(
    connectionString: string,
    accountDomainId: string
  ): PostgresThreadStore {
    const pool = new Pool({
      connectionString,
      max: 2,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000
    });

    return new PostgresThreadStore(
      {
        query: async (text, values) => {
          const result = await pool.query(
            text,
            values ? [...values] : undefined
          );
          return {
            rowCount: result.rowCount,
            rows: result.rows as readonly Record<string, unknown>[]
          };
        }
      },
      accountDomainId,
      () => pool.end()
    );
  }

  async #ensureTable(): Promise<void> {
    this.#ready ??= this.#client.query(
      [
        "CREATE TABLE IF NOT EXISTS asc_thread_state (",
        "account_domain_id text NOT NULL,",
        "thread_id text NOT NULL,",
        "revision bigint NOT NULL,",
        "payload jsonb NOT NULL,",
        "updated_at timestamptz NOT NULL DEFAULT now(),",
        "PRIMARY KEY (account_domain_id, thread_id)",
        ")"
      ].join(" ")
    ).then(() => undefined);
    await this.#ready;
  }

  async list(): Promise<readonly ThreadSnapshot[]> {
    await this.#ensureTable();
    const result = await this.#client.query(
      [
        "SELECT revision, payload FROM asc_thread_state",
        "WHERE account_domain_id = $1",
        "ORDER BY updated_at DESC"
      ].join(" "),
      [this.accountDomainId]
    );
    return Object.freeze(
      result.rows.map((row) =>
        decode(this.accountDomainId, Number(row.revision), row.payload)
      )
    );
  }

  async load(threadId: string): Promise<ThreadSnapshot | undefined> {
    await this.#ensureTable();
    const result = await this.#client.query(
      [
        "SELECT revision, payload FROM asc_thread_state",
        "WHERE account_domain_id = $1 AND thread_id = $2"
      ].join(" "),
      [this.accountDomainId, threadId]
    );
    if (result.rows.length === 0) return undefined;
    const row = result.rows[0]!;
    return decode(this.accountDomainId, Number(row.revision), row.payload);
  }

  async create(thread: ConversationThread): Promise<ThreadSnapshot> {
    await this.#ensureTable();
    assertTenant(this.accountDomainId, thread, [], []);
    const snapshot = freezeSnapshot({
      revision: 1,
      thread,
      checkpoints: [],
      activities: []
    });

    const result = await this.#client.query(
      [
        "INSERT INTO asc_thread_state",
        "(account_domain_id, thread_id, revision, payload, updated_at)",
        "VALUES ($1, $2, 1, $3::jsonb, $4::timestamptz)",
        "ON CONFLICT (account_domain_id, thread_id) DO NOTHING",
        "RETURNING revision, payload"
      ].join(" "),
      [
        this.accountDomainId,
        thread.threadId,
        encode(snapshot),
        thread.updatedAt
      ]
    );
    if (result.rows.length === 0) {
      throw new Error("Thread already exists: " + thread.threadId);
    }
    const row = result.rows[0]!;
    return decode(this.accountDomainId, Number(row.revision), row.payload);
  }

  async save(input: SaveThreadSnapshotInput): Promise<ThreadSnapshot> {
    await this.#ensureTable();
    if (input.thread.threadId !== input.threadId) {
      throw new Error("Thread ID mismatch.");
    }
    assertTenant(
      this.accountDomainId,
      input.thread,
      input.checkpoints,
      input.activities
    );

    const payload = encode({
      thread: input.thread,
      checkpoints: input.checkpoints,
      activities: input.activities
    });
    const result = await this.#client.query(
      [
        "UPDATE asc_thread_state",
        "SET revision = revision + 1, payload = $3::jsonb, updated_at = $4::timestamptz",
        "WHERE account_domain_id = $1 AND thread_id = $2 AND revision = $5",
        "RETURNING revision, payload"
      ].join(" "),
      [
        this.accountDomainId,
        input.threadId,
        payload,
        input.thread.updatedAt,
        input.expectedRevision
      ]
    );

    if (result.rows.length === 0) {
      const current = await this.load(input.threadId);
      if (!current) throw new Error("Unknown Thread: " + input.threadId);
      throw new ThreadRevisionConflictError(
        input.threadId,
        input.expectedRevision,
        current.revision
      );
    }

    const row = result.rows[0]!;
    return decode(this.accountDomainId, Number(row.revision), row.payload);
  }

  async close(): Promise<void> {
    if (this.#close) await this.#close();
  }
}
