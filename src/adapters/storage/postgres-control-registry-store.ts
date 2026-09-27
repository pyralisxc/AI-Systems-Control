import { Pool } from "pg";

import {
  CONTROL_REGISTRY_SCHEMA_VERSION,
  RegistryRevisionConflictError,
  emptyControlRegistrySnapshot,
  type ControlRegistrySnapshot,
  type ControlRegistryStore,
  type SaveControlRegistryInput
} from "../../ports/index.js";

const REGISTRY_KEY = "primary";
const SECRET_FIELD_PATTERN =
  /(^|_)(secret|token|password|cookie|api[_-]?key|access[_-]?key|refresh[_-]?token|credential)(_|$)/iu;

export interface PostgresQueryResult {
  readonly rowCount: number | null;
  readonly rows: readonly Record<string, unknown>[];
}

export interface PostgresQueryClient {
  query(
    text: string,
    values?: readonly unknown[]
  ): Promise<PostgresQueryResult>;
}

function assertNoSecretLikeFields(value: unknown, path = "registry"): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoSecretLikeFields(entry, path + "[" + index + "]"));
    return;
  }

  for (const [key, nested] of Object.entries(value)) {
    if (SECRET_FIELD_PATTERN.test(key)) {
      throw new Error(
        "Secret-like field " + path + "." + key +
        " cannot be persisted in ASC registry metadata."
      );
    }
    assertNoSecretLikeFields(nested, path + "." + key);
  }
}

function normalizeConnections(connections: readonly Record<string, unknown>[]) {
  return connections.map((connection) => ({
    ...connection,
    generation:
      typeof connection.generation === "number" && Number.isInteger(connection.generation)
        ? connection.generation
        : 1
  }));
}

function freezeSnapshot(snapshot: ControlRegistrySnapshot): ControlRegistrySnapshot {
  return Object.freeze({
    ...snapshot,
    projects: Object.freeze([...snapshot.projects]),
    connections: Object.freeze([...snapshot.connections]),
    projectConnectionBindings: Object.freeze([...snapshot.projectConnectionBindings]),
    delegations: Object.freeze([...snapshot.delegations])
  });
}

function decodePayload(
  revision: number,
  payloadInput: unknown,
  updatedAtInput: unknown
): ControlRegistrySnapshot {
  const payload =
    typeof payloadInput === "string"
      ? JSON.parse(payloadInput) as Record<string, unknown>
      : payloadInput as Record<string, unknown>;

  const version = payload.schemaVersion;
  if (version !== 1 && version !== CONTROL_REGISTRY_SCHEMA_VERSION) {
    throw new Error("Unsupported control registry schema version: " + String(version));
  }
  if (!Array.isArray(payload.projects) || !Array.isArray(payload.connections)) {
    throw new Error("Control registry payload must contain projects and connections arrays.");
  }

  const snapshot: ControlRegistrySnapshot = {
    schemaVersion: CONTROL_REGISTRY_SCHEMA_VERSION,
    revision,
    projects: payload.projects as ControlRegistrySnapshot["projects"],
    connections: normalizeConnections(
      payload.connections as readonly Record<string, unknown>[]
    ) as unknown as ControlRegistrySnapshot["connections"],
    projectConnectionBindings: Array.isArray(payload.projectConnectionBindings)
      ? payload.projectConnectionBindings as ControlRegistrySnapshot["projectConnectionBindings"]
      : Object.freeze([]),
    delegations: Array.isArray(payload.delegations)
      ? payload.delegations as ControlRegistrySnapshot["delegations"]
      : Object.freeze([]),
    ...(typeof updatedAtInput === "string"
      ? { updatedAt: updatedAtInput }
      : typeof payload.updatedAt === "string"
        ? { updatedAt: payload.updatedAt }
        : {})
  };

  assertNoSecretLikeFields(snapshot.connections, "registry.connections");
  assertNoSecretLikeFields(
    snapshot.projectConnectionBindings,
    "registry.projectConnectionBindings"
  );
  assertNoSecretLikeFields(snapshot.delegations, "registry.delegations");
  return freezeSnapshot(snapshot);
}

function encodePayload(input: SaveControlRegistryInput): string {
  assertNoSecretLikeFields(input.connections, "registry.connections");
  assertNoSecretLikeFields(
    input.projectConnectionBindings,
    "registry.projectConnectionBindings"
  );
  assertNoSecretLikeFields(input.delegations, "registry.delegations");

  return JSON.stringify({
    schemaVersion: CONTROL_REGISTRY_SCHEMA_VERSION,
    projects: input.projects,
    connections: input.connections,
    projectConnectionBindings: input.projectConnectionBindings,
    delegations: input.delegations,
    ...(input.updatedAt ? { updatedAt: input.updatedAt } : {})
  });
}

export class PostgresControlRegistryStore implements ControlRegistryStore {
  readonly #client: PostgresQueryClient;
  readonly #close?: () => Promise<void>;
  #ready?: Promise<void>;

  constructor(client: PostgresQueryClient, close?: () => Promise<void>) {
    this.#client = client;
    this.#close = close;
  }

  static fromConnectionString(connectionString: string): PostgresControlRegistryStore {
    const pool = new Pool({
      connectionString,
      max: 2,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000
    });

    return new PostgresControlRegistryStore(
      {
        query: async (text, values) => {
          const result = await pool.query(text, values ? [...values] : undefined);
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
        "CREATE TABLE IF NOT EXISTS asc_control_registry (",
        "registry_key text PRIMARY KEY,",
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
      "SELECT revision FROM asc_control_registry WHERE registry_key = $1",
      [REGISTRY_KEY]
    );
    if (result.rows.length === 0) return 0;
    return Number(result.rows[0]!.revision);
  }

  async load(): Promise<ControlRegistrySnapshot> {
    await this.#ensureTable();
    const result = await this.#client.query(
      "SELECT revision, payload, updated_at FROM asc_control_registry WHERE registry_key = $1",
      [REGISTRY_KEY]
    );

    if (result.rows.length === 0) return emptyControlRegistrySnapshot();
    const row = result.rows[0]!;
    return decodePayload(
      Number(row.revision),
      row.payload,
      row.updated_at
    );
  }

  async save(input: SaveControlRegistryInput): Promise<ControlRegistrySnapshot> {
    await this.#ensureTable();
    const payload = encodePayload(input);
    const updatedAt = input.updatedAt ?? new Date().toISOString();

    let result: PostgresQueryResult;
    if (input.expectedRevision === 0) {
      result = await this.#client.query(
        [
          "INSERT INTO asc_control_registry",
          "(registry_key, revision, payload, updated_at)",
          "VALUES ($1, 1, $2::jsonb, $3::timestamptz)",
          "ON CONFLICT (registry_key) DO NOTHING",
          "RETURNING revision, payload, updated_at"
        ].join(" "),
        [REGISTRY_KEY, payload, updatedAt]
      );
    } else {
      result = await this.#client.query(
        [
          "UPDATE asc_control_registry",
          "SET revision = revision + 1, payload = $2::jsonb, updated_at = $3::timestamptz",
          "WHERE registry_key = $1 AND revision = $4",
          "RETURNING revision, payload, updated_at"
        ].join(" "),
        [REGISTRY_KEY, payload, updatedAt, input.expectedRevision]
      );
    }

    if (result.rows.length === 0) {
      throw new RegistryRevisionConflictError(
        input.expectedRevision,
        await this.#currentRevision()
      );
    }

    const row = result.rows[0]!;
    return decodePayload(Number(row.revision), row.payload, row.updated_at);
  }

  async close(): Promise<void> {
    if (this.#close) await this.#close();
  }
}
