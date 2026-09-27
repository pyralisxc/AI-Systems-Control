import { Pool } from "pg";

import {
  emptyContinuationControlState,
  emptyWorkerControlState,
  type ContinuationControlState,
  type WorkerControlState
} from "../../domain/index.js";
import {
  CONTROL_REGISTRY_SCHEMA_VERSION,
  RegistryRevisionConflictError,
  emptyControlRegistrySnapshot,
  type ControlRegistrySnapshot,
  type ControlRegistryStore,
  type SaveControlRegistryInput
} from "../../ports/index.js";

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

function requiredDomain(value: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error("Control registry AccountDomain cannot be empty.");
  return normalized;
}

function registryKey(accountDomainId: string): string {
  return "domain:" + accountDomainId;
}

function assertNoSecretLikeFields(value: unknown, path = "registry"): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertNoSecretLikeFields(entry, path + "[" + index + "]")
    );
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

function assertTenantOwnership(
  accountDomainId: string,
  projects: readonly ControlRegistrySnapshot["projects"][number][],
  connections: readonly ControlRegistrySnapshot["connections"][number][]
): void {
  for (const project of projects) {
    if (project.accountDomainId !== accountDomainId) {
      throw new Error(
        "Project " + project.projectId + " belongs to " +
        String(project.accountDomainId) + ", not registry " + accountDomainId + "."
      );
    }
  }
  for (const connection of connections) {
    if (connection.accountDomainId !== accountDomainId) {
      throw new Error(
        "Connection " + connection.connectionId + " belongs to " +
        connection.accountDomainId + ", not registry " + accountDomainId + "."
      );
    }
  }
}

function normalizeProjects(
  projects: readonly Record<string, unknown>[],
  accountDomainId: string
) {
  return projects.map((project) => ({
    ...project,
    accountDomainId:
      typeof project.accountDomainId === "string"
        ? project.accountDomainId
        : accountDomainId
  }));
}

function normalizeConnections(connections: readonly Record<string, unknown>[]) {
  return connections.map((connection) => {
    const legacyOwnerId =
      typeof connection.ownerId === "string"
        ? connection.ownerId
        : undefined;
    const { ownerId: _legacyOwnerId, ...rest } = connection;
    return {
      ...rest,
      authorizedByPrincipalId:
        typeof connection.authorizedByPrincipalId === "string"
          ? connection.authorizedByPrincipalId
          : legacyOwnerId ?? "principal:legacy-owner",
      generation:
        typeof connection.generation === "number" && Number.isInteger(connection.generation)
          ? connection.generation
          : 1
    };
  });
}

function normalizeWorkerControl(value: unknown, accountDomainId: string): WorkerControlState {
  const source =
    value && typeof value === "object"
      ? value as Record<string, unknown>
      : emptyWorkerControlState();
  const arrays = {
    approvals: Array.isArray(source.approvals) ? source.approvals : [],
    authorizations: Array.isArray(source.authorizations) ? source.authorizations : [],
    workerRuns: Array.isArray(source.workerRuns) ? source.workerRuns : [],
    leases: Array.isArray(source.leases) ? source.leases : [],
    projectControls: Array.isArray(source.projectControls) ? source.projectControls : [],
    events: Array.isArray(source.events) ? source.events : []
  };
  for (const [kind, records] of Object.entries(arrays)) {
    for (const record of records as readonly Record<string, unknown>[]) {
      if (
        typeof record.accountDomainId === "string" &&
        record.accountDomainId !== accountDomainId
      ) {
        throw new Error(
          "Worker-control " + kind + " record belongs to " +
          record.accountDomainId + ", not registry " + accountDomainId + "."
        );
      }
    }
  }
  return Object.freeze({
    approvals: Object.freeze([...arrays.approvals]) as WorkerControlState["approvals"],
    authorizations: Object.freeze([...arrays.authorizations]) as WorkerControlState["authorizations"],
    workerRuns: Object.freeze([...arrays.workerRuns]) as WorkerControlState["workerRuns"],
    leases: Object.freeze([...arrays.leases]) as WorkerControlState["leases"],
    projectControls: Object.freeze([...arrays.projectControls]) as WorkerControlState["projectControls"],
    events: Object.freeze([...arrays.events]) as WorkerControlState["events"]
  });
}

function normalizeContinuationControl(
  value: unknown,
  accountDomainId: string
): ContinuationControlState {
  const source =
    value && typeof value === "object"
      ? value as Record<string, unknown>
      : emptyContinuationControlState();
  const workEnvelopes = Array.isArray(source.workEnvelopes)
    ? source.workEnvelopes
    : [];
  const autonomyGrants = Array.isArray(source.autonomyGrants)
    ? source.autonomyGrants
    : [];

  for (const [kind, records] of [
    ["workEnvelopes", workEnvelopes],
    ["autonomyGrants", autonomyGrants]
  ] as const) {
    for (const record of records as readonly Record<string, unknown>[]) {
      if (
        typeof record.accountDomainId === "string" &&
        record.accountDomainId !== accountDomainId
      ) {
        throw new Error(
          "Continuation-control " + kind + " record belongs to " +
          record.accountDomainId + ", not registry " + accountDomainId + "."
        );
      }
    }
  }

  return Object.freeze({
    workEnvelopes: Object.freeze([...workEnvelopes]) as ContinuationControlState["workEnvelopes"],
    autonomyGrants: Object.freeze([...autonomyGrants]) as ContinuationControlState["autonomyGrants"]
  });
}

function freezeSnapshot(snapshot: ControlRegistrySnapshot): ControlRegistrySnapshot {
  return Object.freeze({
    ...snapshot,
    projects: Object.freeze([...snapshot.projects]),
    connections: Object.freeze([...snapshot.connections]),
    projectConnectionBindings: Object.freeze([...snapshot.projectConnectionBindings]),
    delegations: Object.freeze([...snapshot.delegations]),
    workerControl: normalizeWorkerControl(snapshot.workerControl, snapshot.accountDomainId),
    continuationControl: normalizeContinuationControl(
      snapshot.continuationControl,
      snapshot.accountDomainId
    )
  });
}

function decodePayload(
  accountDomainId: string,
  revision: number,
  payloadInput: unknown,
  updatedAtInput: unknown
): ControlRegistrySnapshot {
  const payload =
    typeof payloadInput === "string"
      ? JSON.parse(payloadInput) as Record<string, unknown>
      : payloadInput as Record<string, unknown>;

  const version = payload.schemaVersion;
  if (
    version !== 1 &&
    version !== 2 &&
    version !== 3 &&
    version !== 4 &&
    version !== CONTROL_REGISTRY_SCHEMA_VERSION
  ) {
    throw new Error("Unsupported control registry schema version: " + String(version));
  }
  if (!Array.isArray(payload.projects) || !Array.isArray(payload.connections)) {
    throw new Error("Control registry payload must contain projects and connections arrays.");
  }

  const storedDomain =
    typeof payload.accountDomainId === "string"
      ? payload.accountDomainId
      : accountDomainId;
  if (storedDomain !== accountDomainId) {
    throw new Error(
      "Control registry payload belongs to AccountDomain " + storedDomain +
      ", not " + accountDomainId + "."
    );
  }

  const snapshot: ControlRegistrySnapshot = {
    schemaVersion: CONTROL_REGISTRY_SCHEMA_VERSION,
    accountDomainId,
    revision,
    projects: normalizeProjects(
      payload.projects as readonly Record<string, unknown>[],
      accountDomainId
    ) as unknown as ControlRegistrySnapshot["projects"],
    connections: normalizeConnections(
      payload.connections as readonly Record<string, unknown>[]
    ) as unknown as ControlRegistrySnapshot["connections"],
    projectConnectionBindings: Array.isArray(payload.projectConnectionBindings)
      ? payload.projectConnectionBindings as ControlRegistrySnapshot["projectConnectionBindings"]
      : Object.freeze([]),
    delegations: Array.isArray(payload.delegations)
      ? payload.delegations as ControlRegistrySnapshot["delegations"]
      : Object.freeze([]),
    workerControl: normalizeWorkerControl(payload.workerControl, accountDomainId),
    continuationControl: normalizeContinuationControl(
      payload.continuationControl,
      accountDomainId
    ),
    ...(typeof updatedAtInput === "string"
      ? { updatedAt: updatedAtInput }
      : typeof payload.updatedAt === "string"
        ? { updatedAt: payload.updatedAt }
        : {})
  };

  assertTenantOwnership(
    accountDomainId,
    snapshot.projects,
    snapshot.connections
  );
  assertNoSecretLikeFields(snapshot.connections, "registry.connections");
  assertNoSecretLikeFields(
    snapshot.projectConnectionBindings,
    "registry.projectConnectionBindings"
  );
  assertNoSecretLikeFields(snapshot.delegations, "registry.delegations");
  assertNoSecretLikeFields(
    snapshot.continuationControl,
    "registry.continuationControl"
  );
  return freezeSnapshot(snapshot);
}

function encodePayload(
  accountDomainId: string,
  input: SaveControlRegistryInput
): string {
  assertTenantOwnership(
    accountDomainId,
    input.projects,
    input.connections
  );
  assertNoSecretLikeFields(input.connections, "registry.connections");
  assertNoSecretLikeFields(
    input.projectConnectionBindings,
    "registry.projectConnectionBindings"
  );
  assertNoSecretLikeFields(input.delegations, "registry.delegations");
  assertNoSecretLikeFields(
    input.continuationControl,
    "registry.continuationControl"
  );
  const workerControl = normalizeWorkerControl(
    input.workerControl,
    accountDomainId
  );
  const continuationControl = normalizeContinuationControl(
    input.continuationControl,
    accountDomainId
  );

  return JSON.stringify({
    schemaVersion: CONTROL_REGISTRY_SCHEMA_VERSION,
    accountDomainId,
    projects: input.projects,
    connections: input.connections,
    projectConnectionBindings: input.projectConnectionBindings,
    delegations: input.delegations,
    workerControl,
    continuationControl,
    ...(input.updatedAt ? { updatedAt: input.updatedAt } : {})
  });
}

export class PostgresControlRegistryStore implements ControlRegistryStore {
  readonly accountDomainId: string;
  readonly #registryKey: string;
  readonly #client: PostgresQueryClient;
  readonly #close?: () => Promise<void>;
  #ready?: Promise<void>;

  constructor(
    client: PostgresQueryClient,
    accountDomainId: string,
    close?: () => Promise<void>
  ) {
    this.accountDomainId = requiredDomain(accountDomainId);
    this.#registryKey = registryKey(this.accountDomainId);
    this.#client = client;
    this.#close = close;
  }

  static fromConnectionString(
    connectionString: string,
    accountDomainId: string
  ): PostgresControlRegistryStore {
    const pool = new Pool({
      connectionString,
      max: 2,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000
    });

    return new PostgresControlRegistryStore(
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
      [this.#registryKey]
    );
    if (result.rows.length === 0) return 0;
    return Number(result.rows[0]!.revision);
  }

  async load(): Promise<ControlRegistrySnapshot> {
    await this.#ensureTable();
    const result = await this.#client.query(
      "SELECT revision, payload, updated_at FROM asc_control_registry WHERE registry_key = $1",
      [this.#registryKey]
    );

    if (result.rows.length === 0) {
      return emptyControlRegistrySnapshot(this.accountDomainId);
    }
    const row = result.rows[0]!;
    return decodePayload(
      this.accountDomainId,
      Number(row.revision),
      row.payload,
      row.updated_at
    );
  }

  async save(input: SaveControlRegistryInput): Promise<ControlRegistrySnapshot> {
    await this.#ensureTable();
    const payload = encodePayload(this.accountDomainId, input);
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
        [this.#registryKey, payload, updatedAt]
      );
    } else {
      result = await this.#client.query(
        [
          "UPDATE asc_control_registry",
          "SET revision = revision + 1, payload = $2::jsonb, updated_at = $3::timestamptz",
          "WHERE registry_key = $1 AND revision = $4",
          "RETURNING revision, payload, updated_at"
        ].join(" "),
        [
          this.#registryKey,
          payload,
          updatedAt,
          input.expectedRevision
        ]
      );
    }

    if (result.rows.length === 0) {
      throw new RegistryRevisionConflictError(
        input.expectedRevision,
        await this.#currentRevision()
      );
    }

    const row = result.rows[0]!;
    return decodePayload(
      this.accountDomainId,
      Number(row.revision),
      row.payload,
      row.updated_at
    );
  }

  async close(): Promise<void> {
    if (this.#close) await this.#close();
  }
}
