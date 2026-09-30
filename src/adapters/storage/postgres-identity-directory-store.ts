import { Pool } from "pg";

import {
  IDENTITY_DIRECTORY_SCHEMA_VERSION,
  IdentityDirectoryRevisionConflictError,
  emptyIdentityDirectorySnapshot,
  type IdentityDirectorySnapshot,
  type IdentityDirectoryStore,
  type SaveIdentityDirectoryInput
} from "../../ports/index.js";
import type {
  PostgresQueryClient,
  PostgresQueryResult
} from "./postgres-control-registry-store.js";

const DIRECTORY_KEY = "primary";

function normalizeMemberships(
  values: readonly Record<string, unknown>[]
) {
  return values.map((membership) => ({
    ...membership,
    generation:
      typeof membership.generation === "number" &&
      Number.isInteger(membership.generation) &&
      membership.generation > 0
        ? membership.generation
        : 1
  }));
}

function freezeSnapshot(
  snapshot: IdentityDirectorySnapshot
): IdentityDirectorySnapshot {
  return Object.freeze({
    ...snapshot,
    principals: Object.freeze([...snapshot.principals]),
    accountDomains: Object.freeze([...snapshot.accountDomains]),
    memberships: Object.freeze([...snapshot.memberships]),
    authenticationBindings: Object.freeze([
      ...snapshot.authenticationBindings
    ]),
    authenticationPairings: Object.freeze([
      ...snapshot.authenticationPairings
    ])
  });
}

function decode(
  revision: number,
  payloadInput: unknown,
  updatedAtInput: unknown
): IdentityDirectorySnapshot {
  const payload =
    typeof payloadInput === "string"
      ? JSON.parse(payloadInput) as Record<string, unknown>
      : payloadInput as Record<string, unknown>;

  if (
    payload.schemaVersion !== 1 &&
    payload.schemaVersion !== 2 &&
    payload.schemaVersion !== 3 &&
    payload.schemaVersion !== IDENTITY_DIRECTORY_SCHEMA_VERSION
  ) {
    throw new Error(
      "Unsupported identity directory schema version: " +
      String(payload.schemaVersion)
    );
  }
  if (
    !Array.isArray(payload.principals) ||
    !Array.isArray(payload.accountDomains) ||
    !Array.isArray(payload.memberships)
  ) {
    throw new Error("Invalid identity directory payload.");
  }

  return freezeSnapshot({
    schemaVersion: IDENTITY_DIRECTORY_SCHEMA_VERSION,
    revision,
    principals: payload.principals as IdentityDirectorySnapshot["principals"],
    accountDomains:
      payload.accountDomains as IdentityDirectorySnapshot["accountDomains"],
    memberships: normalizeMemberships(
      payload.memberships as readonly Record<string, unknown>[]
    ) as unknown as IdentityDirectorySnapshot["memberships"],
    authenticationBindings: Array.isArray(payload.authenticationBindings)
      ? payload.authenticationBindings as IdentityDirectorySnapshot["authenticationBindings"]
      : Object.freeze([]),
    authenticationPairings: Array.isArray(payload.authenticationPairings)
      ? payload.authenticationPairings as IdentityDirectorySnapshot["authenticationPairings"]
      : Object.freeze([]),
    ...(typeof updatedAtInput === "string"
      ? { updatedAt: updatedAtInput }
      : typeof payload.updatedAt === "string"
        ? { updatedAt: payload.updatedAt }
        : {})
  });
}

function encode(input: SaveIdentityDirectoryInput): string {
  return JSON.stringify({
    schemaVersion: IDENTITY_DIRECTORY_SCHEMA_VERSION,
    principals: input.principals,
    accountDomains: input.accountDomains,
    memberships: input.memberships,
    authenticationBindings: input.authenticationBindings,
    authenticationPairings: input.authenticationPairings,
    ...(input.updatedAt ? { updatedAt: input.updatedAt } : {})
  });
}

export class PostgresIdentityDirectoryStore
implements IdentityDirectoryStore {
  readonly #client: PostgresQueryClient;
  readonly #close: (() => Promise<void>) | undefined;
  #ready?: Promise<void>;

  constructor(client: PostgresQueryClient, close?: () => Promise<void>) {
    this.#client = client;
    this.#close = close;
  }

  static fromConnectionString(
    connectionString: string
  ): PostgresIdentityDirectoryStore {
    const pool = new Pool({
      connectionString,
      max: 2,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000
    });

    return new PostgresIdentityDirectoryStore(
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
      () => pool.end()
    );
  }

  async #ensureTable(): Promise<void> {
    this.#ready ??= this.#client.query(
      [
        "CREATE TABLE IF NOT EXISTS asc_identity_directory (",
        "directory_key text PRIMARY KEY,",
        "revision bigint NOT NULL,",
        "payload jsonb NOT NULL,",
        "updated_at timestamptz NOT NULL DEFAULT now()",
        ")"
      ].join(" ")
    ).then(() => undefined);
    await this.#ready;
  }

  async #currentRevision(): Promise<number> {
    const result = await this.#client.query(
      "SELECT revision FROM asc_identity_directory WHERE directory_key = $1",
      [DIRECTORY_KEY]
    );
    if (result.rows.length === 0) return 0;
    return Number(result.rows[0]!.revision);
  }

  async load(): Promise<IdentityDirectorySnapshot> {
    await this.#ensureTable();
    const result = await this.#client.query(
      "SELECT revision, payload, updated_at FROM asc_identity_directory WHERE directory_key = $1",
      [DIRECTORY_KEY]
    );
    if (result.rows.length === 0) return emptyIdentityDirectorySnapshot();
    const row = result.rows[0]!;
    return decode(Number(row.revision), row.payload, row.updated_at);
  }

  async save(
    input: SaveIdentityDirectoryInput
  ): Promise<IdentityDirectorySnapshot> {
    await this.#ensureTable();
    const payload = encode(input);
    const updatedAt = input.updatedAt ?? new Date().toISOString();

    let result: PostgresQueryResult;
    if (input.expectedRevision === 0) {
      result = await this.#client.query(
        [
          "INSERT INTO asc_identity_directory",
          "(directory_key, revision, payload, updated_at)",
          "VALUES ($1, 1, $2::jsonb, $3::timestamptz)",
          "ON CONFLICT (directory_key) DO NOTHING",
          "RETURNING revision, payload, updated_at"
        ].join(" "),
        [DIRECTORY_KEY, payload, updatedAt]
      );
    } else {
      result = await this.#client.query(
        [
          "UPDATE asc_identity_directory",
          "SET revision = revision + 1, payload = $2::jsonb, updated_at = $3::timestamptz",
          "WHERE directory_key = $1 AND revision = $4",
          "RETURNING revision, payload, updated_at"
        ].join(" "),
        [DIRECTORY_KEY, payload, updatedAt, input.expectedRevision]
      );
    }

    if (result.rows.length === 0) {
      throw new IdentityDirectoryRevisionConflictError(
        input.expectedRevision,
        await this.#currentRevision()
      );
    }

    const row = result.rows[0]!;
    return decode(Number(row.revision), row.payload, row.updated_at);
  }

  async close(): Promise<void> {
    if (this.#close) await this.#close();
  }
}
