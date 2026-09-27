import {
  mkdir,
  open,
  readFile,
  rename,
  unlink,
  writeFile
} from "node:fs/promises";
import { dirname } from "node:path";

import { emptyWorkerControlState, type WorkerControlState } from "../../domain/index.js";
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

function errno(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

function requiredDomain(value: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error("Control registry AccountDomain cannot be empty.");
  return normalized;
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

function freezeSnapshot(snapshot: ControlRegistrySnapshot): ControlRegistrySnapshot {
  return Object.freeze({
    ...snapshot,
    projects: Object.freeze([...snapshot.projects]),
    connections: Object.freeze([...snapshot.connections]),
    projectConnectionBindings: Object.freeze([...snapshot.projectConnectionBindings]),
    delegations: Object.freeze([...snapshot.delegations]),
    workerControl: normalizeWorkerControl(snapshot.workerControl, snapshot.accountDomainId)
  });
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

function parseSnapshot(
  raw: string,
  expectedAccountDomainId: string
): ControlRegistrySnapshot {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const version = parsed.schemaVersion;
  if (
    version !== 1 &&
    version !== 2 &&
    version !== CONTROL_REGISTRY_SCHEMA_VERSION
  ) {
    throw new Error("Unsupported control registry schema version: " + String(version));
  }
  if (!Number.isInteger(parsed.revision) || Number(parsed.revision) < 0) {
    throw new Error("Control registry revision must be a non-negative integer.");
  }
  if (!Array.isArray(parsed.projects) || !Array.isArray(parsed.connections)) {
    throw new Error("Control registry must contain projects and connections arrays.");
  }

  const storedDomain =
    typeof parsed.accountDomainId === "string"
      ? parsed.accountDomainId
      : expectedAccountDomainId;
  if (storedDomain !== expectedAccountDomainId) {
    throw new Error(
      "Control registry belongs to AccountDomain " + storedDomain +
      ", not " + expectedAccountDomainId + "."
    );
  }

  const connections = normalizeConnections(
    parsed.connections as readonly Record<string, unknown>[]
  );
  const snapshot: ControlRegistrySnapshot = {
    schemaVersion: CONTROL_REGISTRY_SCHEMA_VERSION,
    accountDomainId: expectedAccountDomainId,
    revision: Number(parsed.revision),
    projects: normalizeProjects(
      parsed.projects as readonly Record<string, unknown>[],
      expectedAccountDomainId
    ) as unknown as ControlRegistrySnapshot["projects"],
    connections: connections as unknown as ControlRegistrySnapshot["connections"],
    projectConnectionBindings: Array.isArray(parsed.projectConnectionBindings)
      ? parsed.projectConnectionBindings as ControlRegistrySnapshot["projectConnectionBindings"]
      : Object.freeze([]),
    delegations: Array.isArray(parsed.delegations)
      ? parsed.delegations as ControlRegistrySnapshot["delegations"]
      : Object.freeze([]),
    workerControl: normalizeWorkerControl(parsed.workerControl, expectedAccountDomainId),
    ...(typeof parsed.updatedAt === "string" ? { updatedAt: parsed.updatedAt } : {})
  };

  assertTenantOwnership(
    expectedAccountDomainId,
    snapshot.projects,
    snapshot.connections
  );
  assertNoSecretLikeFields(snapshot.connections, "registry.connections");
  assertNoSecretLikeFields(
    snapshot.projectConnectionBindings,
    "registry.projectConnectionBindings"
  );
  assertNoSecretLikeFields(snapshot.delegations, "registry.delegations");
  return freezeSnapshot(snapshot);
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class JsonFileControlRegistryStore implements ControlRegistryStore {
  readonly accountDomainId: string;
  readonly #path: string;
  readonly #lockPath: string;

  constructor(path: string, accountDomainId: string) {
    this.#path = path;
    this.#lockPath = path + ".lock";
    this.accountDomainId = requiredDomain(accountDomainId);
  }

  async #readUnlocked(): Promise<ControlRegistrySnapshot> {
    try {
      return parseSnapshot(
        await readFile(this.#path, "utf8"),
        this.accountDomainId
      );
    } catch (error) {
      if (errno(error) === "ENOENT") {
        return emptyControlRegistrySnapshot(this.accountDomainId);
      }
      throw error;
    }
  }

  async #withLock<T>(operation: () => Promise<T>): Promise<T> {
    await mkdir(dirname(this.#path), { recursive: true });

    for (let attempt = 0; attempt < 250; attempt += 1) {
      try {
        const handle = await open(this.#lockPath, "wx");
        try {
          return await operation();
        } finally {
          await handle.close();
          await unlink(this.#lockPath).catch(() => undefined);
        }
      } catch (error) {
        if (errno(error) !== "EEXIST") throw error;
        await sleep(8);
      }
    }

    throw new Error("Timed out acquiring ASC control registry lock.");
  }

  async load(): Promise<ControlRegistrySnapshot> {
    return this.#readUnlocked();
  }

  async save(input: SaveControlRegistryInput): Promise<ControlRegistrySnapshot> {
    assertTenantOwnership(
      this.accountDomainId,
      input.projects,
      input.connections
    );
    assertNoSecretLikeFields(input.connections, "registry.connections");
    assertNoSecretLikeFields(
      input.projectConnectionBindings,
      "registry.projectConnectionBindings"
    );
    assertNoSecretLikeFields(input.delegations, "registry.delegations");
    normalizeWorkerControl(input.workerControl, this.accountDomainId);

    return this.#withLock(async () => {
      const current = await this.#readUnlocked();
      if (current.revision !== input.expectedRevision) {
        throw new RegistryRevisionConflictError(
          input.expectedRevision,
          current.revision
        );
      }

      const next: ControlRegistrySnapshot = {
        schemaVersion: CONTROL_REGISTRY_SCHEMA_VERSION,
        accountDomainId: this.accountDomainId,
        revision: current.revision + 1,
        projects: Object.freeze([...input.projects]),
        connections: Object.freeze([...input.connections]),
        projectConnectionBindings: Object.freeze([...input.projectConnectionBindings]),
        delegations: Object.freeze([...input.delegations]),
        workerControl: normalizeWorkerControl(input.workerControl, this.accountDomainId),
        ...(input.updatedAt ? { updatedAt: input.updatedAt } : {})
      };

      const temporaryPath =
        this.#path + ".tmp-" + process.pid + "-" + Date.now();
      await writeFile(
        temporaryPath,
        JSON.stringify(next, null, 2) + "\n",
        {
          encoding: "utf8",
          mode: 0o600
        }
      );
      await rename(temporaryPath, this.#path);
      return freezeSnapshot(next);
    });
  }
}
